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

// Columns W:AH = indices 22-33 in 0-based
// W=RRP, X=RSP, Y=RSP%, Z=A, AA=%A, AB=Mega, AC=%Mega, AD=FS, AE=%FS, AF=Min Price, AG=Cost, AH=Est. Margin
const PRICE_START_COL = "W";
const PRICE_END_COL = "AH";

async function getGoogleAuth() {
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
 * Write pricing data from Supabase back to Google Sheet columns W:AH
 * for each brand sheet.
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
          .select("item_sku, rrp, rsp, price_campaign_a, price_mega, price_flash_sale, min_price, cogs_inc_vat, est_margin")
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

      // 3. Build values array matching sheet row order
      // Columns: W=RRP, X=RSP, Y=RSP%, Z=A, AA=%A, AB=Mega, AC=%Mega, AD=FS, AE=%FS, AF=Min Price, AG=Cost, AH=Est. Margin
      const values: (string | number | null)[][] = [];
      for (const sku of sheetSkus) {
        const p = pricingMap.get(sku);
        if (!p) {
          values.push(["", "", "", "", "", "", "", "", "", "", "", ""]);
          continue;
        }

        // Find matching pricing rule for %RSP, %A, %Mega, %FS
        // For now, calculate % from RRP
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
        const margin = p.est_margin ?? "";

        values.push([
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

      // 4. Write to Google Sheet
      await sheets.spreadsheets.values.update({
        spreadsheetId: GSHEET_ID,
        range: `${sheetName}!${PRICE_START_COL}3:${PRICE_END_COL}${sheetSkus.length + 2}`,
        valueInputOption: "RAW",
        requestBody: { values },
      });

      stats[sheetName] = values.filter((v) => v[0] !== "").length;
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
