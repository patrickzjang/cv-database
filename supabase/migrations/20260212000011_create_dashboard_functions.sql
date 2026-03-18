-- Dashboard aggregate functions for jst_raw.order_details_raw
-- Called by the web-next /api/dashboard route.

-- ─────────────────────────────────────────────
-- 1. Summary stats
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jst_raw.dashboard_summary(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL   -- NULL = all platforms
)
RETURNS TABLE (
  total_orders   bigint,
  total_revenue  numeric,
  paid_amount    numeric,
  avg_order_value numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    COUNT(*)                                          AS total_orders,
    COALESCE(SUM(amount),     0)                      AS total_revenue,
    COALESCE(SUM(paid_amount),0)                      AS paid_amount,
    COALESCE(AVG(NULLIF(amount, 0)), 0)               AS avg_order_value
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms));
$$;

-- ─────────────────────────────────────────────
-- 2. Order status breakdown
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jst_raw.dashboard_status_breakdown(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  status text,
  cnt    bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    COALESCE(status::text, 'unknown') AS status,
    COUNT(*)                           AS cnt
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms))
  GROUP BY status
  ORDER BY cnt DESC;
$$;

-- ─────────────────────────────────────────────
-- 3. Daily revenue + order trend
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jst_raw.dashboard_daily_trend(
  p_from      timestamptz,
  p_to        timestamptz,
  p_platforms text[] DEFAULT NULL
)
RETURNS TABLE (
  day          date,
  orders       bigint,
  revenue      numeric,
  paid         numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT
    order_time::date                   AS day,
    COUNT(*)                           AS orders,
    COALESCE(SUM(amount),     0)       AS revenue,
    COALESCE(SUM(paid_amount),0)       AS paid
  FROM jst_raw.order_details_raw
  WHERE order_time >= p_from
    AND order_time <  p_to
    AND (p_platforms IS NULL OR shop_name = ANY(p_platforms))
  GROUP BY order_time::date
  ORDER BY day;
$$;

-- ─────────────────────────────────────────────
-- 4. Top SKUs by VARIATION_SKU
--    Extracts from order_items_raw JSONB.
--    JST orderItems fields used:
--      item->>'skuCode'   — SKU code (VARIATION_SKU = left 9 chars)
--      item->>'skuName'   — display name
--      item->>'quantity'  — quantity sold
--      item->>'price'     — unit price
-- ─────────────────────────────────────────────
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
    left(item->>'skuCode', 9)                              AS variation_sku,
    MIN(item->>'skuName')                                  AS sku_name,
    SUM((item->>'quantity')::numeric)::bigint              AS total_qty,
    SUM(
      COALESCE((item->>'price')::numeric,0)
      * COALESCE((item->>'quantity')::numeric,0)
    )                                                      AS total_revenue
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
    AND (item->>'skuCode') IS NOT NULL
    AND (item->>'quantity') IS NOT NULL
  GROUP BY variation_sku
  ORDER BY total_qty DESC
  LIMIT p_limit;
$$;

-- ─────────────────────────────────────────────
-- 5. List of available platforms
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION jst_raw.dashboard_platforms()
RETURNS TABLE (shop_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, jst_raw
AS $$
  SELECT DISTINCT shop_name
  FROM jst_raw.order_details_raw
  WHERE shop_name IS NOT NULL
  ORDER BY shop_name;
$$;

-- Grant to service_role (used by web-next server routes)
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_summary(timestamptz, timestamptz, text[])     TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_status_breakdown(timestamptz, timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_daily_trend(timestamptz, timestamptz, text[]) TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_top_skus(timestamptz, timestamptz, text[], int) TO service_role;
GRANT EXECUTE ON FUNCTION jst_raw.dashboard_platforms()                                    TO service_role;
