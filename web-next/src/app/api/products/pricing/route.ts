import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

// GET: List sku_pricing with filters
export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing:get:${ip}`, 60, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") || undefined;
    const parentsSku = url.searchParams.get("parents_sku") || undefined;
    const variationSku = url.searchParams.get("variation_sku") || undefined;
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.max(1, Math.min(500, Number(url.searchParams.get("pageSize")) || 50));
    const from = (page - 1) * pageSize;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    let query = supabase
      .schema("core")
      .from("sku_pricing")
      .select("*", { count: "planned" })
      .order("item_sku", { ascending: true })
      .range(from, from + pageSize - 1);

    if (brand) {
      query = query.eq("brand", brand.toUpperCase());
    }
    if (parentsSku) {
      query = query.eq("parents_sku", parentsSku);
    }
    if (variationSku) {
      query = query.eq("variation_sku", variationSku);
    }
    if (q) {
      query = query.or(`item_sku.ilike.%${q}%,description.ilike.%${q}%`);
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

// POST: Bulk upsert sku_pricing
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing:post:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "Missing or empty items array." }, { status: 400 });
    }

    const items = body.items as Record<string, unknown>[];
    const now = new Date().toISOString();

    // Validate each item has item_sku
    for (const item of items) {
      if (!item.item_sku) {
        return NextResponse.json({ error: "Each item must have item_sku." }, { status: 400 });
      }
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch existing prices for history logging
    const itemSkus = items.map((i) => String(i.item_sku));
    const { data: existingRows } = await supabase
      .schema("core")
      .from("sku_pricing")
      .select("*")
      .in("item_sku", itemSkus);

    const existingMap = new Map<string, Record<string, unknown>>();
    if (existingRows) {
      for (const row of existingRows) {
        existingMap.set(String(row.item_sku), row);
      }
    }

    // Prepare rows for upsert
    const rows = items.map((item) => ({
      item_sku: item.item_sku,
      variation_sku: item.variation_sku ?? null,
      parents_sku: item.parents_sku ?? null,
      brand: item.brand ?? null,
      group_code: item.group_code ?? null,
      description: item.description ?? null,
      price_tag: item.price_tag ?? null,
      cogs_ex_vat: item.cogs_ex_vat ?? null,
      vat: item.vat ?? null,
      cogs_inc_vat: item.cogs_inc_vat ?? null,
      rrp: item.rrp ?? null,
      rsp: item.rsp ?? null,
      price_campaign_a: item.price_campaign_a ?? null,
      price_mega: item.price_mega ?? null,
      price_flash_sale: item.price_flash_sale ?? null,
      min_price: item.min_price ?? null,
      est_margin: item.est_margin ?? null,
      updated_at: now,
    }));

    const { error: upsertError } = await supabase
      .schema("core")
      .from("sku_pricing")
      .upsert(rows, { onConflict: "item_sku" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    // Log price changes to history
    const priceFields = [
      "cogs_ex_vat", "cogs_inc_vat", "rrp", "rsp",
      "price_campaign_a", "price_mega", "price_flash_sale", "min_price",
    ];
    const historyRows: Record<string, unknown>[] = [];
    for (const item of items) {
      const sku = String(item.item_sku);
      const old = existingMap.get(sku);
      for (const field of priceFields) {
        const oldVal = old ? Number(old[field]) || null : null;
        const newVal = item[field] != null ? Number(item[field]) : null;
        if (oldVal !== newVal) {
          historyRows.push({
            item_sku: sku,
            field_name: field,
            old_value: oldVal,
            new_value: newVal,
            changed_by: "api",
            changed_at: now,
          });
        }
      }
    }

    if (historyRows.length > 0) {
      await supabase
        .schema("core")
        .from("sku_pricing_history")
        .insert(historyRows);
    }

    return NextResponse.json({ ok: true, upserted: rows.length, historyEntries: historyRows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
