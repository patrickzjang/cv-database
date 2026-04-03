#!/usr/bin/env node

const { DEFAULT_SCHEMA_PATH, getDbPath, initDb, parseArgs } = require("./photo_archive_lib");

function printHelp() {
  console.log(`Usage: node scripts/init_photo_archive.js [--db path]

Creates the SQLite database used to index RAW photo files by SKU.

Options:
  --db       Override the SQLite database path
  --help     Show this message

Defaults:
  db         ${getDbPath({})}
  schema     ${DEFAULT_SCHEMA_PATH}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dbPath = getDbPath(args);
  initDb(dbPath);
  console.log(`Initialized photo archive database at ${dbPath}`);
}

main();
