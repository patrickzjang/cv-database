import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// GET: List pricing_rules with optional brand filter
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing-rules:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(1000, Number(url.searchParams.get("pageSize")) || 50));
    const from = (page - 1) * pageSize;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("pricing_rules")
      .select("*", { count: "exact" })
      .order("brand", { ascending: true })
      .order("variation_sku", { ascending: true, nullsFirst: false })
      .range(from, from + pageSize - 1);

    if (brand) {
      const b = brand.toUpperCase();
      if (b === "PAN") {
        query = query.in("brand", ["JN", "PN", "PAN"]);
      } else {
        query = query.eq("brand", b);
      }
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rules = data ?? [];
    const total = count ?? 0;

    // Fetch avg cogs_ratio (cogs_inc_vat / rrp) per parents_sku for real-time margin calc
    const parentSkus = [...new Set(rules.map((r: any) => r.parents_sku).filter(Boolean))];
    const cogsRatioMap: Record<string, number> = {};

    if (parentSkus.length > 0) {
      // Fetch in smaller chunks to avoid Supabase 1000-row default limit
      for (let i = 0; i < parentSkus.length; i += 10) {
        const chunk = parentSkus.slice(i, i + 10);
        // Paginate within each chunk to get all rows
        let offset = 0;
        while (true) {
          const { data: skuData } = await supabase
            .schema("core")
            .from("sku_pricing")
            .select("parents_sku, cogs_inc_vat, rrp")
            .in("parents_sku", chunk)
            .gt("rrp", 0)
            .gt("cogs_inc_vat", 0)
            .range(offset, offset + 999);

          if (!skuData || skuData.length === 0) break;

          for (const row of skuData) {
            const ps = row.parents_sku;
            if (!cogsRatioMap[ps]) cogsRatioMap[ps] = { sum: 0, count: 0 } as any;
          }
          // Group by parents_sku and compute avg ratio
          for (const row of skuData) {
            const ps = row.parents_sku;
            const entry = (cogsRatioMap as any)[ps] ?? { sum: 0, count: 0 };
            entry.sum = (entry.sum || 0) + row.cogs_inc_vat / row.rrp;
            entry.count = (entry.count || 0) + 1;
            (cogsRatioMap as any)[ps] = entry;
          }

          if (skuData.length < 1000) break;
          offset += 1000;
        }
      }
      // Convert from {sum, count} to ratio
      for (const [ps, agg] of Object.entries(cogsRatioMap)) {
        const a = agg as any;
        if (a.sum != null) cogsRatioMap[ps] = a.sum / a.count;
      }
    }

    // Fetch max platform fee rate (highest total fee across all platforms)
    let maxPlatformFeeRate = 0;
    const { data: feeData } = await supabase
      .schema("core")
      .from("platform_fee_config")
      .select("platform_name, commission_rate, service_fee_rate, payment_fee_rate, other_fee_rate");

    if (feeData && feeData.length > 0) {
      for (const f of feeData as any[]) {
        const total = (Number(f.commission_rate) || 0) + (Number(f.service_fee_rate) || 0) +
          (Number(f.payment_fee_rate) || 0) + (Number(f.other_fee_rate) || 0);
        if (total > maxPlatformFeeRate) maxPlatformFeeRate = total;
      }
    }

    // Attach cogs_ratio to each rule
    const enriched = rules.map((r: any) => ({
      ...r,
      cogs_ratio: r.parents_sku ? (cogsRatioMap[r.parents_sku] ?? null) : null,
    }));

    return NextResponse.json({ data: enriched, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)), maxPlatformFeeRate });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Bulk upsert pricing_rules
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing-rules:post:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.rules) || body.rules.length === 0) {
      return NextResponse.json({ error: "Missing or empty rules array." }, { status: 400 });
    }

    const rules = body.rules as Record<string, unknown>[];

    // Validate each rule has brand
    for (const rule of rules) {
      if (!rule.brand) {
        return NextResponse.json({ error: "Each rule must have brand." }, { status: 400 });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const now = new Date().toISOString();

    let upserted = 0;
    const errors: string[] = [];

    for (const rule of rules) {
      // Build update payload — only include provided fields
      const updateData: Record<string, unknown> = { updated_at: now };
      const fields = ["collection_key", "parents_sku", "variation_sku", "product_name", "category", "sub_category", "collection", "pct_rsp", "pct_campaign_a", "pct_mega", "pct_flash_sale", "pct_est_margin"];
      for (const f of fields) {
        if (f in rule) updateData[f] = rule[f];
      }

      if (rule.id) {
        // Update existing rule by ID
        const { error } = await supabase
          .schema("core")
          .from("pricing_rules")
          .update(updateData)
          .eq("id", rule.id);

        if (error) {
          errors.push(`Rule id=${rule.id}: ${error.message}`);
        } else {
          upserted++;
        }
      } else {
        // Insert new rule
        const { error } = await supabase
          .schema("core")
          .from("pricing_rules")
          .insert({
            brand: String(rule.brand).toUpperCase(),
            ...updateData,
          });

        if (error) {
          errors.push(`New rule ${rule.brand}: ${error.message}`);
        } else {
          upserted++;
        }
      }
    }

    if (errors.length > 0 && upserted === 0) {
      return NextResponse.json({ error: errors.join("; ") }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      upserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
