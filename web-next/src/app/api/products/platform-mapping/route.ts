import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// GET: List platform_sku_mapping with filters
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`platform-mapping:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") || undefined;
    const platform = url.searchParams.get("platform") || undefined;
    const listingStatus = url.searchParams.get("listing_status") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(url.searchParams.get("pageSize")) || 50));
    const from = (page - 1) * pageSize;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("platform_sku_mapping")
      .select("*", { count: "planned" })
      .order("item_sku", { ascending: true })
      .range(from, from + pageSize - 1);

    if (brand) {
      const b = brand.toUpperCase();
      if (b === "PAN") {
        query = query.in("brand", ["JN", "PN", "PAN"]);
      } else {
        query = query.eq("brand", b);
      }
    }
    if (platform) {
      query = query.eq("platform", platform);
    }
    if (listingStatus) {
      query = query.eq("listing_status", listingStatus);
    }
    if (q) {
      query = query.or(`item_sku.ilike.%${q}%,platform_sku.ilike.%${q}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const total = count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      data: data ?? [],
      total,
      page,
      pageSize,
      pageCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST: Bulk upsert platform_sku_mapping
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`platform-mapping:post:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.mappings) || body.mappings.length === 0) {
      return NextResponse.json({ error: "Missing or empty mappings array." }, { status: 400 });
    }

    const mappings = body.mappings as Record<string, unknown>[];
    const now = new Date().toISOString();

    // Validate each mapping has item_sku and platform
    for (const mapping of mappings) {
      if (!mapping.item_sku || !mapping.platform) {
        return NextResponse.json({ error: "Each mapping must have item_sku and platform." }, { status: 400 });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const rows = mappings.map((m) => ({
      item_sku: String(m.item_sku),
      brand: m.brand ? String(m.brand).toUpperCase() : null,
      platform: String(m.platform),
      platform_sku: m.platform_sku ? String(m.platform_sku) : null,
      platform_product_id: m.platform_product_id ? String(m.platform_product_id) : null,
      platform_option_id: m.platform_option_id ? String(m.platform_option_id) : null,
      listing_status: m.listing_status ? String(m.listing_status) : "active",
      updated_at: now,
    }));

    // Upsert in batches of 500
    let upserted = 0;
    const batchSize = 500;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const { error } = await supabase
        .schema("core")
        .from("platform_sku_mapping")
        .upsert(batch, { onConflict: "item_sku,platform" });

      if (error) {
        return NextResponse.json({
          error: error.message,
          partialUpserted: upserted,
        }, { status: 500 });
      }
      upserted += batch.length;
    }

    return NextResponse.json({ ok: true, upserted });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
