import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import path from "path";

const GSHEET_ID = "10WIc5xJHaPbZoCTHPY0jAe2BA_2VkvH_jALTgZJ1-54";

// Brand sheet name → brand codes in DB
const SHEET_BRAND_MAP: Record<string, string[]> = {
  DAYBREAK: ["DB"],
  PAN: ["JN", "PN", "PAN"],
  HEELCARE: ["HC"],
  ARENA: ["AN"],
};

async function getGoogleAuth() {
  // Prefer env var (Vercel), fall back to file (local dev)
  const envJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (envJson) {
    const credentials = JSON.parse(envJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    return auth;
  }
  const keyPath = path.join(process.cwd(), "google-service-account.json");
  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return auth;
}

/**
 * POST /api/master-data/write-gsheet
 *
 * Push data from Supabase back to Google Sheet brand sheets.
 * Brand sheets have NO formulas — all data comes from the system:
 *  - K:M  = Category, Collection, SIZE
 *  - N:U  = Platform IDs (Shopee, Lazada, TikTok, Shopify)
 *  - W:AH = Pricing (RRP, RSP, campaigns, margins)
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`write-gsheet:${getClientIp(req)}`, 3, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const auth = await getGoogleAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const stats: Record<string, number> = {};

    for (const [sheetName, brandCodes] of Object.entries(SHEET_BRAND_MAP)) {
      // 1. Read ITEM_SKU from column D of the sheet to know row order
      const readRes = await sheets.spreadsheets.values.get({
        spreadsheetId: GSHEET_ID,
        range: `${sheetName}!D3:D10000`, // Start from row 3 (after 2 header rows)
      });
      const sheetSkus = (readRes.data.values ?? []).map((r) => String(r[0] || ""));

      if (sheetSkus.length === 0) {
        stats[sheetName] = 0;
        continue;
      }

      // 2. Fetch pricing data from Supabase for these brands
      const allPricing: any[] = [];
      let offset = 0;
      while (true) {
        const { data: batch } = await sb
          .schema("core")
          .from("sku_pricing")
          .select("item_sku, category, collection, size, rrp, rsp, price_campaign_a, price_mega, price_flash_sale, min_price, cogs_inc_vat, est_margin")
          .in("brand", brandCodes)
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        allPricing.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      // Build lookup by item_sku
      const pricingMap = new Map<string, any>();
      for (const p of allPricing) {
        pricingMap.set(p.item_sku, p);
      }

      // 3. Fetch platform mappings for these brands
      const allMappings: any[] = [];
      offset = 0;
      while (true) {
        const { data: batch } = await sb
          .schema("core")
          .from("platform_sku_mapping")
          .select("item_sku, platform, platform_product_id, platform_option_id")
          .in("brand", brandCodes)
          .range(offset, offset + 999);
        if (!batch || batch.length === 0) break;
        allMappings.push(...batch);
        if (batch.length < 1000) break;
        offset += 1000;
      }

      // Build platform mapping lookup: item_sku → { shopee: {pid, sid}, lazada: ... }
      const platformMap = new Map<string, Record<string, { pid: string; sid: string }>>();
      for (const m of allMappings) {
        if (!platformMap.has(m.item_sku)) platformMap.set(m.item_sku, {});
        const entry = platformMap.get(m.item_sku)!;
        entry[m.platform] = {
          pid: m.platform_product_id ?? "",
          sid: m.platform_option_id ?? "",
        };
      }

      // 4. Build values for K:M (Category, Collection, SIZE)
      const kmValues: (string | number | null)[][] = [];
      // 5. Build values for N:U (Platform IDs)
      const nuValues: (string | number | null)[][] = [];
      // 6. Build values for W:AH (Pricing)
      const wahValues: (string | number | null)[][] = [];

      for (const sku of sheetSkus) {
        const p = pricingMap.get(sku);
        const pm = platformMap.get(sku) ?? {};

        // K:M — Category, Collection, SIZE
        kmValues.push([
          p?.category ?? "",   // K
          p?.collection ?? "", // L
          p?.size ?? "",       // M
        ]);

        // N:U — Platform IDs
        // N=Shopee Product ID, O=Shopee SKU ID
        // P=Lazada Product ID, Q=Lazada SKU ID
        // R=TikTok Product ID, S=TikTok SKU ID
        // T=Shopify Product ID, U=Shopify SKU ID
        const shopee = pm.shopee ?? { pid: "", sid: "" };
        const lazada = pm.lazada ?? { pid: "", sid: "" };
        const tiktok = pm.tiktok ?? { pid: "", sid: "" };
        const shopify = pm.shopify ?? { pid: "", sid: "" };
        nuValues.push([
          shopee.pid, shopee.sid,
          lazada.pid, lazada.sid,
          tiktok.pid, tiktok.sid,
          shopify.pid, shopify.sid,
        ]);

        // W:AH — Pricing
        if (!p) {
          wahValues.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
          continue;
        }

        const rrp = p.rrp ?? "";
        const rsp = p.rsp ?? "";
        const rspPct = rrp && rsp ? p.rsp / p.rrp : "";
        const campA = p.price_campaign_a ?? "";
        const campAPct = rrp && campA ? p.price_campaign_a / p.rrp : "";
        const mega = p.price_mega ?? "";
        const megaPct = rrp && mega ? p.price_mega / p.rrp : "";
        const fs = p.price_flash_sale ?? "";
        const fsPct = rrp && fs ? p.price_flash_sale / p.rrp : "";
        const minPrice = p.min_price ?? "";
        const cost = p.cogs_inc_vat ?? "";
        // est_margin is stored as percentage number (e.g. 4 = 4%)
        // Google Sheet has % format which multiplies by 100, so we divide by 100 first
        const margin = p.est_margin != null ? p.est_margin / 100 : "";

        wahValues.push([
          rrp,      // W: RRP
          rsp,      // X: RSP
          rspPct,   // Y: RSP%
          campA,    // Z: A
          campAPct, // AA: %A
          mega,     // AB: Mega
          megaPct,  // AC: %Mega
          fs,       // AD: FS
          fsPct,    // AE: %FS
          minPrice, // AF: Min Price
          cost,     // AG: Cost
          margin,   // AH: Est. Margin
        ]);
      }

      const lastRow = sheetSkus.length + 2;

      // 7. Write all ranges to Google Sheet in parallel (batchUpdate)
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: GSHEET_ID,
        requestBody: {
          valueInputOption: "RAW",
          data: [
            {
              range: `${sheetName}!K3:M${lastRow}`,
              values: kmValues,
            },
            {
              range: `${sheetName}!N3:U${lastRow}`,
              values: nuValues,
            },
            {
              range: `${sheetName}!W3:AH${lastRow}`,
              values: wahValues,
            },
          ],
        },
      });

      stats[sheetName] = wahValues.filter((v) => v[0] !== "").length;
    }

    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      written: stats,
    });
  } catch (e: any) {
    console.error("write-gsheet error:", e);
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}
