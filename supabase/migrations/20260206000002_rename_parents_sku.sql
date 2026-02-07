-- Rename parents_sku to variation_sku and update view
DROP VIEW IF EXISTS public.products_sku;

ALTER TABLE core.products
  RENAME COLUMN parents_sku TO variation_sku;

CREATE VIEW public.products_sku AS
SELECT variation_sku
FROM core.products;
