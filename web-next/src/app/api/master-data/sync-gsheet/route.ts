import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";
import { deriveVariationSku } from "@/lib/sku-utils";
import * as XLSX from "xlsx";

const GSHEET_ID = "10WIc5xJHaPbZoCTHPY0jAe2BA_2VkvH_jALTgZJ1-54";
const BRAND_SHEETS = ["DAYBREAK", "PAN", "HEELCARE", "ARENA"] as const;
const COL_SHEETS = ["DB_COL", "PN_COL", "HC_COL", "AN_COL"] as const;

/**
 * POST /api/master-data/sync-gsheet
 *
 * Downloads the Google Sheet, parses brand sheets (col A:J) + COL sheets,
 * then upserts into core.sku_pricing + core.pricing_rules.
 * The old core.master_* tables are archived (not deleted).
 */
export async function POST(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await checkRateLimit(`sync-gsheet:${getClientIp(req)}`, 5, 60_000);
  if (!ok) return NextResponse.json({ error: "rate limit" }, { status: 429 });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Download Google Sheet as XLSX
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/export?format=xlsx`;
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`Failed to download sheet: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array" });

    const stats = { pricing: 0, rules: 0, errors: [] as string[] };

    // 2. Parse brand sheets (col A:J) → sku_pricing
    // Header row 1: BRAND, GROUP, PARENTS_SKU, ITEM_SKU, DESCRIPTION, UPC, Price Tag, COGs (Ex.Vat), Vat, COGs (Inc.Vat)
    // Also grab pricing cols (W onwards): RRP, RSP, RSP%, A, %A, Mega, %Mega, FS, %FS, Min Price, Cost, Est. Margin
    const pricingRows: Record<string, unknown>[] = [];

    for (const sheetName of BRAND_SHEETS) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      for (let i = 2; i < data.length; i++) {
        const r = data[i];
        const brand = String(r[0] || "");
        const groupCode = String(r[1] || "");
        const parentsSku = String(r[2] || "");
        const itemSku = String(r[3] || "");
        const description = String(r[4] || "");
        if (!itemSku || !parentsSku) continue;

        const variationSku = deriveVariationSku(brand, itemSku, parentsSku);

        pricingRows.push({
          item_sku: itemSku,
          variation_sku: variationSku,
          parents_sku: parentsSku,
          brand,
          group_code: groupCode,
          description,
          price_tag: Number(r[6]) || null,
          cogs_ex_vat: Number(r[7]) || null,
          vat: Number(r[8]) || null,
          cogs_inc_vat: Number(r[9]) || null,
          // Pricing columns (W=22 onwards)
          rrp: Number(r[22]) || null,
          rsp: Number(r[23]) || null,
          price_campaign_a: Number(r[25]) || null,
          price_mega: Number(r[27]) || null,
          price_flash_sale: Number(r[29]) || null,
          min_price: Number(r[31]) || null,
          est_margin: Number(r[33]) || null,
        });
      }
    }

    // Upsert sku_pricing in batches
    const batchSize = 500;
    for (let i = 0; i < pricingRows.length; i += batchSize) {
      const batch = pricingRows.slice(i, i + batchSize);
      const { error } = await sb
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });
      if (error) stats.errors.push(`sku_pricing batch ${i}: ${error.message}`);
      else stats.pricing += batch.length;
    }

    // 3. Parse COL sheets → pricing_rules
    const rulesRows: Record<string, unknown>[] = [];

    for (const sheetName of COL_SHEETS) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      // Header: BRAND, GROUP, PARENTS_SKU, DESCRIPTION, CATEGORY, SUB-CATEGORY, COLLECTION, %RSP, %A, %Mega, %FS, %Est Margin

      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const parentsSku = String(r[2] || "") || null;
        if (!parentsSku && !r[4]) continue;

        // Derive variation_sku from first matching sku_pricing
        const matchingPricing = pricingRows.find(
          (p) => p.parents_sku === parentsSku && p.brand === String(r[0] || ""),
        );

        rulesRows.push({
          brand: String(r[0] || ""),
          collection_key: String(r[1] || "") || null,
          parents_sku: parentsSku,
          variation_sku: (matchingPricing as any)?.variation_sku || null,
          product_name: String(r[3] || "") || null,
          category: String(r[4] || "") || null,
          sub_category: String(r[5] || "") || null,
          collection: String(r[6] || "") || null,
          pct_rsp: Number(r[7]) || 1,
          pct_campaign_a: Number(r[8]) || 1,
          pct_mega: Number(r[9]) || 1,
          pct_flash_sale: Number(r[10]) || 1,
          pct_est_margin: Number(r[11]) || null,
        });
      }
    }

    // Delete old rules and insert new
    await sb.schema("core").from("pricing_rules").delete().gte("id", 0);
    for (let i = 0; i < rulesRows.length; i += batchSize) {
      const batch = rulesRows.slice(i, i + batchSize);
      const { error } = await sb.schema("core").from("pricing_rules").insert(batch);
      if (error) stats.errors.push(`pricing_rules batch ${i}: ${error.message}`);
      else stats.rules += batch.length;
    }

    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      pricing_rows: stats.pricing,
      rules_rows: stats.rules,
      errors: stats.errors.length > 0 ? stats.errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? "unknown" }, { status: 500 });
  }
}

/**
 * GET /api/master-data/sync-gsheet
 * Returns sync status
 */
export async function GET(req: NextRequest) {
  if (!(await isAuthenticated(req)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  return NextResponse.json({
    gsheet_id: GSHEET_ID,
    gsheet_url: `https://docs.google.com/spreadsheets/d/${GSHEET_ID}`,
    instructions: "POST to this endpoint to sync data from Google Sheet",
  });
}
