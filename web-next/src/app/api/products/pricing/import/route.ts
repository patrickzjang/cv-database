import { NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { isAuthenticated } from "@/lib/auth";
import { isMaintenanceMode } from "@/lib/maintenance";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, requireServerConfig } from "@/lib/server-supabase";
import { deriveVariationSku } from "@/lib/sku-utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

// Brand sheet names for sku_pricing detection
const BRAND_SHEETS = new Set(["DAYBREAK", "PAN", "HEELCARE", "ARENA", "DB", "PN", "HC", "AN"]);
// COL pattern for pricing_rules detection
const COL_PATTERN = /^(DB|PN|HC|AN|JN)_COL$/i;
// SKU pattern for platform_sku_mapping detection
const SKU_PATTERN = /^(DB|PN|HC|AN|JN)_SKU$/i;

// Brand code to full brand name
const CODE_TO_BRAND: Record<string, string> = {
  DB: "DAYBREAK",
  PN: "PAN",
  JN: "PAN",
  HC: "HEELCARE",
  AN: "ARENA",
};

function normalizeBrand(name: string): string {
  const upper = name.toUpperCase();
  return CODE_TO_BRAND[upper] ?? upper;
}

function safeNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = Number(val);
  return Number.isNaN(n) ? null : n;
}

function safeStr(val: unknown): string | null {
  if (val == null || val === "") return null;
  return String(val).trim();
}

function extractBrandCode(sheetName: string, pattern: RegExp): string {
  const m = sheetName.match(pattern);
  return m ? m[1].toUpperCase() : "";
}

// POST: Import pricing data from XLSX/CSV
export async function POST(req: Request) {
  try {
    if (isMaintenanceMode()) {
      return NextResponse.json({ error: "Maintenance mode." }, { status: 503 });
    }
    if (!isAuthenticated(req)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const ip = getClientIp(req);
    if (!await checkRateLimit(`pricing:import:${ip}`, 20, 60_000)) {
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }

    requireServerConfig();

    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file." }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetNames = workbook.SheetNames;

    if (sheetNames.length === 0) {
      return NextResponse.json({ error: "Workbook has no sheets." }, { status: 400 });
    }

    // Detect import type
    const hasBrandSheets = sheetNames.some((n) => BRAND_SHEETS.has(n.toUpperCase()));
    const hasColSheets = sheetNames.some((n) => COL_PATTERN.test(n));
    const hasSkuSheets = sheetNames.some((n) => SKU_PATTERN.test(n));

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // --- Type 1: sku_pricing import ---
    if (hasBrandSheets) {
      return await importSkuPricing(workbook, sheetNames, supabase);
    }

    // --- Type 2: pricing_rules import (COL sheets) ---
    if (hasColSheets) {
      return await importPricingRules(workbook, sheetNames, supabase);
    }

    // --- Type 3: platform_sku_mapping import (SKU sheets) ---
    if (hasSkuSheets) {
      return await importPlatformMapping(workbook, sheetNames, supabase);
    }

    return NextResponse.json({
      error: "Could not detect import type. Expected brand sheets (DAYBREAK, PAN, etc.), COL sheets (DB_COL, PN_COL), or SKU sheets (DB_SKU, PN_SKU).",
    }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function importSkuPricing(
  workbook: XLSX.WorkBook,
  sheetNames: string[],
  supabase: AnySupabaseClient,
) {
  const now = new Date().toISOString();
  let total = 0;
  let upserted = 0;

  for (const name of sheetNames) {
    if (!BRAND_SHEETS.has(name.toUpperCase())) continue;

    const brand = normalizeBrand(name);
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    total += rows.length;

    const items = rows
      .filter((r) => r.ITEM_SKU || r.item_sku)
      .map((r) => {
        const itemSku = safeStr(r.ITEM_SKU ?? r.item_sku) ?? "";
        const parentsSku = safeStr(r.PARENTS_SKU ?? r.parents_sku) ?? "";
        const variationSku = safeStr(r.VARIATION_SKU ?? r.variation_sku)
          || deriveVariationSku(name.toUpperCase(), itemSku, parentsSku);

        return {
          item_sku: itemSku,
          variation_sku: variationSku || null,
          parents_sku: parentsSku || null,
          brand,
          group_code: safeStr(r.GROUP_CODE ?? r.group_code),
          description: safeStr(r.DESCRIPTION ?? r.description ?? r.ITEM_DESCRIPTION),
          price_tag: safeNum(r.PRICE_TAG ?? r.price_tag),
          cogs_ex_vat: safeNum(r.COGS_EX_VAT ?? r.cogs_ex_vat ?? r["COGS EX VAT"]),
          vat: safeNum(r.VAT ?? r.vat),
          cogs_inc_vat: safeNum(r.COGS_INC_VAT ?? r.cogs_inc_vat ?? r["COGS INC VAT"]),
          rrp: safeNum(r.RRP ?? r.rrp),
          rsp: safeNum(r.RSP ?? r.rsp),
          price_campaign_a: safeNum(r.PRICE_CAMPAIGN_A ?? r.price_campaign_a ?? r["CAMPAIGN A"]),
          price_mega: safeNum(r.PRICE_MEGA ?? r.price_mega ?? r.MEGA),
          price_flash_sale: safeNum(r.PRICE_FLASH_SALE ?? r.price_flash_sale ?? r["FLASH SALE"]),
          min_price: safeNum(r.MIN_PRICE ?? r.min_price ?? r["MIN PRICE"]),
          est_margin: safeNum(r.EST_MARGIN ?? r.est_margin ?? r["EST MARGIN"]),
          updated_at: now,
        };
      })
      .filter((i) => i.item_sku);

    if (items.length === 0) continue;

    // Upsert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const { error } = await supabase
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });

      if (error) {
        return NextResponse.json({
          error: `Error importing ${name}: ${error.message}`,
          partialUpserted: upserted,
        }, { status: 500 });
      }
      upserted += batch.length;
    }
  }

  return NextResponse.json({
    ok: true,
    type: "sku_pricing",
    total,
    upserted,
  });
}

async function importPricingRules(
  workbook: XLSX.WorkBook,
  sheetNames: string[],
  supabase: AnySupabaseClient,
) {
  const now = new Date().toISOString();
  let total = 0;
  let upserted = 0;

  for (const name of sheetNames) {
    if (!COL_PATTERN.test(name)) continue;

    const code = extractBrandCode(name, COL_PATTERN);
    const brand = normalizeBrand(code);
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    total += rows.length;

    for (const r of rows) {
      const { error } = await supabase.schema("core").rpc("upsert_pricing_rule", {
        p_brand: brand,
        p_collection_key: safeStr(r.COLLECTION_KEY ?? r.collection_key),
        p_parents_sku: safeStr(r.PARENTS_SKU ?? r.parents_sku),
        p_product_name: safeStr(r.PRODUCT_NAME ?? r.product_name),
        p_category: safeStr(r.CATEGORY ?? r.category),
        p_sub_category: safeStr(r.SUB_CATEGORY ?? r.sub_category),
        p_collection: safeStr(r.COLLECTION ?? r.collection),
        p_pct_rsp: safeNum(r.PCT_RSP ?? r.pct_rsp ?? r["%RSP"]),
        p_pct_campaign_a: safeNum(r.PCT_CAMPAIGN_A ?? r.pct_campaign_a ?? r["%CAMPAIGN A"]),
        p_pct_mega: safeNum(r.PCT_MEGA ?? r.pct_mega ?? r["%MEGA"]),
        p_pct_flash_sale: safeNum(r.PCT_FLASH_SALE ?? r.pct_flash_sale ?? r["%FLASH SALE"]),
        p_updated_at: now,
      });

      if (!error) {
        upserted++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    type: "pricing_rules",
    total,
    upserted,
  });
}

async function importPlatformMapping(
  workbook: XLSX.WorkBook,
  sheetNames: string[],
  supabase: AnySupabaseClient,
) {
  const now = new Date().toISOString();
  let total = 0;
  let upserted = 0;

  for (const name of sheetNames) {
    if (!SKU_PATTERN.test(name)) continue;

    const code = extractBrandCode(name, SKU_PATTERN);
    const brand = normalizeBrand(code);
    const sheet = workbook.Sheets[name];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    total += rows.length;

    const mappings = rows
      .filter((r) => r.ITEM_SKU || r.item_sku)
      .map((r) => ({
        item_sku: safeStr(r.ITEM_SKU ?? r.item_sku) ?? "",
        brand,
        platform: safeStr(r.PLATFORM ?? r.platform) ?? "",
        platform_sku: safeStr(r.PLATFORM_SKU ?? r.platform_sku),
        platform_product_id: safeStr(r.PLATFORM_PRODUCT_ID ?? r.platform_product_id),
        platform_option_id: safeStr(r.PLATFORM_OPTION_ID ?? r.platform_option_id),
        listing_status: safeStr(r.LISTING_STATUS ?? r.listing_status) ?? "active",
        updated_at: now,
      }))
      .filter((m) => m.item_sku && m.platform);

    if (mappings.length === 0) continue;

    const batchSize = 500;
    for (let i = 0; i < mappings.length; i += batchSize) {
      const batch = mappings.slice(i, i + batchSize);
      const { error } = await supabase
        .schema("core")
        .from("platform_sku_mapping")
        .upsert(batch, { onConflict: "item_sku,platform" });

      if (error) {
        return NextResponse.json({
          error: `Error importing ${name}: ${error.message}`,
          partialUpserted: upserted,
        }, { status: 500 });
      }
      upserted += batch.length;
    }
  }

  return NextResponse.json({
    ok: true,
    type: "platform_sku_mapping",
    total,
    upserted,
  });
}
