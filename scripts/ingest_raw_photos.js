#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  getDbPath,
  initDb,
  listFilesRecursive,
  normalizePathForDb,
  parseArgs,
  quoteSql,
  requireCommand,
  runSqlite,
  sha256File,
} = require("./photo_archive_lib");

function printHelp() {
  console.log(`Usage: node scripts/ingest_raw_photos.js --sku SKU --source /path/to/files [options]

Indexes RAW photos by SKU and optionally uploads them to object storage through rclone.

Required:
  --sku           SKU to associate with all discovered files
  --source        File or directory containing RAW images

Upload options:
  --remote        rclone remote name, for example b2-raw
  --bucket        Bucket/container name on the remote
  --prefix        Object key prefix. Default: raw
  --upload        Upload through rclone before updating the index

Metadata options:
  --captured-at   ISO-8601 capture timestamp to store on imported rows
  --db            Override SQLite database path
  --dry-run       Print the work without changing the DB or uploading
  --help          Show this message

Behavior:
  image_id is derived from the source filename without extension.
  Existing rows with the same sku + image_id are updated in place.`);
}

function buildObjectKey(prefix, sku, imageId, extension) {
  return `${prefix.replace(/\/+$/, "")}/${sku}/${imageId}${extension}`;
}

function ensureInputs(args) {
  if (!args.sku) throw new Error("--sku is required");
  if (!args.source) throw new Error("--source is required");
  if (args.upload && (!args.remote || !args.bucket)) {
    throw new Error("--upload requires both --remote and --bucket");
  }
}

function uploadWithRclone(sourcePath, remoteName, bucket, objectKey) {
  requireCommand("rclone", "install rclone to enable uploads");
  execFileSync("rclone", ["copyto", sourcePath, `${remoteName}:${bucket}/${objectKey}`], {
    stdio: "inherit",
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  ensureInputs(args);

  const dbPath = getDbPath(args);
  initDb(dbPath);

  const sourcePath = path.resolve(args.source);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source path not found: ${sourcePath}`);
  }

  const sku = String(args.sku).trim();
  const prefix = String(args.prefix || "raw");
  const files = listFilesRecursive(sourcePath).sort();
  if (files.length === 0) {
    throw new Error(`No files found under ${sourcePath}`);
  }

  let processed = 0;
  for (const filePath of files) {
    const filename = path.basename(filePath);
    const extension = path.extname(filename);
    const imageId = path.basename(filename, extension);
    const objectKey = buildObjectKey(prefix, sku, imageId, extension);
    const stat = fs.statSync(filePath);
    const checksum = await sha256File(filePath);

    if (args.dryRun) {
      console.log(
        JSON.stringify(
          {
            sku,
            imageId,
            filename,
            objectKey,
            sizeBytes: stat.size,
            checksumSha256: checksum,
            upload: Boolean(args.upload),
          },
          null,
          2
        )
      );
      processed += 1;
      continue;
    }

    if (args.upload) {
      uploadWithRclone(filePath, args.remote, args.bucket, objectKey);
    }

    runSqlite(
      dbPath,
      `INSERT INTO raw_images (
        sku,
        image_id,
        object_key,
        filename,
        extension,
        size_bytes,
        checksum_sha256,
        storage_provider,
        storage_bucket,
        remote_name,
        source_path,
        captured_at,
        updated_at
      ) VALUES (
        ${quoteSql(sku)},
        ${quoteSql(imageId)},
        ${quoteSql(objectKey)},
        ${quoteSql(filename)},
        ${quoteSql(extension)},
        ${stat.size},
        ${quoteSql(checksum)},
        ${quoteSql(args.upload ? "object-storage" : "local-only")},
        ${quoteSql(args.bucket || null)},
        ${quoteSql(args.remote || null)},
        ${quoteSql(normalizePathForDb(filePath))},
        ${quoteSql(args["captured-at"] || null)},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(sku, image_id) DO UPDATE SET
        object_key = excluded.object_key,
        filename = excluded.filename,
        extension = excluded.extension,
        size_bytes = excluded.size_bytes,
        checksum_sha256 = excluded.checksum_sha256,
        storage_provider = excluded.storage_provider,
        storage_bucket = excluded.storage_bucket,
        remote_name = excluded.remote_name,
        source_path = excluded.source_path,
        captured_at = excluded.captured_at,
        updated_at = CURRENT_TIMESTAMP;`
    );

    processed += 1;
    console.log(`Indexed ${sku} ${filename}`);
  }

  console.log(`Processed ${processed} file(s) into ${dbPath}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
