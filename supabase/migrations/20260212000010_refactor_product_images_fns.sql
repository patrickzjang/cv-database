-- Refactor append_product_images_brand and set_product_images_brand to use
-- dynamic SQL instead of copy-pasted IF/ELSIF blocks for each brand.
--
-- Previously adding a new brand required manually editing these functions and
-- repeating ~20 lines. Now any brand that has a core.<brand_lower> table is
-- supported automatically.

CREATE OR REPLACE FUNCTION public.append_product_images_brand(
  brand        text,
  variation_sku text,
  urls         text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, core
AS $$
DECLARE
  v_table  text;
  existing jsonb;
  merged   jsonb;
BEGIN
  -- Derive table name from brand: e.g. 'PAN' → core.master_pan
  v_table := 'core.master_' || lower(brand);

  -- Validate that the table exists to prevent SQL injection via brand param.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'core'
      AND table_name   = 'master_' || lower(brand)
  ) THEN
    RAISE EXCEPTION 'Unknown brand: %', brand;
  END IF;

  EXECUTE format(
    'SELECT COALESCE(product_images, ''[]''::jsonb)
       FROM %I.%I
      WHERE "VARIATION_SKU" = $1
      LIMIT 1',
    'core', 'master_' || lower(brand)
  ) INTO existing USING variation_sku;

  IF existing IS NULL THEN
    RAISE EXCEPTION 'VARIATION_SKU not found: %', variation_sku;
  END IF;

  -- Merge existing array with new URLs, removing duplicates.
  SELECT jsonb_agg(DISTINCT value)
  INTO merged
  FROM (
    SELECT value FROM jsonb_array_elements_text(existing)
    UNION ALL
    SELECT unnest(urls)
  ) s;

  EXECUTE format(
    'UPDATE %I.%I SET product_images = $1 WHERE "VARIATION_SKU" = $2',
    'core', 'master_' || lower(brand)
  ) USING COALESCE(merged, '[]'::jsonb), variation_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_product_images_brand(text, text, text[]) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.set_product_images_brand(
  brand        text,
  variation_sku text,
  urls         text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, core
AS $$
BEGIN
  -- Validate brand.
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'core'
      AND table_name   = 'master_' || lower(brand)
  ) THEN
    RAISE EXCEPTION 'Unknown brand: %', brand;
  END IF;

  EXECUTE format(
    'UPDATE %I.%I SET product_images = $1 WHERE "VARIATION_SKU" = $2',
    'core', 'master_' || lower(brand)
  ) USING COALESCE(to_jsonb(urls), '[]'::jsonb), variation_sku;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_product_images_brand(text, text, text[]) TO anon, authenticated;
