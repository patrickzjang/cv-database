import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import md5Lib from "https://esm.sh/blueimp-md5@2.19.0";

// ---------- ENV ----------
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;

const JST_BASE_URL     = Deno.env.get("JST_BASE_URL")!;
const JST_APP_KEY      = Deno.env.get("JST_APP_KEY")!;
const JST_APP_SECRET   = Deno.env.get("JST_APP_SECRET")!;
const JST_ACCESS_TOKEN = Deno.env.get("JST_ACCESS_TOKEN")!;
const JST_COMPANY_ID   = Deno.env.get("JST_COMPANY_ID")!;

// ดึงสินค้าทีละช่วง (1 ชั่วโมง)
const WINDOW_HOURS = 1;

// ---------- UTIL ----------
function md5(input: string): string {
  return md5Lib(input).toLowerCase();
}

function buildSign(bodyString: string, ts: string): string {
  const signSource =
    "appkey="      + JST_APP_KEY +
    "&appsecret="  + JST_APP_SECRET +
    "&data="       + bodyString +
    "&accesstoken="+ JST_ACCESS_TOKEN +
    "&companyid="  + JST_COMPANY_ID +
    "&ts="         + ts;

  return md5(signSource);
}

async function callJst(path: string, body: unknown) {
  const ts = Date.now().toString();
  const bodyString = JSON.stringify(body);
  const sign = buildSign(bodyString, ts);

  const res = await fetch(`${JST_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "companyid": JST_COMPANY_ID,
      "accesstoken": JST_ACCESS_TOKEN,
      "ts": ts,
      "sign": sign,
      "appkey": JST_APP_KEY,
      "appsecret": JST_APP_SECRET,
    },
    body: bodyString,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`JST ${path} HTTP error: ${res.status} ${txt}`);
  }

  const json = await res.json();
  if (json && typeof json === "object" && "errorCode" in json && (json as any).errorCode) {
    console.log(`JST ${path} error payload:`, JSON.stringify(json));
    throw new Error(
      `JST ${path} errorCode=${(json as any).errorCode}, message=${(json as any).message ?? ""}`,
    );
  }

  return json;
}

function toUnixSeconds(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}

function extractListFromData(json: any): any[] {
  if (!json) return [];
  const data = (json as any).data;
  if (Array.isArray(data)) return data;
  if (data && Array.isArray((data as any).list)) return (data as any).list;
  return [];
}

// ---------- MAIN ----------
serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dbErrors: string[] = [];

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

    const pageSize = 100;
    let pageIndex = 1;
    let totalInserted = 0;
    let totalRecords = 0;

    while (true) {
      // 2) body ให้เหมือนกับที่คุณใช้ใน Postman (เปลี่ยนช่วงเวลาเป็น fromTime/toTime)
      const bodyGetItems = {
        requestModel: {
          skuIds: [],
          itemIds: [],
          enabled: null,
          isNoQuerySkuCombine: true,
          modifiedBegin: toUnixSeconds(fromTime),
          modifiedEnd:   toUnixSeconds(toTime),
        },
        dataPage: {
          pageSize,
          pageIndex,
        },
      };

      const json = await callJst("/api/Goods/GetItemSkus", bodyGetItems);
      const list = extractListFromData(json);

      console.log(
        `GetItemSkus ${fromTime.toISOString()} - ${toTime.toISOString()}, page ${pageIndex}, got ${list.length}`,
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

      if (insertResp.error) {
        dbErrors.push(`insert products_raw: ${insertResp.error.message}`);
      } else {
        totalInserted += rows.length;
      }

      if (list.length < pageSize) break;
      pageIndex += 1;
    }

    // 3) update state
    const updateResp = await supabase
      .schema("jst_raw")
      .from("sync_state_products")
      .update({ last_synced_at: toTime.toISOString() })
      .eq("id", 1);

    if (updateResp.error) {
      dbErrors.push(`update sync_state_products: ${updateResp.error.message}`);
    }

    return new Response(
      JSON.stringify({
        message: "product sync done",
        fromTime,
        toTime,
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
