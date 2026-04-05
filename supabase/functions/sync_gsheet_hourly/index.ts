import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY")!;
const GSHEET_ID = "10WIc5xJHaPbZoCTHPY0jAe2BA_2VkvH_jALTgZJ1-54";

const BRAND_SHEETS = ["DAYBREAK", "PAN", "HEELCARE", "ARENA"];
const COL_SHEETS = ["DB_COL", "PN_COL", "HC_COL", "AN_COL"];

function deriveVariation(brand: string, itemSku: string, parentSku: string): string {
  if (!itemSku) return "";
  if (brand === "DB") {
    return itemSku
      .replace(/(-\d{1,2}){1,2}$/, "")
      .replace(/-(0[SML]|XL|2L|00)$/, "");
  }
  if (parentSku && itemSku.length >= parentSku.length + 2) {
    return parentSku + itemSku.slice(parentSku.length, parentSku.length + 2);
  }
  return itemSku.slice(0, 9);
}

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 1. Download Google Sheet
    console.log("Downloading Google Sheet...");
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${GSHEET_ID}/export?format=xlsx`;
    const res = await fetch(sheetUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const buffer = await res.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    console.log("Sheets found:", wb.SheetNames.join(", "));

    // 2. Parse brand sheets → sku_pricing
    const pricingRows: Record<string, unknown>[] = [];

    for (const sheetName of BRAND_SHEETS) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      for (let i = 2; i < data.length; i++) {
        const r = data[i];
        const brand = String(r[0] || "");
        const parentsSku = String(r[2] || "");
        const itemSku = String(r[3] || "");
        if (!itemSku || !parentsSku) continue;

        pricingRows.push({
          item_sku: itemSku,
          variation_sku: deriveVariation(brand, itemSku, parentsSku),
          parents_sku: parentsSku,
          brand,
          group_code: String(r[1] || ""),
          description: String(r[4] || ""),
          price_tag: Number(r[6]) || null,
          cogs_ex_vat: Number(r[7]) || null,
          vat: Number(r[8]) || null,
          cogs_inc_vat: Number(r[9]) || null,
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

    console.log(`Parsed ${pricingRows.length} SKU pricing rows`);

    // 3. Parse COL sheets → pricing_rules
    const rulesRows: Record<string, unknown>[] = [];

    for (const sheetName of COL_SHEETS) {
      const ws = wb.Sheets[sheetName];
      if (!ws) continue;
      const data: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      for (let i = 1; i < data.length; i++) {
        const r = data[i];
        const parentsSku = String(r[2] || "") || null;
        if (!parentsSku && !r[4]) continue;

        const matchPricing = pricingRows.find(
          (p) => p.parents_sku === parentsSku && p.brand === String(r[0] || ""),
        );

        rulesRows.push({
          brand: String(r[0] || ""),
          collection_key: String(r[1] || "") || null,
          parents_sku: parentsSku,
          variation_sku: (matchPricing as any)?.variation_sku || null,
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

    console.log(`Parsed ${rulesRows.length} pricing rules`);

    // 4. Upsert sku_pricing
    let pricingUpserted = 0;
    const batchSize = 500;
    for (let i = 0; i < pricingRows.length; i += batchSize) {
      const batch = pricingRows.slice(i, i + batchSize);
      const { error } = await supabase
        .schema("core")
        .from("sku_pricing")
        .upsert(batch, { onConflict: "item_sku" });
      if (error) {
        console.error(`sku_pricing batch ${i}: ${error.message}`);
      } else {
        pricingUpserted += batch.length;
      }
    }

    // 5. Replace pricing_rules
    await supabase.schema("core").from("pricing_rules").delete().gte("id", 0);
    let rulesInserted = 0;
    for (let i = 0; i < rulesRows.length; i += batchSize) {
      const batch = rulesRows.slice(i, i + batchSize);
      const { error } = await supabase.schema("core").from("pricing_rules").insert(batch);
      if (error) {
        console.error(`pricing_rules batch ${i}: ${error.message}`);
      } else {
        rulesInserted += batch.length;
      }
    }

    const summary = {
      message: "Google Sheet sync done",
      synced_at: new Date().toISOString(),
      pricing_upserted: pricingUpserted,
      rules_inserted: rulesInserted,
      total_sheets: BRAND_SHEETS.length + COL_SHEETS.length,
    };

    console.log(JSON.stringify(summary));
    return new Response(JSON.stringify(summary), { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("SYNC_GSHEET_FATAL:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
