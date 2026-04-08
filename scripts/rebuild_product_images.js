const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUCKET || "product-images";
const BRAND = (process.env.BRAND || "PAN").toUpperCase();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const brandTableMap = {
  PAN: "master_pan",
  ARENA: "master_arena",
  DAYBREAK: "master_daybreak",
  HEELCARE: "master_heelcare",
};

const brandsToRun = BRAND === "ALL"
  ? Object.keys(brandTableMap)
  : [BRAND];

for (const b of brandsToRun) {
  if (!brandTableMap[b]) {
    console.error("Unknown BRAND. Use PAN, ARENA, DAYBREAK, HEELCARE, or ALL");
    process.exit(1);
  }
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function listAll(prefix = "") {
  const results = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .list(prefix, { limit, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    if (!data || data.length === 0) break;
    results.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return results;
}

async function listSkusForBrand(brand) {
  const folders = await listAll(brand);
  return folders.filter((x) => x.name && x.metadata === null).map((x) => x.name);
}

async function listFilesForSku(brand, sku) {
  const files = await listAll(`${brand}/${sku}`);
  return files.filter((f) => f.name).map((f) => f.name);
}

async function updateRow(brand, sku, urls) {
  const { error } = await supabase.rpc("set_product_images_brand", {
    brand,
    variation_sku: sku,
    urls,
  });
  if (error) throw error;
}

(async () => {
  const baseUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}`;

  try {
    for (const brand of brandsToRun) {
      console.log(`Rebuilding product_images for brand ${brand}...`);
      const skus = await listSkusForBrand(brand);
      if (skus.length === 0) {
        console.log(`No SKU folders found for ${brand}.`);
        continue;
      }

      for (const sku of skus) {
        const names = await listFilesForSku(brand, sku);
        const urls = names.map((n) => `${baseUrl}/${brand}/${sku}/${n}`);
        await updateRow(brand, sku, urls);
        console.log(`Updated ${brand}/${sku} (${urls.length} images)`);
      }
    }

    console.log("Done.");
  } catch (err) {
    console.error("Rebuild failed:", err);
    process.exit(1);
  }
})();
