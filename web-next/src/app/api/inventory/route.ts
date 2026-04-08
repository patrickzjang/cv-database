import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";

export async function GET(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!(await checkRateLimit(`inventory:${ip}`, 60, 60_000))) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const url = new URL(req.url);
    const brand = url.searchParams.get("brand") || undefined;
    const warehouseFilter = url.searchParams.get("warehouse") || undefined;
    const status = url.searchParams.get("status") || "all";
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch all inventory rows in pages (PostgREST caps at 1000 per request)
    const items: any[] = [];
    let fetchFrom = 0;
    const FETCH_SIZE = 1000;
    while (true) {
      let query = supabase
        .schema("jst_raw")
        .from("inventory_raw")
        .select("*");

      if (q) {
        query = query.or(`sku_id.ilike.%${q}%,sku_code.ilike.%${q}%,item_name.ilike.%${q}%`);
      }

      query = query.order("sku_code", { ascending: true }).range(fetchFrom, fetchFrom + FETCH_SIZE - 1);

      const { data: batch, error: invError } = await query;

      if (invError) {
        return NextResponse.json({ error: invError.message }, { status: 500 });
      }

      if (!batch || batch.length === 0) break;
      items.push(...batch);
      if (batch.length < FETCH_SIZE) break;
      fetchFrom += FETCH_SIZE;
    }

    // Collect unique SKU codes for joins
    const skuCodeSet = new Set<string>();
    for (const r of items) {
      const code = (r as any).sku_code || (r as any).sku_id;
      if (code) skuCodeSet.add(code);
    }
    const skuCodes = Array.from(skuCodeSet);

    // JOIN: fetch brand, description, pricing from sku_pricing (in chunks to avoid URL length limits)
    const skuInfoMap: Record<string, any> = {};
    const CHUNK = 300;
    for (let i = 0; i < skuCodes.length; i += CHUNK) {
      const chunk = skuCodes.slice(i, i + CHUNK);
      const { data: skuData } = await supabase
        .schema("core")
        .from("sku_pricing")
        .select("item_sku, description, brand, variation_sku, parents_sku, rsp, rrp")
        .in("item_sku", chunk);

      if (skuData) {
        for (const s of skuData) {
          skuInfoMap[s.item_sku] = s;
        }
      }
    }

    // Fetch reorder configs (in chunks)
    const reorderMap: Record<string, any> = {};
    for (let i = 0; i < skuCodes.length; i += CHUNK) {
      const chunk = skuCodes.slice(i, i + CHUNK);
      const { data: configs } = await supabase
        .schema("core")
        .from("reorder_config")
        .select("*")
        .in("sku_code", chunk);

      if (configs) {
        for (const c of configs) {
          reorderMap[c.sku_code] = c;
        }
      }
    }

    // Enrich rows — warehouse comes directly from DB (synced per-warehouse from JST)
    let enriched = items.map((row: any) => {
      const code = row.sku_code || row.sku_id;
      const skuInfo = skuInfoMap[code];
      const config = reorderMap[code];

      let stock_status = "normal";
      if (row.available_qty <= 0) {
        stock_status = "out_of_stock";
      } else if (config && row.available_qty <= config.min_stock) {
        stock_status = "low_stock";
      }

      return {
        sku_id: row.sku_id,
        sku_code: code,
        item_name: row.item_name || skuInfo?.description || null,
        brand: skuInfo?.brand || null,
        warehouse: row.warehouse_name || null,
        variation_sku: skuInfo?.variation_sku || null,
        available_qty: row.available_qty || 0,
        actual_qty: row.actual_qty || 0,
        locked_qty: row.locked_qty || 0,
        defective_qty: row.defective_qty || 0,
        cost_price: row.cost_price || 0,
        rsp: skuInfo?.rsp || null,
        rrp: skuInfo?.rrp || null,
        avg_daily_sales: row.avg_daily_sales || null,
        stock_status,
        reorder_config: config || null,
      };
    });

    // Filter by brand
    if (brand && brand !== "ALL") {
      const brandCodes = brand === "PAN" ? ["JN", "PN", "PAN"]
        : brand === "DAYBREAK" ? ["DB"]
        : brand === "HEELCARE" ? ["HC"]
        : brand === "ARENA" ? ["AN"]
        : [brand];
      enriched = enriched.filter((r) => r.brand && brandCodes.includes(r.brand));
    }

    // Filter by warehouse (inferred from brand)
    if (warehouseFilter) {
      enriched = enriched.filter((r) => r.warehouse === warehouseFilter);
    }

    // Filter by stock status
    if (status !== "all") {
      enriched = enriched.filter((r) => r.stock_status === status);
    }

    // Summary across ALL filtered data
    let summaryLowStock = 0;
    let summaryOutOfStock = 0;
    let summaryStockValue = 0;
    let summaryTotalQty = 0;
    for (const item of enriched) {
      summaryTotalQty += item.available_qty;
      if (item.stock_status === "out_of_stock") {
        summaryOutOfStock++;
      } else {
        const sales = item.avg_daily_sales ?? 0;
        if (sales > 0 && item.available_qty / sales < 15) {
          summaryLowStock++;
        }
      }
      summaryStockValue += item.available_qty * (item.rsp || item.rrp || 0);
    }

    const total = enriched.length;

    // Paginate
    const from = (page - 1) * pageSize;
    const paged = enriched.slice(from, from + pageSize);

    return NextResponse.json({
      data: paged,
      page,
      pageSize,
      total,
      summary: {
        total_skus: total,
        total_qty: summaryTotalQty,
        low_stock: summaryLowStock,
        out_of_stock: summaryOutOfStock,
        stock_value: summaryStockValue,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
