-- Fix dashboard_top_skus: JST uses 'skuId' not 'skuCode'
-- Also add 'name' field fallback
DROP FUNCTION IF EXISTS jst_raw.dashboard_top_skus(timestamptz, timestamptz, text[], int);

CREATE OR REPLACE FUNCTION jst_raw.dashboard_top_skus(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL,
  p_limit     int     DEFAULT 20
)
RETURNS TABLE (
  variation_sku  text,
  sku_name       text,
  total_qty      bigint,
  total_revenue  numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    left(COALESCE(item->>'skuId', item->>'skuCode'), 9) AS variation_sku,
    MIN(COALESCE(item->>'name', item->>'skuName'))       AS sku_name,
    SUM((item->>'qty')::numeric)::bigint                 AS total_qty,
    SUM(
      COALESCE((item->>'price')::numeric,0)
      * COALESCE((item->>'qty')::numeric,0)
    )                                                    AS total_revenue
  FROM jst_raw.order_details_raw o,
       jsonb_array_elements(
         CASE jsonb_typeof(o.order_items_raw)
           WHEN 'array' THEN o.order_items_raw
           ELSE '[]'::jsonb
         END
       ) AS item
  WHERE o.order_time >= p_from
    AND o.order_time <  p_to
    AND (p_platforms IS NULL OR o.shop_name = ANY(p_platforms))
    AND COALESCE(item->>'skuId', item->>'skuCode') IS NOT NULL
    AND (item->>'qty') IS NOT NULL
  GROUP BY variation_sku
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION jst_raw.dashboard_top_skus(timestamptz, timestamptz, text[], int) TO service_role;
