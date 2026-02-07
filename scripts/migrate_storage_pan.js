const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.BUCKET || "product-images";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
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

async function moveObject(fromPath, toPath) {
  const { error } = await supabase.storage.from(BUCKET).move(fromPath, toPath);
  if (error) throw error;
}

(async () => {
  console.log("Listing top-level folders...");
  const top = await listAll("");
  const folders = top.filter((x) => x.name && x.metadata === null);

  for (const folder of folders) {
    const sku = folder.name;
    if (["PAN", "ARENA", "DAYBREAK", "HEELCARE"].includes(sku)) continue;

    const files = await listAll(sku);
    for (const f of files) {
      if (!f.name) continue;
      const fromPath = `${sku}/${f.name}`;
      const toPath = `PAN/${sku}/${f.name}`;
      console.log(`Move ${fromPath} -> ${toPath}`);
      await moveObject(fromPath, toPath);
    }
  }

  console.log("Done.");
})();
