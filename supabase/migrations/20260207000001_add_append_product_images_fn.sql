-- Update core.master_pan product_images via SECURITY DEFINER function in public schema
CREATE OR REPLACE FUNCTION public.append_product_images(variation_sku text, urls text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  existing jsonb;
  merged jsonb;
BEGIN
  SELECT COALESCE(product_images, '[]'::jsonb)
    INTO existing
    FROM core.master_pan
    WHERE "VARIATION_SKU" = variation_sku
    LIMIT 1;

  IF existing IS NULL THEN
    RAISE EXCEPTION 'VARIATION_SKU not found';
  END IF;

  -- Merge existing jsonb array with new urls, remove duplicates
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
END;
$$;

-- Allow anon/authenticated to call the function
GRANT EXECUTE ON FUNCTION public.append_product_images(text, text[]) TO anon, authenticated;
