-- Drop old functions first (return type changed)
DROP FUNCTION IF EXISTS jst_raw.dashboard_summary(timestamptz, timestamptz, text[]);
DROP FUNCTION IF EXISTS jst_raw.dashboard_daily_trend(timestamptz, timestamptz, text[]);

-- Fix dashboard_summary to show real financial metrics
CREATE OR REPLACE FUNCTION jst_raw.dashboard_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  total_orders      bigint,
  gross_revenue     numeric,
  platform_discounts numeric,
  shipping_income   numeric,
  shipping_cost     numeric,
  net_revenue       numeric,
  avg_order_value   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    COUNT(*)                                                         AS total_orders,
    COALESCE(SUM(amount), 0)                                         AS gross_revenue,
    COALESCE(SUM(COALESCE(platform_free_amount,0) + COALESCE(shop_free_amount,0)), 0) AS platform_discounts,
    COALESCE(SUM(freight_income), 0)                                 AS shipping_income,
    COALESCE(SUM(freight_fee), 0)                                    AS shipping_cost,
    COALESCE(SUM(paid_amount), 0)                                    AS net_revenue,
    COALESCE(AVG(NULLIF(paid_amount, 0)), 0)                         AS avg_order_value
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms));
$$;

-- Fix daily trend to include net_revenue
CREATE OR REPLACE FUNCTION jst_raw.dashboard_daily_trend(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  day          date,
  orders       bigint,
  revenue      numeric,
  paid         numeric,
  net_revenue  numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    order_time::date                           AS day,
    COUNT(*)                                   AS orders,
    COALESCE(SUM(amount), 0)                   AS revenue,
    COALESCE(SUM(paid_amount), 0)              AS paid,
    COALESCE(SUM(paid_amount), 0)              AS net_revenue
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms))
  GROUP BY order_time::date
  ORDER BY day;
$$;

-- NEW: Platform-level summary
CREATE OR REPLACE FUNCTION jst_raw.dashboard_platform_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  platform           text,
  total_orders       bigint,
  gross_revenue      numeric,
  platform_discounts numeric,
  shipping_income    numeric,
  shipping_cost      numeric,
  net_revenue        numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    shop_name                                                        AS platform,
    COUNT(*)                                                         AS total_orders,
    COALESCE(SUM(amount), 0)                                         AS gross_revenue,
    COALESCE(SUM(COALESCE(platform_free_amount,0) + COALESCE(shop_free_amount,0)), 0) AS platform_discounts,
    COALESCE(SUM(freight_income), 0)                                 AS shipping_income,
    COALESCE(SUM(freight_fee), 0)                                    AS shipping_cost,
    COALESCE(SUM(paid_amount), 0)                                    AS net_revenue
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms))
  GROUP BY shop_name
  ORDER BY net_revenue DESC;
$$;

-- Re-grant
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_summary(timestamptz, timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_daily_trend(timestamptz, timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_platform_summary(timestamptz, timestamptz, text[]) TO service_role;
