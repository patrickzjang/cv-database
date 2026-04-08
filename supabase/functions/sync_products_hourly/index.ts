import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callJst, extractListFromData, readPositiveInt, toUnixSeconds } from "../_shared/jst-client.ts";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

// ดึงสินค้าทีละช่วง (default 1 ชั่วโมง)
const WINDOW_HOURS = readPositiveInt("SYNC_WINDOW_HOURS", 24);
const PAGE_SIZE = readPositiveInt("SYNC_PAGE_SIZE", 500);
const MAX_PAGES = readPositiveInt("SYNC_MAX_PAGES", 1000);

const SYNC_VERSION = "v2-fullsync";

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dbErrors: string[] = [];
  console.log(`sync_products_hourly ${SYNC_VERSION} starting...`);

  try {
    // 1) อ่าน state products
    const stateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_products")
      .select("id, last_synced_at")
      .eq("id", 1)
      .maybeSingle();

    if (stateResp.error) {
      dbErrors.push(`sync_state_products select: ${stateResp.error.message}`);
    }
    if (!stateResp.data) {
      throw new Error("sync_state_products row id=1 not found");
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

    let pagesFetched = 0;
    let totalInserted = 0;
    let totalRecords = 0;

    // If total gap > 3 days, do full sync by iterating month-by-month from 2024
    const gapDays = (now.getTime() - fromTime.getTime()) / (1000 * 60 * 60 * 24);
    const isFullSync = gapDays > 3;

    // Build time windows to iterate
    const windows: { from: Date; to: Date }[] = [];
    if (isFullSync) {
      console.log(`Full sync mode (gap=${gapDays.toFixed(1)} days) — iterating month-by-month from 2024`);
      // Generate monthly windows from Jan 2024 to now
      let cursor = new Date("2024-01-01T00:00:00Z");
      while (cursor < now) {
        const nextMonth = new Date(cursor);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        const windowEnd = nextMonth > now ? now : nextMonth;
        windows.push({ from: cursor, to: windowEnd });
        cursor = nextMonth;
      }
    } else {
      windows.push({ from: fromTime, to: toTime });
    }

    for (const win of windows) {
      let pageIndex = 1;
      const wFromUnix = toUnixSeconds(win.from);
      const wToUnix = toUnixSeconds(win.to);

      while (true) {
        if (pagesFetched >= MAX_PAGES) {
          console.warn(`Reached MAX_PAGES=${MAX_PAGES}, stopping`);
          break;
        }

        const bodyGetItems = {
          requestModel: {
            skuIds: [],
            itemIds: [],
            enabled: null,
            isNoQuerySkuCombine: true,
            modifiedBegin: wFromUnix,
            modifiedEnd: wToUnix,
          },
          dataPage: {
            pageSize: PAGE_SIZE,
            pageIndex,
          },
        };

        const json = await callJst("/api/Goods/GetItemSkus", bodyGetItems);
        const list = extractListFromData(json);
        pagesFetched += 1;

        console.log(
          `GetItemSkus ${win.from.toISOString().slice(0,10)} - ${win.to.toISOString().slice(0,10)}, page ${pageIndex}, got ${list.length}`,
        );

        if (!Array.isArray(list) || list.length === 0) break;

        totalRecords += list.length;

        const rows = list.map((p: any) => ({
          company_id:     p.companyId,
          item_id:        p.itemId,
          item_name:      p.itemName,
          sku_id:         p.skuId,
          sku_code:       p.skuCode,
          full_name:      p.fullName,
          brand_name:     p.brandName,
          category_name:  p.categoryName,
          cost_price:     p.costPrice,
          sale_price:     p.salePrice,
          bar_code:       p.barCode,
          supplier_code:  p.supplierCode,
          supplier_name:  p.supplierName,
          enabled:        p.enabled,
          modified_at:    p.modifiedTime
                            ? new Date(p.modifiedTime * 1000).toISOString()
                            : null,
          raw_json:       p,
        }));

        const upsertResp = await supabase
          .schema("jst_raw")
          .from("products_raw")
          .upsert(rows, { onConflict: "sku_id" });

        if (upsertResp.error) {
          throw new Error(`upsert products_raw: ${upsertResp.error.message}`);
        }

        totalInserted += rows.length;

        if (list.length < PAGE_SIZE) break;
        pageIndex += 1;
      }
    }

    // 3) update state — only reached if ALL upserts above succeeded
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_products")
      .update({ last_synced_at: (isFullSync ? now : toTime).toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_products: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        version: SYNC_VERSION,
        message: "product sync done",
        isFullSync,
        fromTime,
        toTime: isFullSync ? now : toTime,
        pagesFetched,
        totalRecords,
        totalInserted,
        dbErrors,
      }),
      { status: 200 },
    );
  } catch (e) {
    console.error("EDGE_FN_FATAL_PRODUCTS", e);
    let msg = "unknown error";
    if (e && typeof e === "object" && "message" in e) {
      msg = String((e as any).message);
    } else {
      msg = String(e);
    }
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
