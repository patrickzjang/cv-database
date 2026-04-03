PRAGMA busy_timeout = 5000;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS raw_images (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL,
  image_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  checksum_sha256 TEXT NOT NULL,
  storage_provider TEXT NOT NULL,
  storage_bucket TEXT,
  remote_name TEXT,
  source_path TEXT NOT NULL,
  captured_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (sku, image_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_images_sku ON raw_images (sku);
CREATE INDEX IF NOT EXISTS idx_raw_images_checksum ON raw_images (checksum_sha256);

CREATE VIEW IF NOT EXISTS raw_images_by_sku AS
SELECT
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
  created_at,
  updated_at
FROM raw_images
ORDER BY sku, image_id;
