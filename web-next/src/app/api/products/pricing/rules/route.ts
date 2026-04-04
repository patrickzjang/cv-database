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

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("pricing_rules")
      .select("*")
      .order("brand", { ascending: true })
      .order("parents_sku", { ascending: true, nullsFirst: false });

    if (brand) {
      query = query.eq("brand", brand.toUpperCase());
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data ?? [] });
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

    // Upsert rules one-by-one using raw SQL RPC to handle
    // COALESCE(parents_sku, '') in the conflict target
    let upserted = 0;
    const errors: string[] = [];

    // Batch via RPC for the COALESCE conflict handling
    for (const rule of rules) {
      const { error } = await supabase.schema("core").rpc("upsert_pricing_rule", {
        p_brand: String(rule.brand).toUpperCase(),
        p_collection_key: rule.collection_key ?? null,
        p_parents_sku: rule.parents_sku ?? null,
        p_product_name: rule.product_name ?? null,
        p_category: rule.category ?? null,
        p_sub_category: rule.sub_category ?? null,
        p_collection: rule.collection ?? null,
        p_pct_rsp: rule.pct_rsp ?? null,
        p_pct_campaign_a: rule.pct_campaign_a ?? null,
        p_pct_mega: rule.pct_mega ?? null,
        p_pct_flash_sale: rule.pct_flash_sale ?? null,
        p_updated_at: now,
      });

      if (error) {
        errors.push(`Rule ${rule.brand}/${rule.parents_sku || "default"}: ${error.message}`);
      } else {
        upserted++;
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
