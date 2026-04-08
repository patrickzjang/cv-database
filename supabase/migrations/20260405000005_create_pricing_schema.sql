-- Collection-level pricing rules (replaces COL sheets: DB_COL, PN_COL, HC_COL, AN_COL)
CREATE TABLE IF NOT EXISTS core.pricing_rules (
  id bigserial PRIMARY KEY,
  brand text NOT NULL,
  collection_key text,
  parents_sku text,
  product_name text,
  category text,
  sub_category text,
  collection text,
  pct_rsp numeric DEFAULT 1,
  pct_campaign_a numeric DEFAULT 1,
  pct_mega numeric DEFAULT 1,
  pct_flash_sale numeric DEFAULT 1,
  pct_est_margin numeric,
  updated_by text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(brand, parents_sku)
);

-- SKU-level pricing (replaces computed columns in master sheets)
CREATE TABLE IF NOT EXISTS core.sku_pricing (
  id bigserial PRIMARY KEY,
  item_sku text NOT NULL,
  variation_sku text NOT NULL,
  parents_sku text NOT NULL,
  brand text NOT NULL,
  group_code text,
  description text,
  price_tag numeric,
  cogs_ex_vat numeric,
  vat numeric,
  cogs_inc_vat numeric,
  rrp numeric,
  rsp numeric,
  price_campaign_a numeric,
  price_mega numeric,
  price_flash_sale numeric,
  min_price numeric,
  est_margin numeric,
  updated_by text,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(item_sku)
);

-- Platform SKU mapping (replaces SKU sheets)
CREATE TABLE IF NOT EXISTS core.platform_sku_mapping (
  id bigserial PRIMARY KEY,
  item_sku text NOT NULL,
  brand text NOT NULL,
  platform text NOT NULL,
  platform_sku text,
  platform_product_id text,
  platform_option_id text,
  listing_status text GENERATED ALWAYS AS (
    CASE WHEN platform_sku IS NOT NULL THEN 'listed' ELSE 'not_listed' END
  ) STORED,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(item_sku, platform)
);

-- Price change audit trail
CREATE TABLE IF NOT EXISTS core.sku_pricing_history (
  id bigserial PRIMARY KEY,
  item_sku text,
  field_name text,
  old_value numeric,
  new_value numeric,
  changed_by text,
  changed_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_item_sku ON core.sku_pricing(item_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_variation ON core.sku_pricing(variation_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_parents ON core.sku_pricing(parents_sku);
CREATE INDEX IF NOT EXISTS idx_pricing_brand ON core.sku_pricing(brand);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_brand ON core.pricing_rules(brand);
CREATE INDEX IF NOT EXISTS idx_pricing_rules_parents ON core.pricing_rules(parents_sku);
CREATE INDEX IF NOT EXISTS idx_platform_mapping_sku ON core.platform_sku_mapping(item_sku);
CREATE INDEX IF NOT EXISTS idx_platform_mapping_platform ON core.platform_sku_mapping(platform);
CREATE INDEX IF NOT EXISTS idx_pricing_history_sku ON core.sku_pricing_history(item_sku);

GRANT SELECT, INSERT, UPDATE, DELETE ON core.pricing_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.sku_pricing TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.platform_sku_mapping TO service_role;
GRANT SELECT, INSERT ON core.sku_pricing_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.pricing_rules_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.sku_pricing_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.platform_sku_mapping_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.sku_pricing_history_id_seq TO service_role;
