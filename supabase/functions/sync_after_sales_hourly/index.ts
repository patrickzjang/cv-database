import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const WINDOW_HOURS = readPositiveInt("SYNC_WINDOW_HOURS", 24);
const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 100);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dbErrors: string[] = [];

  try {
    // 1) Read sync state
    const stateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_after_sales")
      .select("id, last_synced_at")
      .eq("id", 1)
      .maybeSingle();

    if (stateResp.error) {
      dbErrors.push(`sync_state_after_sales select: ${stateResp.error.message}`);
    }
    if (!stateResp.data) {
      throw new Error("sync_state_after_sales row id=1 not found");
    }

    const fromTime = new Date(stateResp.data.last_synced_at);
    const now = new Date();

    const windowMs = WINDOW_HOURS * 60 * 60 * 1000;
    const toTimeMs = Math.min(fromTime.getTime() + windowMs, now.getTime());
    const toTime = new Date(toTimeMs);

    if (toTime <= fromTime) {
      return new Response(JSON.stringify({ message: "no new window" }), {
        status: 200,
      });
    }

    // 2) Paginate GetAfterSaleOrders
    let pageIndex = 1;
    let pagesFetched = 0;
    let totalInserted = 0;
    const fromUnix = toUnixSeconds(fromTime);
    const toUnix = toUnixSeconds(toTime);

    while (true) {
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(`GetAfterSaleOrders exceeded MAX_PAGES=${MAX_PAGES}`);
      }

      const body = {
        requestModel: {
          modifiedBegin: fromUnix,
          modifiedEnd: toUnix,
          orderByField: "modified",
          orderIsAsc: true,
        },
        dataPage: {
          pageSize: PAGE_SIZE,
          pageIndex,
        },
      };

      const json = await callJst("/api/AfterSaleOrder/GetAfterSaleOrders", body);
      const list = extractListFromData(json);
      pagesFetched += 1;

      console.log(
        `GetAfterSaleOrders ${fromTime.toISOString()} - ${toTime.toISOString()}, page ${pageIndex}, got ${list.length}`,
      );

      if (!Array.isArray(list) || list.length === 0) break;

      // 3) Map to after_sale_orders_raw rows
      const rows = list.map((o: any) => ({
        after_sale_order_id:   o.afterSaleOrderId,
        order_id:              o.orderId,
        platform_order_id:     o.platformOrderId,
        shop_id:               o.shopId,
        shop_name:             o.shopName,
        warehouse_id:          o.warehouseId,
        after_sale_type:       o.afterSaleType,
        question_type:         o.questionType,
        status:                o.status,
        platform_refund_status: o.platformRefundStatus,
        remark:                o.remark,
        items_raw:             o.items ?? [],
        raw_json:              o,
      }));

      // 4) Upsert on after_sale_order_id
      const upsertResp = await supabase
        .schema("jst_raw")
        .from("after_sale_orders_raw")
        .upsert(rows, { onConflict: "after_sale_order_id" });

      if (upsertResp.error) {
        throw new Error(`upsert after_sale_orders_raw: ${upsertResp.error.message}`);
      }

      totalInserted += rows.length;

      if (list.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    // 5) Update sync state -- only on success
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_after_sales")
      .update({ last_synced_at: toTime.toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_after_sales: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "after-sales sync done",
        fromTime,
        toTime,
        pagesFetched,
        totalInserted,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL_AFTER_SALES", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
