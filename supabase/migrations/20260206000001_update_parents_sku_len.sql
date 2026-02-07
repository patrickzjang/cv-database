-- Change parents_sku to first 9 chars
ALTER TABLE core.products
  DROP COLUMN parents_sku;

ALTER TABLE core.products
  ADD COLUMN parents_sku text
  GENERATED ALWAYS AS (left(sku_id, 9)) STORED;
