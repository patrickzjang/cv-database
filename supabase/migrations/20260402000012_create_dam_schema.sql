-- ─────────────────────────────────────────────────────────────────────────────
-- DAM (Digital Asset Management) schema
-- Assets: images + videos linked to product SKUs
-- Storage: Cloudflare R2 (raw) + Cloudflare Stream (video delivery)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS dam;

-- ─── Assets ──────────────────────────────────────────────────────────────────
CREATE TABLE dam.assets (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sku              TEXT        NOT NULL,                -- VARIATION_SKU (9 chars)
  brand            TEXT        NOT NULL,                -- PAN | ARENA | DAYBREAK | HEELCARE
  asset_type       TEXT        NOT NULL
                   CHECK (asset_type IN ('image','video')),

  -- Raw / original file (Cloudflare R2 dam-raw-assets bucket)
  raw_bucket       TEXT,
  raw_path         TEXT,                               -- e.g. images/PAN/SKU123/file.CR3
  raw_filename     TEXT,
  raw_mime_type    TEXT,
  raw_size_bytes   BIGINT,

  -- Web-delivery file
  -- Images: R2 dam-web-assets bucket  /  Videos: Cloudflare Stream
  web_bucket       TEXT,
  web_path         TEXT,                               -- R2 path for processed image

  -- Thumbnail (R2 path or CF Stream auto-generated URL)
  thumbnail_path   TEXT,

  -- Cloudflare Stream (video only)
  stream_uid       TEXT,                               -- CF Stream video UID
  stream_status    TEXT                                -- pendingupload|waiting|processing|ready|error
                   CHECK (stream_status IS NULL OR stream_status IN
                     ('pendingupload','waiting','processing','ready','error')),
  stream_hls_url   TEXT,
  stream_thumbnail_url TEXT,
  duration_sec     NUMERIC(10,3),

  -- Image dimensions
  width_px         INTEGER,
  height_px        INTEGER,

  -- DAM workflow
  status           TEXT        NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','processing','ready','approved','archived')),

  -- Metadata
  title            TEXT,
  notes            TEXT,
  captured_at      TIMESTAMPTZ,
  tags             TEXT[]      NOT NULL DEFAULT '{}',

  -- Audit (simple username strings — upgrade to FK when multi-user auth is added)
  uploaded_by      TEXT,
  approved_by      TEXT,
  approved_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dam_assets_sku_idx        ON dam.assets (sku);
CREATE INDEX dam_assets_brand_idx      ON dam.assets (brand);
CREATE INDEX dam_assets_status_idx     ON dam.assets (status);
CREATE INDEX dam_assets_type_idx       ON dam.assets (asset_type);
CREATE INDEX dam_assets_created_idx    ON dam.assets (created_at DESC);
CREATE INDEX dam_assets_stream_uid_idx ON dam.assets (stream_uid)
  WHERE stream_uid IS NOT NULL;

-- ─── Asset events (audit log) ─────────────────────────────────────────────────
CREATE TABLE dam.asset_events (
  id         BIGSERIAL   PRIMARY KEY,
  asset_id   UUID        NOT NULL REFERENCES dam.assets (id) ON DELETE CASCADE,
  actor      TEXT,                                     -- username
  event      TEXT        NOT NULL,
  -- uploaded_raw | uploaded_web | approved | rejected | archived
  -- downloaded_raw | downloaded_web | stream_ready | stream_error
  metadata   JSONB       NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX dam_events_asset_id_idx ON dam.asset_events (asset_id);
CREATE INDEX dam_events_created_idx  ON dam.asset_events (created_at DESC);

-- ─── updated_at trigger ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION dam.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER assets_updated_at
  BEFORE UPDATE ON dam.assets
  FOR EACH ROW EXECUTE FUNCTION dam.set_updated_at();

-- ─── Permissions ─────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA dam TO service_role;
GRANT ALL   ON ALL TABLES    IN SCHEMA dam TO service_role;
GRANT ALL   ON ALL SEQUENCES IN SCHEMA dam TO service_role;
GRANT ALL   ON ALL ROUTINES  IN SCHEMA dam TO service_role;
