import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

// ดึงทีละช่วง (ชั่วโมง) – default 1 ชั่วโมง
const WINDOW_HOURS = readPositiveInt("SYNC_WINDOW_HOURS", 24);
const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 100);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);
const DETAIL_BATCH_SIZE = readPositiveInt("SYNC_ORDER_DETAIL_BATCH_SIZE", 10);

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const dbErrors: string[] = [];

  try {
    // 1) อ่าน sync_state_orders
    const stateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_orders")
      .select("id, last_synced_at")
      .eq("id", 1)
      .maybeSingle();

    if (stateResp.error) {
      dbErrors.push(`sync_state_orders select: ${stateResp.error.message}`);
    }
    if (!stateResp.data) {
      throw new Error("sync_state_orders row id=1 not found");
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

    // 2) GetOrders
    const orderIdSet = new Set<number>();
    let pageIndex = 1;
    let pagesFetched = 0;
    const fromUnix = toUnixSeconds(fromTime);
    const toUnix = toUnixSeconds(toTime);

    while (true) {
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(`GetOrders exceeded MAX_PAGES=${MAX_PAGES}`);
      }
      const bodyGetOrders = {
        dataPage: {
          pageSize: PAGE_SIZE,
          pageIndex,
        },
        requestModel: {
          orderTimeBegin: fromUnix,
          orderTimeEnd: toUnix,
        },
      };

      const json = await callJst("/api/Order/GetOrders", bodyGetOrders);
      const list = extractListFromData(json);
      pagesFetched += 1;

      console.log(
        `GetOrders ${fromTime.toISOString()} - ${toTime.toISOString()}, page ${pageIndex}, got ${list.length}`,
      );

      if (!Array.isArray(list) || list.length === 0) break;

      for (const o of list) {
        const id = (o as any).orderId;
        if (id !== undefined && id !== null) {
          const normalizedId = Number(id);
          if (Number.isFinite(normalizedId)) {
            orderIdSet.add(normalizedId);
          }
        }
      }

      if (list.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    const orderIds = Array.from(orderIdSet);

    if (orderIds.length === 0) {
      // อัปเดต state แล้วจบ
      const updateResp = await supabase
        .schema("jst_raw")
        .from("sync_state_orders")
        .update({ last_synced_at: toTime.toISOString() })
        .eq("id", 1);

      if (updateResp.error) {
        dbErrors.push(`update sync_state_orders (no orders): ${updateResp.error.message}`);
      }

      return new Response(
        JSON.stringify({ message: "no orders", fromTime, toTime, dbErrors }),
        { status: 200 },
      );
    }

    // 3) GetOrderDetailByIds → insert
    let insertedCount = 0;

    for (let i = 0; i < orderIds.length; i += DETAIL_BATCH_SIZE) {
      const batch = orderIds.slice(i, i + DETAIL_BATCH_SIZE);

      const bodyDetail = {
        orderIds: batch,
        platformOrderIds: [],
        IsSplitCombineItem: false,
      };

      const detailJson = await callJst(
        "/api/Order/GetOrderDetailByIds",
        bodyDetail,
      );
      const orders = extractListFromData(detailJson);

      console.log(
        `GetOrderDetailByIds for ${batch.length} orderIds, got ${orders.length} orders`,
      );

      if (!Array.isArray(orders) || orders.length === 0) continue;

      const rows = orders.map((o: any) => ({
        order_id: o.orderId,
        platform_order_id: o.platformOrderId,
        platform_buyer_id: o.platformBuyerId,

        company_id: o.companyId,
        shop_id: o.shopId,
        shop_name: o.shopName,
        warehouse_id: o.warehouseId,
        logistics_company_code: o.logisticsCompanyCode,
        logistics_company_name: o.logisticsCompanyName,
        logistics_status: o.logisticsStatus,
        delivery_way: o.deliveryWay,

        status: o.status,
        order_time: o.orderTime ? new Date(o.orderTime * 1000).toISOString() : null,
        pay_time: o.payTime ? new Date(o.payTime * 1000).toISOString() : null,
        send_time: o.sendTime ? new Date(o.sendTime * 1000).toISOString() : null,
        sign_time: o.signTime ? new Date(o.signTime * 1000).toISOString() : null,

        amount: o.amount,
        pay_amount: o.payAmount,
        paid_amount: o.paidAmount,
        freight_income: o.freightIncome,
        freight_fee: o.freightFee,
        shop_free_amount: o.shopFreeAmount,
        platform_free_amount: o.platformFreeAmount,
        discount_rate: o.discountRate,
        drp_amount: o.drpAmount,
        orther_amount: o.ortherAmount,

        is_cod: o.isCod,
        settlement_method: o.settlementMethod,

        receiver_address: o.receiverAddress,
        receiver_province: o.receiverProvince,
        receiver_city: o.receiverCity,
        receiver_district: o.receiverDistrict,
        receiver_zip: o.receiverZip,
        receiver_country: o.receiverCountry,

        order_items_raw: o.orderItems ?? [],
        order_pays_raw: o.orderPays ?? [],
        raw_json: o,
      }));

      const upsertResp = await supabase
        .schema("jst_raw")
        .from("order_details_raw")
        .upsert(rows, { onConflict: "order_id" });

      if (upsertResp.error) {
        // Throw immediately — do NOT advance sync state if any batch fails.
        // This ensures the failed window is retried on the next run rather
        // than silently lost forever.
        throw new Error(`upsert order_details_raw: ${upsertResp.error.message}`);
      }

      insertedCount += rows.length;
    }

    // 4) update state — only reached if ALL upserts above succeeded
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_orders")
      .update({ last_synced_at: toTime.toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_orders: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "sync done",
        fromTime,
        toTime,
        pagesFetched,
        orderCount: orderIds.length,
        detailInserted: insertedCount,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    // กรณี fatal จริง ๆ (เช่น JST ล่ม) ค่อยตอบ 500
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
