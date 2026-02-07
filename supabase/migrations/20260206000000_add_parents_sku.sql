-- Make sku_id text and add parents_sku (first 7 chars)
ALTER TABLE core.products
  ALTER COLUMN sku_id TYPE text USING sku_id::text;

ALTER TABLE core.products
  ADD COLUMN IF NOT EXISTS parents_sku text
  GENERATED ALWAYS AS (left(sku_id, 7)) STORED;
