const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DB_PATH = path.join(ROOT, "data", "photo-archive", "index.sqlite");
const DEFAULT_SCHEMA_PATH = path.join(ROOT, "sql", "photo_archive_schema.sql");

function kebabToCamel(s) {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseArgs(argv) {
  const args = { _: [] };

  function set(key, value) {
    args[key] = value;
    // Also expose a camelCase alias so --dry-run sets both args['dry-run'] and args.dryRun
    const camel = kebabToCamel(key);
    if (camel !== key) args[camel] = value;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      args._.push(token);
      continue;
    }

    const [flag, inlineValue] = token.split("=", 2);
    const key = flag.slice(2);
    if (inlineValue !== undefined) {
      set(key, inlineValue);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      set(key, true);
      continue;
    }

    set(key, next);
    i += 1;
  }

  return args;
}

function getDbPath(args) {
  return path.resolve(args.db || process.env.PHOTO_ARCHIVE_DB || DEFAULT_DB_PATH);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function runSqlite(dbPath, sql, options = {}) {
  ensureParentDir(dbPath);
  const result = spawnSync("sqlite3", [dbPath, ...buildSqliteArgs(options), sql], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "sqlite3 command failed");
  }

  return result.stdout.trim();
}

function buildSqliteArgs(options) {
  const args = [];
  args.push("-cmd", ".timeout 5000");
  if (options.json) args.push("-json");
  if (options.header) args.push("-header");
  if (options.csv) args.push("-csv");
  if (options.noHeader) args.push("-noheader");
  return args;
}

function initDb(dbPath, schemaPath = DEFAULT_SCHEMA_PATH) {
  ensureParentDir(dbPath);
  const schemaSql = fs.readFileSync(schemaPath, "utf8");
  runSqlite(dbPath, schemaSql);
}

function quoteSql(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function listFilesRecursive(targetPath) {
  const stat = fs.statSync(targetPath);
  if (stat.isFile()) return [targetPath];

  const files = [];
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function normalizePathForDb(filePath) {
  const relative = path.relative(ROOT, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function requireCommand(commandName, hint) {
  const result = spawnSync("which", [commandName], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${commandName} is required${hint ? ` (${hint})` : ""}`);
  }
}

module.exports = {
  DEFAULT_DB_PATH,
  DEFAULT_SCHEMA_PATH,
  ROOT,
  ensureParentDir,
  getDbPath,
  initDb,
  listFilesRecursive,
  normalizePathForDb,
  parseArgs,
  quoteSql,
  requireCommand,
  runSqlite,
  sha256File,
};
