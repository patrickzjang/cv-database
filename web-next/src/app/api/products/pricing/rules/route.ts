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

    const total = count ?? 0;
    return NextResponse.json({ data: data ?? [], total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
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
