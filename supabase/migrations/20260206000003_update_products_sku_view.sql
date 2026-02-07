-- Point public.products_sku to core.master_pan (variation SKU)
CREATE OR REPLACE VIEW public.products_sku AS
SELECT "VARIATION_SKU" AS variation_sku
FROM core.master_pan;
