import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/server-supabase";
import { createClient } from "@supabase/supabase-js";
import { deriveVariationSku } from "@/lib/sku-utils";
import * as XLSX from "xlsx";

const GSHEET_ID = "10WIc5xJHaPbZoCTHPY0jAe2BA_2VkvH_jALTgZJ1-54";
const BRAND_SHEETS = ["DAYBREAK", "PAN", "HEELCARE", "ARENA"] as const;

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

    // 2. Parse brand sheets col A:J (product data) + col N:U (platform IDs)
    // Pricing columns (W:AH) are NOT synced — managed in Pricing Rules UI only
    // COL sheets are NOT synced — one-time import only
    const pricingRows: Record<string, unknown>[] = [];
    const platformMappingRows: Record<string, unknown>[] = [];

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

        // Only sync col A:J (product master data) — prices are managed in the system
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
        });

        // Platform IDs from brand sheet col N-U (13-20)
        // N=13: Shopee Product ID, O=14: Shopee SKU ID
        // P=15: Lazada Product ID, Q=16: Lazada SKU ID
        // R=17: TTS Product ID,    S=18: TTS SKU ID
        // T=19: Shopify Product ID, U=20: Shopify SKU ID
        const platformCols: [string, number, number][] = [
          ["shopee", 13, 14],
          ["lazada", 15, 16],
          ["tiktok", 17, 18],
          ["shopify", 19, 20],
        ];
        for (const [platform, pidCol, skuCol] of platformCols) {
          const rawPid = r[pidCol];
          const rawSid = r[skuCol];
          // Convert to string — handle 0 (number) properly
          const pid = rawPid != null && rawPid !== "" ? String(rawPid) : "";
          const sid = rawSid != null && rawSid !== "" ? String(rawSid) : "";
          // Skip only #N/A or truly empty
          if (pid === "#N/A" || pid === "") continue;
          platformMappingRows.push({
            item_sku: itemSku,
            brand,
            platform,
            platform_sku: itemSku,
            platform_product_id: pid,
            platform_option_id: sid !== "#N/A" ? sid : "",
          });
        }
      }
    }

    // Deduplicate by item_sku (keep last occurrence)
    const deduped = new Map<string, Record<string, unknown>>();
    for (const row of pricingRows) {
      deduped.set(row.item_sku as string, row);
    }
    const uniquePricing = [...deduped.values()];

    // Upsert sku_pricing in batches
    const batchSize = 500;
    for (let i = 0; i < uniquePricing.length; i += batchSize) {
      const batch = uniquePricing.slice(i, i + batchSize);
      const { error } = await sb
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });
      if (error) stats.errors.push(`sku_pricing batch ${i}: ${error.message}`);
      else stats.pricing += batch.length;
    }

    // 2b. Upsert platform_sku_mapping (from brand sheets col N-U only — single source of truth)
    // Deduplicate by (item_sku, platform)
    const mappingDeduped = new Map<string, Record<string, unknown>>();
    for (const row of platformMappingRows) {
      mappingDeduped.set(`${row.item_sku}:${row.platform}`, row);
    }
    const uniqueMapping = [...mappingDeduped.values()];

    // Delete old and insert fresh
    await sb.schema("core").from("platform_sku_mapping").delete().gte("id", 0);
    let mappingInserted = 0;
    for (let i = 0; i < uniqueMapping.length; i += batchSize) {
      const batch = uniqueMapping.slice(i, i + batchSize);
      const { error } = await sb.schema("core").from("platform_sku_mapping").insert(batch);
      if (error) stats.errors.push(`platform_mapping batch ${i}: ${error.message}`);
      else mappingInserted += batch.length;
    }

    // 3. COL sheets (pricing_rules) — NOT synced
    // Pricing rules are managed in the Pricing Rules UI only (one-time import done)

    return NextResponse.json({
      ok: true,
      synced_at: new Date().toISOString(),
      pricing_rows: stats.pricing,
      mapping_rows: mappingInserted,
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
