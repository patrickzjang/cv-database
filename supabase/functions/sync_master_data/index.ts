import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 100);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dbErrors: string[] = [];
  const summary: Record<string, number> = {};

  try {
    // ========== 1) Shops ==========
    console.log("Syncing shops...");
    let shopCount = 0;
    let pageIndex = 1;
    let pagesFetched = 0;
    const nowUnix = toUnixSeconds(new Date());

    while (true) {
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(`GetShops exceeded MAX_PAGES=${MAX_PAGES}`);
      }

      const body = {
        requestModel: {
          modifiedBegin: 0,
          modifiedEnd: nowUnix,
        },
        dataPage: {
          pageSize: PAGE_SIZE,
          pageIndex,
        },
      };

      const json = await callJst("/api/Shop/GetShops", body);
      const list = extractListFromData(json);
      pagesFetched += 1;

      console.log(`GetShops page ${pageIndex}, got ${list.length}`);

      if (!Array.isArray(list) || list.length === 0) break;

      const rows = list.map((s: any) => ({
        shop_id:   s.shopId,
        shop_name: s.shopName,
        platform:  s.shopName ?? null, // derive from shopName if no dedicated field
        enabled:   s.enabled,
        raw_json:  s,
      }));

      const upsertResp = await supabase
        .schema("jst_raw")
        .from("shops_raw")
        .upsert(rows, { onConflict: "shop_id" });

      if (upsertResp.error) {
        throw new Error(`upsert shops_raw: ${upsertResp.error.message}`);
      }

      shopCount += rows.length;

      if (list.length < PAGE_SIZE) break;
      pageIndex += 1;
    }
    summary.shops = shopCount;

    // ========== 2) Warehouses ==========
    console.log("Syncing warehouses...");
    let warehouseCount = 0;

    const whJson = await callJst("/api/Warehouse/GetWarehouses", {
      WarehouseId: 0,
    });
    const whList = extractListFromData(whJson);

    console.log(`GetWarehouses got ${whList.length}`);

    if (Array.isArray(whList) && whList.length > 0) {
      const rows = whList.map((w: any) => ({
        warehouse_id:   w.warehouseId,
        warehouse_name: w.warehouseName,
        warehouse_type: w.warehouseType,
        country:        w.country,
        province:       w.province,
        city:           w.city,
        raw_json:       w,
      }));

      const upsertResp = await supabase
        .schema("jst_raw")
        .from("warehouses_raw")
        .upsert(rows, { onConflict: "warehouse_id" });

      if (upsertResp.error) {
        throw new Error(`upsert warehouses_raw: ${upsertResp.error.message}`);
      }

      warehouseCount = rows.length;
    }
    summary.warehouses = warehouseCount;

    // ========== 3) Logistics Companies ==========
    console.log("Syncing logistics companies...");
    let logisticsCount = 0;

    const logJson = await callJst("/api/LogisticsCompany/GetLogisticsCompanys", {});
    const logList = extractListFromData(logJson);

    console.log(`GetLogisticsCompanys got ${logList.length}`);

    if (Array.isArray(logList) && logList.length > 0) {
      const rows = logList.map((l: any) => ({
        logistics_company_id:   l.logisticsCompanyId,
        logistics_company_code: l.logisticsCompanyCode,
        logistics_company_name: l.logisticsCompanyName,
        enabled:                l.enabled,
        raw_json:               l,
      }));

      const upsertResp = await supabase
        .schema("jst_raw")
        .from("logistics_companies_raw")
        .upsert(rows, { onConflict: "logistics_company_id" });

      if (upsertResp.error) {
        throw new Error(`upsert logistics_companies_raw: ${upsertResp.error.message}`);
      }

      logisticsCount = rows.length;
    }
    summary.logistics_companies = logisticsCount;

    return new Response(
      JSON.stringify({
        message: "master data sync done",
        summary,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL_MASTER_DATA", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    return new Response(JSON.stringify({ error: msg, summary }), { status: 500 });
  }
});
