-- Post-refresh validation checks

-- Row counts
SELECT 'PAN' AS brand, count(*) AS rows FROM core.master_pan
UNION ALL
SELECT 'ARENA', count(*) FROM core.master_arena
UNION ALL
SELECT 'DAYBREAK', count(*) FROM core.master_daybreak
UNION ALL
SELECT 'HEELCARE', count(*) FROM core.master_heelcare;

-- Null / empty variation SKU sanity
SELECT 'PAN' AS brand, count(*) AS bad_rows
FROM core.master_pan
WHERE "VARIATION_SKU" IS NULL OR trim("VARIATION_SKU") = ''
UNION ALL
SELECT 'ARENA', count(*) FROM core.master_arena WHERE "VARIATION_SKU" IS NULL OR trim("VARIATION_SKU") = ''
UNION ALL
SELECT 'DAYBREAK', count(*) FROM core.master_daybreak WHERE "VARIATION_SKU" IS NULL OR trim("VARIATION_SKU") = ''
UNION ALL
SELECT 'HEELCARE', count(*) FROM core.master_heelcare WHERE "VARIATION_SKU" IS NULL OR trim("VARIATION_SKU") = '';

-- View query smoke tests
SELECT count(*) FROM public.master_pan_public;
SELECT count(*) FROM public.master_arena_public;
SELECT count(*) FROM public.master_daybreak_public;
SELECT count(*) FROM public.master_heelcare_public;

SELECT count(*) FROM public.master_pan_variations;
SELECT count(*) FROM public.master_arena_variations;
SELECT count(*) FROM public.master_daybreak_variations;
SELECT count(*) FROM public.master_heelcare_variations;

-- Function smoke tests (replace with a known SKU after load)
-- SELECT public.set_product_images_brand('PAN', 'KNOWN_VARIATION_SKU', ARRAY[]::text[]);
-- SELECT public.append_product_images_brand('PAN', 'KNOWN_VARIATION_SKU', ARRAY['https://example.com/a.jpg']);
