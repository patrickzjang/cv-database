-- Add indexes on VARIATION_SKU for all brand master tables.
-- The search API filters and sorts by this column heavily, and the variation
-- views use SELECT DISTINCT on it. Without indexes these queries do a full
-- table scan and will get slower as data grows.

CREATE INDEX IF NOT EXISTS idx_master_pan_variation_sku
  ON core.master_pan ("VARIATION_SKU");

CREATE INDEX IF NOT EXISTS idx_master_arena_variation_sku
  ON core.master_arena ("VARIATION_SKU");

CREATE INDEX IF NOT EXISTS idx_master_daybreak_variation_sku
  ON core.master_daybreak ("VARIATION_SKU");

CREATE INDEX IF NOT EXISTS idx_master_heelcare_variation_sku
  ON core.master_heelcare ("VARIATION_SKU");

-- Also index ITEM_SKU used heavily in master-upload lookups and upserts.
CREATE INDEX IF NOT EXISTS idx_master_pan_item_sku
  ON core.master_pan ("ITEM_SKU");

CREATE INDEX IF NOT EXISTS idx_master_arena_item_sku
  ON core.master_arena ("ITEM_SKU");

CREATE INDEX IF NOT EXISTS idx_master_daybreak_item_sku
  ON core.master_daybreak ("ITEM_SKU");

CREATE INDEX IF NOT EXISTS idx_master_heelcare_item_sku
  ON core.master_heelcare ("ITEM_SKU");
