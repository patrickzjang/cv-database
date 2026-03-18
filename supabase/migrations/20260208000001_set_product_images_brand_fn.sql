-- Set product_images for a brand + variation_sku
CREATE OR REPLACE FUNCTION public.set_product_images_brand(brand text, variation_sku text, urls text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF brand = 'PAN' THEN
    UPDATE core.master_pan
    SET product_images = COALESCE(to_jsonb(urls), '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;
  ELSIF brand = 'ARENA' THEN
    UPDATE core.master_arena
    SET product_images = COALESCE(to_jsonb(urls), '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;
  ELSIF brand = 'DAYBREAK' THEN
    UPDATE core.master_daybreak
    SET product_images = COALESCE(to_jsonb(urls), '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;
  ELSIF brand = 'HEELCARE' THEN
    UPDATE core.master_heelcare
    SET product_images = COALESCE(to_jsonb(urls), '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;
  ELSE
    RAISE EXCEPTION 'Unknown brand';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_product_images_brand(text, text, text[]) TO anon, authenticated;
