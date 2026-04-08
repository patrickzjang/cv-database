-- Master data from JST API (shops, warehouses, logistics)
CREATE TABLE IF NOT EXISTS jst_raw.shops_raw (
  shop_id bigint PRIMARY KEY,
  shop_name text,
  platform text,
  enabled boolean DEFAULT true,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jst_raw.warehouses_raw (
  warehouse_id bigint PRIMARY KEY,
  warehouse_name text,
  warehouse_type text,
  country text,
  province text,
  city text,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jst_raw.logistics_companies_raw (
  logistics_company_id bigint PRIMARY KEY,
  logistics_company_code text,
  logistics_company_name text,
  enabled boolean DEFAULT true,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now()
);

GRANT SELECT ON jst_raw.shops_raw TO service_role;
GRANT SELECT ON jst_raw.warehouses_raw TO service_role;
GRANT SELECT ON jst_raw.logistics_companies_raw TO service_role;
GRANT INSERT, UPDATE ON jst_raw.shops_raw TO service_role;
GRANT INSERT, UPDATE ON jst_raw.warehouses_raw TO service_role;
GRANT INSERT, UPDATE ON jst_raw.logistics_companies_raw TO service_role;
