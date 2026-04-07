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
    const warehouseId = url.searchParams.get("warehouse_id") || undefined;
    const status = url.searchParams.get("status") || "all";
    const q = url.searchParams.get("q") || undefined;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "50", 10)));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    // Query inventory_raw
    let query = supabase
      .schema("jst_raw")
      .from("inventory_raw")
      .select("*", { count: "exact" });

    if (warehouseId) {
      query = query.eq("warehouse_id", parseInt(warehouseId, 10));
    }
    if (q) {
      query = query.or(`sku_id.ilike.%${q}%,sku_code.ilike.%${q}%,item_name.ilike.%${q}%`);
    }

    query = query.order("sku_id", { ascending: true }).range(from, to);

    const { data: inventoryRows, error: invError, count } = await query;

    if (invError) {
      return NextResponse.json({ error: invError.message }, { status: 500 });
    }

    const items = inventoryRows ?? [];
    const skuCodes = items.map((r: any) => r.sku_code || r.sku_id).filter(Boolean);

    // JOIN: fetch item_name, brand, description from sku_pricing (by item_sku = sku_code)
    let skuInfoMap: Record<string, any> = {};
    if (skuCodes.length > 0) {
      const { data: skuData } = await supabase
        .schema("core")
        .from("sku_pricing")
        .select("item_sku, description, brand, variation_sku, parents_sku")
        .in("item_sku", skuCodes);

      if (skuData) {
        for (const s of skuData) {
          skuInfoMap[s.item_sku] = s;
        }
      }
    }

    // Fetch reorder configs
    let reorderMap: Record<string, any> = {};
    if (skuCodes.length > 0) {
      const { data: configs } = await supabase
        .schema("core")
        .from("reorder_config")
        .select("*")
        .in("sku_code", skuCodes);

      if (configs) {
        for (const c of configs) {
          reorderMap[c.sku_code] = c;
        }
      }
    }

    // Enrich rows with sku_pricing info + stock status
    const enriched = items.map((row: any) => {
      const skuInfo = skuInfoMap[row.sku_code || row.sku_id];
      const config = reorderMap[row.sku_code || row.sku_id];

      let stock_status = "normal";
      if (row.available_qty <= 0) {
        stock_status = "out_of_stock";
      } else if (config && row.available_qty <= config.min_stock) {
        stock_status = "low_stock";
      }

      return {
        ...row,
        // Fill item_name from sku_pricing if missing
        item_name: row.item_name || skuInfo?.description || null,
        brand: skuInfo?.brand || null,
        variation_sku: skuInfo?.variation_sku || null,
        parents_sku: skuInfo?.parents_sku || null,
        stock_status,
        reorder_config: config || null,
      };
    });

    // Filter by brand (from sku_pricing join)
    let filtered = enriched;
    if (brand && brand !== "ALL") {
      const brandCodes = brand === "PAN" ? ["JN", "PN", "PAN"]
        : brand === "DAYBREAK" ? ["DB"]
        : brand === "HEELCARE" ? ["HC"]
        : brand === "ARENA" ? ["AN"]
        : [brand];
      filtered = filtered.filter((r: any) => r.brand && brandCodes.includes(r.brand));
    }

    // Filter by stock status
    if (status !== "all") {
      filtered = filtered.filter((r: any) => r.stock_status === status);
    }

    return NextResponse.json({
      data: filtered,
      page,
      pageSize,
      total: (status === "all" && !brand) ? (count ?? 0) : filtered.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
