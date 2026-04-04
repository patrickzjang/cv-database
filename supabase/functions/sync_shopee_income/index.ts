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
      .from("sync_state_income")
      .select("id, last_synced_at")
      .eq("id", 1)
      .maybeSingle();

    if (stateResp.error) {
      dbErrors.push(`sync_state_income select: ${stateResp.error.message}`);
    }
    if (!stateResp.data) {
      throw new Error("sync_state_income row id=1 not found");
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

    // 2) Paginate GetOrderIncomes
    let pageIndex = 1;
    let pagesFetched = 0;
    let totalInserted = 0;
    const fromUnix = toUnixSeconds(fromTime);
    const toUnix = toUnixSeconds(toTime);

    while (true) {
      if (pagesFetched >= MAX_PAGES) {
        throw new Error(`GetOrderIncomes exceeded MAX_PAGES=${MAX_PAGES}`);
      }

      const body = {
        requestModel: {
          modifiedBegin: fromUnix,
          modifiedEnd: toUnix,
          shopId: 0,
        },
        dataPage: {
          pageSize: PAGE_SIZE,
          pageIndex,
        },
      };

      const json = await callJst("/api/Order/GetOrderIncomes", body);
      const list = extractListFromData(json);
      pagesFetched += 1;

      console.log(
        `GetOrderIncomes ${fromTime.toISOString()} - ${toTime.toISOString()}, page ${pageIndex}, got ${list.length}`,
      );

      if (!Array.isArray(list) || list.length === 0) break;

      // 3) Parse income data and map rows
      const rows = list.map((o: any) => {
        // The income data may be a JSON string that needs parsing
        let incomeData: any = {};
        try {
          if (typeof o.data === "string") {
            incomeData = JSON.parse(o.data);
          } else if (o.data && typeof o.data === "object") {
            incomeData = o.data;
          }
        } catch {
          console.log(`Failed to parse income data for order ${o.orderId}, using raw`);
          incomeData = {};
        }

        return {
          order_id:           o.orderId,
          platform_order_id:  o.platformOrderId,
          shop_id:            o.shopId,
          shop_name:          o.shopName,
          escrow_amount:      incomeData.escrowAmount ?? incomeData.escrow_amount ?? null,
          buyer_total:        incomeData.buyerTotal ?? incomeData.buyer_total ?? null,
          original_price:     incomeData.originalPrice ?? incomeData.original_price ?? null,
          commission_fee:     incomeData.commissionFee ?? incomeData.commission_fee ?? null,
          service_fee:        incomeData.serviceFee ?? incomeData.service_fee ?? null,
          transaction_fee:    incomeData.transactionFee ?? incomeData.transaction_fee ?? null,
          seller_discount:    incomeData.sellerDiscount ?? incomeData.seller_discount ?? null,
          platform_discount:  incomeData.platformDiscount ?? incomeData.platform_discount ?? null,
          shipping_fee_paid:  incomeData.shippingFeePaid ?? incomeData.shipping_fee_paid ?? null,
          shipping_rebate:    incomeData.shippingRebate ?? incomeData.shipping_rebate ?? null,
          raw_json:           { ...o, parsedIncome: incomeData },
        };
      });

      // 4) Upsert on platform_order_id
      const upsertResp = await supabase
        .schema("jst_raw")
        .from("order_income_raw")
        .upsert(rows, { onConflict: "platform_order_id" });

      if (upsertResp.error) {
        throw new Error(`upsert order_income_raw: ${upsertResp.error.message}`);
      }

      totalInserted += rows.length;

      if (list.length < PAGE_SIZE) break;
      pageIndex += 1;
    }

    // 5) Update sync state -- only on success
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_income")
      .update({ last_synced_at: toTime.toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_income: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "shopee income sync done",
        fromTime,
        toTime,
        pagesFetched,
        totalInserted,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL_SHOPEE_INCOME", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
