-- Calculate total RRP from order items joined with sku_pricing
CREATE OR REPLACE FUNCTION jst_raw.dashboard_rrp_total(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw, core
AS $$
  SELECT COALESCE(SUM(
    COALESCE(sp.rrp, sp.price_tag, (item->>'price')::numeric)
    * COALESCE((item->>'qty')::numeric, 0)
  ), 0)
  FROM jst_raw.order_details_raw o,
       jsonb_array_elements(
         CASE jsonb_typeof(o.order_items_raw)
           WHEN 'array' THEN o.order_items_raw
           ELSE '[]'::jsonb
         END
       ) AS item
  LEFT JOIN core.sku_pricing sp ON sp.item_sku = (item->>'skuId')
  WHERE o.order_time >= p_from
    AND o.order_time < p_to
    AND (p_platforms IS NULL OR o.shop_name = ANY(p_platforms))
    AND (item->>'qty') IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION jst_raw.dashboard_rrp_total(timestamptz, timestamptz, text[]) TO service_role;
