-- Suppliers synced from JST
CREATE TABLE IF NOT EXISTS jst_raw.suppliers_raw (
  supplier_id bigint,
  supplier_code text PRIMARY KEY,
  supplier_name text,
  contact_name text,
  contact_phone text,
  address text,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON jst_raw.suppliers_raw TO service_role;
