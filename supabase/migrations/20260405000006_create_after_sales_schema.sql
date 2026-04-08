-- After-sale orders synced from JST
CREATE TABLE IF NOT EXISTS jst_raw.after_sale_orders_raw (
  after_sale_order_id bigint PRIMARY KEY,
  order_id bigint,
  platform_order_id text,
  shop_id int,
  shop_name text,
  warehouse_id bigint,
  after_sale_type text,
  question_type text,
  status text,
  platform_refund_status text,
  remark text,
  items_raw jsonb,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now()
);

-- Customer-initiated return requests (before pushing to JST)
CREATE TABLE IF NOT EXISTS core.return_requests (
  id bigserial PRIMARY KEY,
  tracking_code text UNIQUE NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12),
  platform_order_id text NOT NULL,
  customer_name text,
  customer_phone text,
  customer_email text,
  brand text,
  reason text NOT NULL,
  description text,
  items jsonb,
  photo_urls text[],
  status text DEFAULT 'submitted' CHECK (status IN (
    'submitted','reviewing','approved','rejected',
    'processing','shipped','completed','cancelled'
  )),
  internal_notes text,
  jst_after_sale_id bigint,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jst_raw.sync_state_after_sales (
  id int PRIMARY KEY DEFAULT 1,
  last_synced_at timestamptz DEFAULT now() - interval '24 hours'
);
INSERT INTO jst_raw.sync_state_after_sales VALUES (1, now() - interval '24 hours')
  ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_after_sale_order_id ON jst_raw.after_sale_orders_raw(order_id);
CREATE INDEX IF NOT EXISTS idx_after_sale_platform ON jst_raw.after_sale_orders_raw(platform_order_id);
CREATE INDEX IF NOT EXISTS idx_return_tracking ON core.return_requests(tracking_code);
CREATE INDEX IF NOT EXISTS idx_return_platform_order ON core.return_requests(platform_order_id);
CREATE INDEX IF NOT EXISTS idx_return_status ON core.return_requests(status);

GRANT SELECT, INSERT, UPDATE ON jst_raw.after_sale_orders_raw TO service_role;
GRANT SELECT, INSERT, UPDATE ON core.return_requests TO service_role;
GRANT SELECT, UPDATE ON jst_raw.sync_state_after_sales TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.return_requests_id_seq TO service_role;
