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
    const pageSize = Math.max(1, Math.min(1000, Number(url.searchParams.get("pageSize")) || 50));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Build brand filter helper
    function applyBrandFilter(q: any) {
      if (!brand) return q;
      const b = brand.toUpperCase();
      if (b === "PAN") return q.in("brand", ["JN", "PN", "PAN"]);
      return q.eq("brand", b);
    }

    // Step 1: Get ALL unique variation_skus (with filters) — paginate to overcome 1000 row limit
    const allVarSet = new Set<string>();
    let varOffset = 0;
    const varBatchSize = 1000;
    while (true) {
      let varQuery = supabase
        .schema("core")
        .from("sku_pricing")
        .select("variation_sku")
        .range(varOffset, varOffset + varBatchSize - 1);
      varQuery = applyBrandFilter(varQuery);
      if (parentsSku) varQuery = varQuery.eq("parents_sku", parentsSku);
      if (variationSku) varQuery = varQuery.eq("variation_sku", variationSku);
      if (q) varQuery = varQuery.or(`item_sku.ilike.%${q}%,description.ilike.%${q}%,variation_sku.ilike.%${q}%`);

      const { data: batch, error: varError } = await varQuery;
      if (varError) {
        return NextResponse.json({ error: varError.message }, { status: 500 });
      }
      if (!batch || batch.length === 0) break;
      for (const r of batch) allVarSet.add(r.variation_sku as string);
      if (batch.length < varBatchSize) break;
      varOffset += varBatchSize;
    }

    const uniqueVars = [...allVarSet].sort();
    const totalVariations = uniqueVars.length;

    // Step 2: Paginate the variation list
    const from = (page - 1) * pageSize;
    const pageVars = uniqueVars.slice(from, from + pageSize);

    if (pageVars.length === 0) {
      return NextResponse.json({
        data: [], total: 0, totalVariations, currentVariations: 0,
        page, pageSize, pageCount: Math.max(1, Math.ceil(totalVariations / pageSize)),
      });
    }

    // Step 3: Fetch ALL items for the variations in this page
    // Supabase .in() has a limit on array size, and default row limit is 1000
    // Split into chunks of 100 variations and paginate rows
    const data: any[] = [];
    const varChunkSize = 100;
    for (let ci = 0; ci < pageVars.length; ci += varChunkSize) {
      const varChunk = pageVars.slice(ci, ci + varChunkSize);
      let rowOffset = 0;
      while (true) {
        const { data: batch, error } = await supabase
          .schema("core")
          .from("sku_pricing")
          .select("*")
          .in("variation_sku", varChunk)
          .order("variation_sku", { ascending: true })
          .order("item_sku", { ascending: true })
          .range(rowOffset, rowOffset + 999);

        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
        if (!batch || batch.length === 0) break;
        data.push(...batch);
        if (batch.length < 1000) break;
        rowOffset += 1000;
      }
    }

    const pageCount = Math.max(1, Math.ceil(totalVariations / pageSize));

    return NextResponse.json({
      data: data ?? [],
      total: totalVariations,
      totalVariations,
      currentVariations: pageVars.length,
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
