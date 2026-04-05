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
  // Priority 1: exact variation_sku match
  const varSku = (sku as any).variation_sku;
  if (varSku) {
    const exact = rules.find((r) => (r as any).variation_sku === varSku);
    if (exact) return exact;
  }

  // Priority 2: exact parents_sku match
  if (sku.parents_sku) {
    const parentMatch = rules.find(
      (r) => r.parents_sku && r.parents_sku === sku.parents_sku,
    );
    if (parentMatch) return parentMatch;
  }

  // Priority 3: category match
  if (sku.category) {
    const catRule = rules.find(
      (r) => !r.parents_sku && !(r as any).variation_sku && r.category && r.category === sku.category,
    );
    if (catRule) return catRule;
  }

  // Priority 4: brand default
  const brandDefault = rules.find((r) => !r.parents_sku && !(r as any).variation_sku && !r.category)
    ?? rules.find((r) => !r.parents_sku && !(r as any).variation_sku);
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

    // PAN brand includes JN and PN codes
    const brandFilter = brand === "PAN" ? ["JN", "PN", "PAN"] : brand ? [brand] : null;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // 0. Fetch platform fees to compute weighted avg fee rate
    const { data: feeData } = await supabase
      .schema("core")
      .from("platform_fee_config")
      .select("platform_name, commission_rate, service_fee_rate, payment_fee_rate, other_fee_rate");

    // Use the highest platform total fee rate (worst-case margin)
    let maxPlatformFeeRate = 0;
    let maxPlatformName = "";
    if (feeData && feeData.length > 0) {
      for (const f of feeData as any[]) {
        const total = (Number(f.commission_rate) || 0) + (Number(f.service_fee_rate) || 0) +
          (Number(f.payment_fee_rate) || 0) + (Number(f.other_fee_rate) || 0);
        if (total > maxPlatformFeeRate) {
          maxPlatformFeeRate = total;
          maxPlatformName = f.platform_name;
        }
      }
    }

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

    // 2. Fetch all SKU pricing (paginate to get all rows, Supabase default limit=1000)
    const skus: SkuPricing[] = [];
    const pageSize = 1000;
    let offset = 0;
    while (true) {
      let skuQuery = supabase
        .schema("core")
        .from("sku_pricing")
        .select("*")
        .range(offset, offset + pageSize - 1);
      if (brandFilter) {
        skuQuery = skuQuery.in("brand", brandFilter);
      }
      const { data: skuData, error: skuError } = await skuQuery;
      if (skuError) {
        return NextResponse.json({ error: skuError.message }, { status: 500 });
      }
      if (!skuData || skuData.length === 0) break;
      skus.push(...(skuData as SkuPricing[]));
      if (skuData.length < pageSize) break;
      offset += pageSize;
    }

    // 3. Group rules by brand for efficient lookup
    // JN (Junior) uses PN (PAN) rules as fallback
    const rulesByBrand = new Map<string, PricingRule[]>();
    for (const rule of rules) {
      const b = rule.brand;
      if (!rulesByBrand.has(b)) rulesByBrand.set(b, []);
      rulesByBrand.get(b)!.push(rule);
    }
    // Copy PN rules to JN if JN has no rules
    if (!rulesByBrand.has("JN") && rulesByBrand.has("PN")) {
      rulesByBrand.set("JN", rulesByBrand.get("PN")!);
    }

    // 4. Calculate new prices
    const now = new Date().toISOString();
    const updates: Record<string, unknown>[] = [];
    const historyRows: Record<string, unknown>[] = [];

    for (const sku of skus) {
      const skuBrand = sku.brand ?? "";
      const brandRules = rulesByBrand.get(skuBrand) ?? rules;
      const rule = findMatchingRule(sku, brandRules);
      if (!rule) continue;

      // Use rrp, fall back to price_tag if rrp is missing
      const rrp = Number(sku.rrp) || Number((sku as any).price_tag) || 0;
      if (rrp <= 0) continue;

      const newRsp = rule.pct_rsp != null ? round2(rrp * Number(rule.pct_rsp)) : sku.rsp;
      const newCampaignA = rule.pct_campaign_a != null ? round2(rrp * Number(rule.pct_campaign_a)) : sku.price_campaign_a;
      const newMega = rule.pct_mega != null ? round2(rrp * Number(rule.pct_mega)) : sku.price_mega;
      const newFlashSale = rule.pct_flash_sale != null ? round2(rrp * Number(rule.pct_flash_sale)) : sku.price_flash_sale;

      // Weighted avg selling price: RSP*40% + Campaign A*30% + Mega*30%
      // Margin% = (WeightedPrice - COGS - PlatformFees) / WeightedPrice × 100
      const cost = Number((sku as any).cogs_inc_vat) || 0;
      const rspVal = Number(newRsp) || 0;
      const campAVal = Number(newCampaignA) || rspVal;
      const megaVal = Number(newMega) || rspVal;
      const weightedPrice = round2(rspVal * 0.4 + campAVal * 0.3 + megaVal * 0.3);
      const platformFees = weightedPrice * maxPlatformFeeRate;
      const margin = weightedPrice > 0 && cost > 0
        ? Math.round((weightedPrice - cost - platformFees) / weightedPrice * 1000) / 10
        : null;

      const updateObj: Record<string, unknown> = {
        item_sku: sku.item_sku,
        rsp: newRsp,
        price_campaign_a: newCampaignA,
        price_mega: newMega,
        price_flash_sale: newFlashSale,
        min_price: newFlashSale, // Flash Sale = floor price
        est_margin: margin,
        updated_at: now,
      };
      // Fill rrp from price_tag if it was null
      if (!sku.rrp && rrp > 0) updateObj.rrp = rrp;

      updates.push(updateObj);

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

    // 5. Batch upsert — include all NOT NULL fields to avoid constraint errors
    let updatedCount = 0;
    const batchSize = 500;
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize).map((u) => {
        // Find original SKU to include required fields
        const orig = skus.find((s) => s.item_sku === u.item_sku);
        return {
          ...u,
          variation_sku: (orig as any)?.variation_sku ?? "",
          parents_sku: (orig as any)?.parents_sku ?? "",
          brand: (orig as any)?.brand ?? "",
        };
      });

      const { error: updateError } = await supabase
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });

      if (updateError) {
        console.error(`Batch upsert error at ${i}: ${updateError.message}`);
        // Fallback to individual updates for this batch
        for (const u of batch) {
          const { item_sku: isk, variation_sku: _v, parents_sku: _p, brand: _b, ...patchData } = u as any;
          await supabase.schema("core").from("sku_pricing").update(patchData).eq("item_sku", isk);
          updatedCount++;
        }
        continue;
      }
      updatedCount += batch.length;
    }

    // 6. Log history in batches
    const histBatchSize = 500;
    for (let i = 0; i < historyRows.length; i += histBatchSize) {
      const batch = historyRows.slice(i, i + histBatchSize);
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
