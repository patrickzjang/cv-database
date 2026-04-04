-- Inventory data synced from JST
CREATE TABLE IF NOT EXISTS jst_raw.inventory_raw (
  id bigserial PRIMARY KEY,
  sku_id text NOT NULL,
  sku_code text,
  item_id text,
  item_name text,
  warehouse_id bigint,
  warehouse_name text,
  available_qty int DEFAULT 0,
  actual_qty int DEFAULT 0,
  defective_qty int DEFAULT 0,
  locked_qty int DEFAULT 0,
  cost_price numeric,
  raw_json jsonb,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(sku_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS jst_raw.inventory_history (
  id bigserial PRIMARY KEY,
  sku_id text NOT NULL,
  warehouse_id bigint,
  available_qty int,
  snapshot_date date DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jst_raw.sync_state_inventory (
  id int PRIMARY KEY DEFAULT 1,
  last_synced_at timestamptz DEFAULT now() - interval '24 hours'
);
INSERT INTO jst_raw.sync_state_inventory VALUES (1, now() - interval '24 hours')
  ON CONFLICT (id) DO NOTHING;

-- Reorder alert configuration
CREATE TABLE IF NOT EXISTS core.reorder_config (
  id bigserial PRIMARY KEY,
  sku_code text NOT NULL,
  brand text,
  min_stock int DEFAULT 10,
  reorder_qty int DEFAULT 50,
  lead_days int DEFAULT 7,
  updated_at timestamptz DEFAULT now(),
  UNIQUE(sku_code)
);

CREATE INDEX IF NOT EXISTS idx_inventory_raw_sku ON jst_raw.inventory_raw(sku_id);
CREATE INDEX IF NOT EXISTS idx_inventory_raw_warehouse ON jst_raw.inventory_raw(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_history_sku_date ON jst_raw.inventory_history(sku_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_reorder_config_sku ON core.reorder_config(sku_code);

-- Inventory RPC functions
CREATE OR REPLACE FUNCTION jst_raw.inventory_summary(
  p_brand text DEFAULT NULL,
  p_warehouse_id bigint DEFAULT NULL,
  p_low_stock_only boolean DEFAULT false
)
RETURNS TABLE (
  sku_id text, sku_code text, item_name text,
  warehouse_id bigint, warehouse_name text,
  available_qty int, actual_qty int, defective_qty int, locked_qty int,
  cost_price numeric, min_stock int, reorder_qty int,
  stock_status text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw, core
AS $$
  SELECT
    i.sku_id, i.sku_code, i.item_name,
    i.warehouse_id, i.warehouse_name,
    i.available_qty, i.actual_qty, i.defective_qty, i.locked_qty,
    i.cost_price,
    COALESCE(rc.min_stock, 10) AS min_stock,
    COALESCE(rc.reorder_qty, 50) AS reorder_qty,
    CASE
      WHEN i.available_qty <= 0 THEN 'out_of_stock'
      WHEN i.available_qty <= COALESCE(rc.min_stock, 10) THEN 'low_stock'
      ELSE 'in_stock'
    END AS stock_status
  FROM jst_raw.inventory_raw i
  LEFT JOIN core.reorder_config rc ON rc.sku_code = i.sku_code
  WHERE (p_warehouse_id IS NULL OR i.warehouse_id = p_warehouse_id)
    AND (NOT p_low_stock_only OR i.available_qty <= COALESCE(rc.min_stock, 10))
  ORDER BY i.available_qty ASC;
$$;

GRANT SELECT, INSERT, UPDATE ON jst_raw.inventory_raw TO service_role;
GRANT SELECT, INSERT ON jst_raw.inventory_history TO service_role;
GRANT SELECT, UPDATE ON jst_raw.sync_state_inventory TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.reorder_config TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.inventory_summary(text, bigint, boolean) TO service_role;
GRANT USAGE, SELECT ON SEQUENCE jst_raw.inventory_raw_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE jst_raw.inventory_history_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE core.reorder_config_id_seq TO service_role;
