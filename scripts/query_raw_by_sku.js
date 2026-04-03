#!/usr/bin/env node

const { getDbPath, initDb, parseArgs, quoteSql, runSqlite } = require("./photo_archive_lib");

function printHelp() {
  console.log(`Usage: node scripts/query_raw_by_sku.js --sku SKU [options]

Queries the RAW image index for one SKU.

Options:
  --sku       SKU to query
  --db        Override SQLite database path
  --json      Return JSON output
  --help      Show this message`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.sku) {
    throw new Error("--sku is required");
  }

  const dbPath = getDbPath(args);
  initDb(dbPath);

  const sql = `SELECT
    sku,
    image_id,
    object_key,
    filename,
    size_bytes,
    checksum_sha256,
    storage_provider,
    storage_bucket,
    remote_name,
    source_path,
    captured_at,
    updated_at
  FROM raw_images_by_sku
  WHERE sku = ${quoteSql(args.sku)};`;

  const output = runSqlite(dbPath, sql, { json: Boolean(args.json), header: !args.json, csv: !args.json });
  console.log(output || (args.json ? "[]" : ""));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
