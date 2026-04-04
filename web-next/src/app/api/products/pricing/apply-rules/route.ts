import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

type PricingRule = {
  brand: string;
  parents_sku: string | null;
  category: string | null;
  sub_category: string | null;
  pct_rsp: number | null;
  pct_campaign_a: number | null;
  pct_mega: number | null;
  pct_flash_sale: number | null;
};

type SkuPricing = {
  item_sku: string;
  parents_sku: string | null;
  brand: string | null;
  category?: string | null;
  rrp: number | null;
  rsp: number | null;
  price_campaign_a: number | null;
  price_mega: number | null;
  price_flash_sale: number | null;
};

function findMatchingRule(
  sku: SkuPricing,
  rules: PricingRule[],
): PricingRule | null {
  // Priority 1: exact parents_sku match
  if (sku.parents_sku) {
    const exact = rules.find(
      (r) => r.parents_sku && r.parents_sku === sku.parents_sku,
    );
    if (exact) return exact;
  }

  // Priority 2: category match (parents_sku is null = category-level rule)
  if (sku.category) {
    const catRule = rules.find(
      (r) => !r.parents_sku && r.category && r.category === sku.category,
    );
    if (catRule) return catRule;
  }

  // Priority 3: brand default (parents_sku is null, category is null)
  const brandDefault = rules.find(
    (r) => !r.parents_sku && !r.category,
  );
  return brandDefault ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// POST: Apply pricing rules to recalculate all SKU prices
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing:apply:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => ({}));
    const brand: string | undefined = body.brand ? String(body.brand).toUpperCase() : undefined;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 1. Fetch pricing rules
    let rulesQuery = supabase
      .schema("core")
      .from("pricing_rules")
      .select("*");
    if (brand) {
      rulesQuery = rulesQuery.eq("brand", brand);
    }
    const { data: rulesData, error: rulesError } = await rulesQuery;
    if (rulesError) {
      return NextResponse.json({ error: rulesError.message }, { status: 500 });
    }
    const rules = (rulesData ?? []) as PricingRule[];

    if (rules.length === 0) {
      return NextResponse.json({ error: "No pricing rules found." }, { status: 404 });
    }

    // 2. Fetch all SKU pricing
    let skuQuery = supabase
      .schema("core")
      .from("sku_pricing")
      .select("*");
    if (brand) {
      skuQuery = skuQuery.eq("brand", brand);
    }
    const { data: skuData, error: skuError } = await skuQuery;
    if (skuError) {
      return NextResponse.json({ error: skuError.message }, { status: 500 });
    }
    const skus = (skuData ?? []) as SkuPricing[];

    // 3. Group rules by brand for efficient lookup
    const rulesByBrand = new Map<string, PricingRule[]>();
    for (const rule of rules) {
      const b = rule.brand;
      if (!rulesByBrand.has(b)) rulesByBrand.set(b, []);
      rulesByBrand.get(b)!.push(rule);
    }

    // 4. Calculate new prices
    const now = new Date().toISOString();
    const updates: Record<string, unknown>[] = [];
    const historyRows: Record<string, unknown>[] = [];

    for (const sku of skus) {
      const skuBrand = sku.brand ?? "";
      const brandRules = rulesByBrand.get(skuBrand) ?? rules;
      const rule = findMatchingRule(sku, brandRules);
      if (!rule || !sku.rrp) continue;

      const rrp = Number(sku.rrp);
      if (!rrp || rrp <= 0) continue;

      const newRsp = rule.pct_rsp != null ? round2(rrp * Number(rule.pct_rsp)) : sku.rsp;
      const newCampaignA = rule.pct_campaign_a != null ? round2(rrp * Number(rule.pct_campaign_a)) : sku.price_campaign_a;
      const newMega = rule.pct_mega != null ? round2(rrp * Number(rule.pct_mega)) : sku.price_mega;
      const newFlashSale = rule.pct_flash_sale != null ? round2(rrp * Number(rule.pct_flash_sale)) : sku.price_flash_sale;

      const changed =
        newRsp !== sku.rsp ||
        newCampaignA !== sku.price_campaign_a ||
        newMega !== sku.price_mega ||
        newFlashSale !== sku.price_flash_sale;

      if (!changed) continue;

      updates.push({
        item_sku: sku.item_sku,
        rsp: newRsp,
        price_campaign_a: newCampaignA,
        price_mega: newMega,
        price_flash_sale: newFlashSale,
        updated_at: now,
      });

      // Log changes
      const changes: [string, unknown, unknown][] = [
        ["rsp", sku.rsp, newRsp],
        ["price_campaign_a", sku.price_campaign_a, newCampaignA],
        ["price_mega", sku.price_mega, newMega],
        ["price_flash_sale", sku.price_flash_sale, newFlashSale],
      ];
      for (const [field, oldVal, newVal] of changes) {
        if (oldVal !== newVal) {
          historyRows.push({
            item_sku: sku.item_sku,
            field_name: field,
            old_value: oldVal,
            new_value: newVal,
            changed_by: "apply-rules",
            changed_at: now,
          });
        }
      }
    }

    // 5. Bulk update in batches of 500
    let updatedCount = 0;
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize);
      const { error: updateError } = await supabase
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });

      if (updateError) {
        return NextResponse.json({
          error: updateError.message,
          partialUpdated: updatedCount,
        }, { status: 500 });
      }
      updatedCount += batch.length;
    }

    // 6. Log history in batches
    for (let i = 0; i < historyRows.length; i += batchSize) {
      const batch = historyRows.slice(i, i + batchSize);
      await supabase
        .schema("core")
        .from("sku_pricing_history")
        .insert(batch);
    }

    return NextResponse.json({
      ok: true,
      updated: updatedCount,
      totalSkus: skus.length,
      rulesApplied: rules.length,
      historyEntries: historyRows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
