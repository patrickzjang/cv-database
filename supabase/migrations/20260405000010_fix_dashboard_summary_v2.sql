-- Fix dashboard_summary to separate shop vs platform discounts
DROP FUNCTION IF EXISTS jst_raw.dashboard_summary(timestamptz, timestamptz, text[]);

CREATE OR REPLACE FUNCTION jst_raw.dashboard_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  total_orders       bigint,
  gross_revenue      numeric,
  shop_discounts     numeric,
  platform_discounts numeric,
  net_revenue        numeric,
  avg_order_value    numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    COUNT(*)                                                                AS total_orders,
    COALESCE(SUM(amount), 0)                                                AS gross_revenue,
    COALESCE(SUM(COALESCE(shop_free_amount, 0)), 0)                         AS shop_discounts,
    COALESCE(SUM(COALESCE(platform_free_amount, 0)), 0)                     AS platform_discounts,
    COALESCE(SUM(paid_amount), 0)                                           AS net_revenue,
    COALESCE(AVG(NULLIF(paid_amount, 0)), 0)                                AS avg_order_value
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms));
$$;

GRANT EXECUTE ON FUNCTION jst_raw.dashboard_summary(timestamptz, timestamptz, text[]) TO service_role;
