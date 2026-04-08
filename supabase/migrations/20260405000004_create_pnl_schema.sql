-- Platform fee configuration for P&L calculations
CREATE TABLE IF NOT EXISTS core.platform_fee_config (
  id bigserial PRIMARY KEY,
  platform_name text UNIQUE NOT NULL,
  commission_rate numeric DEFAULT 0,
  service_fee_rate numeric DEFAULT 0,
  payment_fee_rate numeric DEFAULT 0,
  shipping_subsidy_rate numeric DEFAULT 0,
  other_fee_rate numeric DEFAULT 0,
  notes text,
  updated_at timestamptz DEFAULT now()
);

-- Pre-populate with typical Thai e-commerce rates
INSERT INTO core.platform_fee_config (platform_name, commission_rate, service_fee_rate, payment_fee_rate) VALUES
  ('Shopee', 0.065, 0.025, 0.02),
  ('Lazada', 0.05, 0.02, 0.02),
  ('TikTok Shop', 0.04, 0.03, 0.02),
  ('Shopify', 0, 0, 0.029)
ON CONFLICT (platform_name) DO NOTHING;

-- Shopee income data (from GetOrderIncomes API, retained ~1 week)
CREATE TABLE IF NOT EXISTS jst_raw.order_income_raw (
  id bigserial PRIMARY KEY,
  order_id bigint,
  platform_order_id text,
  shop_id int,
  shop_name text,
  escrow_amount numeric,
  buyer_total numeric,
  original_price numeric,
  commission_fee numeric,
  service_fee numeric,
  transaction_fee numeric,
  seller_discount numeric,
  platform_discount numeric,
  shipping_fee_paid numeric,
  shipping_rebate numeric,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(platform_order_id)
);

CREATE TABLE IF NOT EXISTS jst_raw.sync_state_income (
  id int PRIMARY KEY DEFAULT 1,
  last_synced_at timestamptz DEFAULT now() - interval '7 days'
);
INSERT INTO jst_raw.sync_state_income VALUES (1, now() - interval '7 days')
  ON CONFLICT (id) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON core.platform_fee_config TO service_role;
GRANT SELECT, INSERT, UPDATE ON jst_raw.order_income_raw TO service_role;
GRANT SELECT, UPDATE ON jst_raw.sync_state_income TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.platform_fee_config_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE jst_raw.order_income_raw_id_seq TO service_role;
