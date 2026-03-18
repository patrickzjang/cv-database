#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const BASE_DIR = path.resolve(__dirname, "../supabase/updatefile/masterproduct");
const STATE_PATH = path.join(BASE_DIR, ".import-state.json");
const FILE_RE = /^MASTER_(PAN|ARENA|DAYBREAK|HEELCARE)_(\d{6})\.csv$/i;
const BRAND_TABLE = {
  PAN: "master_pan",
  ARENA: "master_arena",
  DAYBREAK: "master_daybreak",
  HEELCARE: "master_heelcare",
};
const DEFAULT_SCHEMA_CANDIDATES = ["jst_core", "jst_raw", "public"];

const REQUIRED_COLUMNS = [
  "BRAND",
  "GROUP",
  "PARENTS_SKU",
  "VARIATION_SKU",
  "ITEM_SKU",
  "DESCRIPTION",
  "BARCODE",
  "PRICELIST",
  "CBV",
  "VAT",
  "COST",
  "YEAR",
  "MONTH",
];
const INSERT_COLUMN_CANDIDATES = [
  "BRAND",
  "GROUP",
  "PARENTS_SKU",
  "VARIATION_SKU",
  "ITEM_SKU",
  "DESCRIPTION",
  "BARCODE",
  "PRICELIST",
  "CBV",
  "VAT",
  "COST",
  "YEAR",
  "MONTH",
  "product_images",
];

function parseDateKey(ddmmyy) {
  const dd = Number(ddmmyy.slice(0, 2));
  const mm = Number(ddmmyy.slice(2, 4));
  const yy = Number(ddmmyy.slice(4, 6));
  if (!dd || !mm) return null;
  const yyyy = 2000 + yy;
  return `${yyyy.toString().padStart(4, "0")}${mm.toString().padStart(2, "0")}${dd.toString().padStart(2, "0")}`;
}

function getLatestFilesByBrand() {
  const entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
  const latest = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(FILE_RE);
    if (!m) continue;
    const brand = m[1].toUpperCase();
    const ddmmyy = m[2];
    const dateKey = parseDateKey(ddmmyy);
    if (!dateKey) continue;
    if (!latest[brand] || dateKey > latest[brand].dateKey) {
      latest[brand] = {
        brand,
        filename: entry.name,
        fullPath: path.join(BASE_DIR, entry.name),
        ddmmyy,
        dateKey,
      };
    }
  }

  return latest;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function normalizeHeader(h) {
  const raw = h.replace(/^\uFEFF/, "").trim().toUpperCase();
  if (raw === "BEFORE VAT") return "CBV";
  return raw;
}

function toValue(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  return s;
}

function normalizeNumericString(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s.replace(/,/g, "");
  return cleaned;
}

function readCsvRows(filePath, brand) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error(`CSV has no data rows: ${filePath}`);
  }

  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new Error(`Missing required column(s) in ${path.basename(filePath)}: ${missing.join(", ")}`);
  }

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (const col of REQUIRED_COLUMNS) {
      row[col] = toValue(cells[idx[col]]);
    }

    if (!row.BRAND) row.BRAND = brand;
    if (!row.ITEM_SKU || !row.VARIATION_SKU) continue;
    rows.push(row);
  }

  return rows;
}

function readCsvPreview(filePath, brand, sampleSize = 5) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error(`CSV has no data rows: ${filePath}`);
  }
  const headers = parseCsvLine(lines[0]).map(normalizeHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
  if (missing.length > 0) {
    throw new Error(`Missing required column(s) in ${path.basename(filePath)}: ${missing.join(", ")}`);
  }
  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));
  const previewRows = [];
  for (let i = 1; i < lines.length && previewRows.length < sampleSize; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (const col of REQUIRED_COLUMNS) {
      row[col] = toValue(cells[idx[col]]);
    }
    if (!row.BRAND) row.BRAND = brand;
    if (!row.ITEM_SKU || !row.VARIATION_SKU) continue;
    previewRows.push(row);
  }
  return { headers, previewRows };
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function decodeJwtRole(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const payload = parts[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
    const obj = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
    return obj?.role || null;
  } catch {
    return null;
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function fetchImageMap(client, schemaName, tableName) {
  const map = new Map();
  let from = 0;
  const step = 1000;
  while (true) {
    const { data, error } = await client
      .schema(schemaName)
      .from(tableName)
      .select("ITEM_SKU,product_images")
      .range(from, from + step - 1);

    if (error) {
      throw new Error(`Failed to read existing images from ${schemaName}.${tableName}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const key = r.ITEM_SKU ? String(r.ITEM_SKU) : null;
      if (!key) continue;
      map.set(key, Array.isArray(r.product_images) ? r.product_images : []);
    }
    if (data.length < step) break;
    from += step;
  }
  return map;
}

async function fetchExistingRows(client, schemaName, tableName, columns) {
  const map = new Map();
  let from = 0;
  const step = 1000;
  const selectCols = Array.from(new Set(["ITEM_SKU", ...columns])).join(",");
  while (true) {
    const { data, error } = await client
      .schema(schemaName)
      .from(tableName)
      .select(selectCols)
      .range(from, from + step - 1);

    if (error) {
      throw new Error(`Failed to read existing rows from ${schemaName}.${tableName}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const row of data) {
      const key = row.ITEM_SKU ? String(row.ITEM_SKU) : null;
      if (!key) continue;
      map.set(key, row);
    }
    if (data.length < step) break;
    from += step;
  }
  return map;
}

function valuesEqual(a, b) {
  if (a === null || a === undefined || a === "") return b === null || b === undefined || b === "";
  if (b === null || b === undefined || b === "") return false;
  return String(a) === String(b);
}

async function replaceTableRows(client, brand, fileInfo) {
  const table = BRAND_TABLE[brand];
  const rows = readCsvRows(fileInfo.fullPath, brand);
  if (rows.length === 0) {
    throw new Error(`No valid rows for ${brand} in ${fileInfo.filename}`);
  }

  const readTarget = await resolveDataTarget(client, brand);
  const writeTarget = await resolveWriteTarget(client, readTarget, brand);
  const imageMap = await fetchImageMap(client, readTarget.schemaName, readTarget.tableName);
  const writableColumns = await resolveWritableColumns(client, writeTarget.schemaName, writeTarget.tableName);
  if (!writableColumns.has("ITEM_SKU") || !writableColumns.has("VARIATION_SKU")) {
    throw new Error(
      `Target ${writeTarget.schemaName}.${writeTarget.tableName} is missing required ITEM_SKU or VARIATION_SKU columns`
    );
  }
  const payload = rows.map((r) => {
    const base = {
      BRAND: r.BRAND,
      GROUP: r.GROUP,
      PARENTS_SKU: r.PARENTS_SKU,
      VARIATION_SKU: r.VARIATION_SKU,
      ITEM_SKU: r.ITEM_SKU,
      DESCRIPTION: r.DESCRIPTION,
      BARCODE: r.BARCODE,
      PRICELIST: normalizeNumericString(r.PRICELIST),
      CBV: normalizeNumericString(r.CBV),
      VAT: normalizeNumericString(r.VAT),
      COST: normalizeNumericString(r.COST),
      YEAR: normalizeNumericString(r.YEAR),
      MONTH: normalizeNumericString(r.MONTH),
      product_images: imageMap.get(String(r.ITEM_SKU)) || [],
    };
    const out = {};
    for (const col of INSERT_COLUMN_CANDIDATES) {
      if (writableColumns.has(col)) out[col] = base[col];
    }
    return out;
  });

  const existingRows = await fetchExistingRows(
    client,
    writeTarget.schemaName,
    writeTarget.tableName,
    Array.from(writableColumns)
  );

  const toInsert = [];
  const toUpdate = [];
  let unchanged = 0;

  for (const row of payload) {
    const key = String(row.ITEM_SKU || "");
    if (!key) continue;
    const existing = existingRows.get(key);
    if (!existing) {
      toInsert.push(row);
      continue;
    }
    const patch = {};
    for (const [col, val] of Object.entries(row)) {
      if (col === "ITEM_SKU") continue;
      if (!valuesEqual(existing[col], val)) {
        patch[col] = val;
      }
    }
    if (Object.keys(patch).length > 0) {
      toUpdate.push({ itemSku: key, patch });
    } else {
      unchanged += 1;
    }
  }

  const chunk = 500;
  for (let i = 0; i < toInsert.length; i += chunk) {
    const part = toInsert.slice(i, i + chunk);
    const { error: insError } = await client.schema(writeTarget.schemaName).from(writeTarget.tableName).insert(part);
    if (insError) {
      throw new Error(
        `Insert failed on ${writeTarget.schemaName}.${writeTarget.tableName} chunk ${i / chunk + 1}: ${insError.message}`
      );
    }
  }

  for (let i = 0; i < toUpdate.length; i += 1) {
    const op = toUpdate[i];
    const { error: updError } = await client
      .schema(writeTarget.schemaName)
      .from(writeTarget.tableName)
      .update(op.patch)
      .eq("ITEM_SKU", op.itemSku);
    if (updError) {
      throw new Error(
        `Update failed on ${writeTarget.schemaName}.${writeTarget.tableName} ITEM_SKU=${op.itemSku}: ${updError.message}`
      );
    }
  }

  return {
    total: payload.length,
    inserted: toInsert.length,
    updated: toUpdate.length,
    unchanged,
  };
}

async function resolveDataTarget(client, brand) {
  const envSchema = (process.env.MASTER_DATA_SCHEMA || "").trim();
  const envTable = (process.env.MASTER_DATA_TABLE || "").trim();
  const candidates = envSchema ? [envSchema] : DEFAULT_SCHEMA_CANDIDATES;
  const baseTable = BRAND_TABLE[brand];
  const tableCandidates = envTable
    ? [envTable]
    : [baseTable, `${baseTable}_public`];
  let lastErr = null;

  for (const schemaName of candidates) {
    for (const tableName of tableCandidates) {
      const { error } = await client.schema(schemaName).from(tableName).select("ITEM_SKU").limit(1);
      if (!error) return { schemaName, tableName };
      lastErr = error;
    }
  }

  throw new Error(
    `Cannot access brand ${brand} from schema candidates (${candidates.join(", ")}) and table candidates (${tableCandidates.join(", ")}): ${lastErr?.message || "unknown error"}`
  );
}

async function resolveWriteTarget(client, readTarget, brand) {
  const envSchema = (process.env.MASTER_DATA_SCHEMA || "").trim();
  const envTable = (process.env.MASTER_DATA_TABLE || "").trim();
  const schemaCandidates = envSchema
    ? [envSchema]
    : [readTarget.schemaName, "jst_core", "jst_raw", "public"];

  const tableCandidates = [];
  if (envTable && !envTable.endsWith("_public")) tableCandidates.push(envTable);
  if (!readTarget.tableName.endsWith("_public")) tableCandidates.push(readTarget.tableName);
  tableCandidates.push(BRAND_TABLE[brand]);
  if (readTarget.tableName.endsWith("_public")) {
    tableCandidates.push(readTarget.tableName.replace(/_public$/i, ""));
  }
  // Final fallback: write through detected read view if base tables are not exposed in API.
  tableCandidates.push(readTarget.tableName);

  const seen = new Set();
  const uniqueSchemas = [];
  for (const s of schemaCandidates) {
    if (!s || seen.has(s)) continue;
    seen.add(s);
    uniqueSchemas.push(s);
  }
  let lastErr = null;
  for (const schemaName of uniqueSchemas) {
    for (const tableName of tableCandidates) {
      const { error } = await client.schema(schemaName).from(tableName).select("ITEM_SKU").limit(1);
      if (!error) return { schemaName, tableName };
      lastErr = error;
    }
  }

  throw new Error(
    `Cannot resolve writable table for brand ${brand}. Tried schemas (${uniqueSchemas.join(", ")}) and tables (${tableCandidates.join(", ")}): ${lastErr?.message || "unknown error"}`
  );
}

async function resolveWritableColumns(client, schemaName, tableName) {
  const set = new Set();
  for (const col of INSERT_COLUMN_CANDIDATES) {
    const { error } = await client.schema(schemaName).from(tableName).select(col).limit(1);
    if (!error) set.add(col);
  }
  return set;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const previewMode = process.argv.includes("--preview");
  const latest = getLatestFilesByBrand();
  const state = loadState();

  let client = null;
  if (!dryRun && !previewMode) {
    const url = process.env.SUPABASE_URL || "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!url || !key) {
      throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running this script.");
    }
    const role = decodeJwtRole(key);
    if (role && role !== "service_role") {
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY is not a service role token (detected role: ${role}). Please set the real service_role key.`
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }

  const brands = Object.keys(BRAND_TABLE);
  for (const brand of brands) {
    const f = latest[brand];
    if (!f) {
      console.log(`[${brand}] No file found, skipped.`);
      continue;
    }
    const prev = state[brand]?.dateKey || "00000000";
    if (f.dateKey <= prev) {
      console.log(`[${brand}] ${f.filename} is not newer than last import (${prev}), skipped.`);
      continue;
    }

    if (previewMode) {
      const { headers, previewRows } = readCsvPreview(f.fullPath, brand, 5);
      console.log(`\n[${brand}] PREVIEW`);
      console.log(`- file: ${f.filename}`);
      console.log(`- file date key: ${f.dateKey}`);
      console.log(`- previous imported date key: ${prev}`);
      console.log("- decision: APPLY");
      console.log(`- mapped headers: ${headers.join(", ")}`);
      console.log("- sample rows (up to 5):");
      for (const r of previewRows) {
        console.log(`  ${JSON.stringify(r)}`);
      }
      continue;
    }

    if (dryRun) {
      const rows = readCsvRows(f.fullPath, brand);
      console.log(`[${brand}] DRY-RUN would import ${rows.length} rows from ${f.filename}.`);
      continue;
    }

    const result = await replaceTableRows(client, brand, f);
    state[brand] = {
      file: f.filename,
      dateKey: f.dateKey,
      importedAt: new Date().toISOString(),
      rowCount: result.total,
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
    };
    console.log(
      `[${brand}] Imported ${result.total} rows from ${f.filename} (inserted=${result.inserted}, updated=${result.updated}, unchanged=${result.unchanged}).`
    );
  }

  if (!dryRun && !previewMode) {
    saveState(state);
    console.log(`State updated: ${STATE_PATH}`);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
