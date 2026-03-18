-- Lock search_path for SECURITY DEFINER functions to avoid mutable-path warnings
-- and reduce risk of object name hijacking.
ALTER FUNCTION public.append_product_images(text, text[])
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.set_product_images_brand(text, text, text[])
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.append_product_images_brand(text, text, text[])
  SET search_path = pg_catalog, public;
