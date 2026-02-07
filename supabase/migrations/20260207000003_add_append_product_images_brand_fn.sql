-- Brand-aware append function
CREATE OR REPLACE FUNCTION public.append_product_images_brand(brand text, variation_sku text, urls text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing jsonb;
  merged jsonb;
BEGIN
  IF brand = 'PAN' THEN
    SELECT COALESCE(product_images, '[]'::jsonb)
      INTO existing
      FROM core.master_pan
      WHERE "VARIATION_SKU" = variation_sku
      LIMIT 1;

    IF existing IS NULL THEN
      RAISE EXCEPTION 'VARIATION_SKU not found';
    END IF;

    merged := (
      SELECT jsonb_agg(DISTINCT value)
      FROM (
        SELECT value FROM jsonb_array_elements_text(existing)
        UNION ALL
        SELECT unnest(urls)
      ) s
    );

    UPDATE core.master_pan
    SET product_images = COALESCE(merged, '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;

  ELSIF brand = 'ARENA' THEN
    SELECT COALESCE(product_images, '[]'::jsonb)
      INTO existing
      FROM core.master_arena
      WHERE "VARIATION_SKU" = variation_sku
      LIMIT 1;

    IF existing IS NULL THEN
      RAISE EXCEPTION 'VARIATION_SKU not found';
    END IF;

    merged := (
      SELECT jsonb_agg(DISTINCT value)
      FROM (
        SELECT value FROM jsonb_array_elements_text(existing)
        UNION ALL
        SELECT unnest(urls)
      ) s
    );

    UPDATE core.master_arena
    SET product_images = COALESCE(merged, '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;

  ELSIF brand = 'DAYBREAK' THEN
    SELECT COALESCE(product_images, '[]'::jsonb)
      INTO existing
      FROM core.master_daybreak
      WHERE "VARIATION_SKU" = variation_sku
      LIMIT 1;

    IF existing IS NULL THEN
      RAISE EXCEPTION 'VARIATION_SKU not found';
    END IF;

    merged := (
      SELECT jsonb_agg(DISTINCT value)
      FROM (
        SELECT value FROM jsonb_array_elements_text(existing)
        UNION ALL
        SELECT unnest(urls)
      ) s
    );

    UPDATE core.master_daybreak
    SET product_images = COALESCE(merged, '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;

  ELSIF brand = 'HEELCARE' THEN
    SELECT COALESCE(product_images, '[]'::jsonb)
      INTO existing
      FROM core.master_heelcare
      WHERE "VARIATION_SKU" = variation_sku
      LIMIT 1;

    IF existing IS NULL THEN
      RAISE EXCEPTION 'VARIATION_SKU not found';
    END IF;

    merged := (
      SELECT jsonb_agg(DISTINCT value)
      FROM (
        SELECT value FROM jsonb_array_elements_text(existing)
        UNION ALL
        SELECT unnest(urls)
      ) s
    );

    UPDATE core.master_heelcare
    SET product_images = COALESCE(merged, '[]'::jsonb)
    WHERE "VARIATION_SKU" = variation_sku;
  ELSE
    RAISE EXCEPTION 'Unknown brand';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_product_images_brand(text, text, text[]) TO anon, authenticated;
