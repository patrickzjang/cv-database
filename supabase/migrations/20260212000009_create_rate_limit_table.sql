-- Rate limiting table and helper RPC function.
--
-- Used by the web-next API routes to enforce per-IP request limits that work
-- correctly across serverless instances (unlike the previous in-memory Map
-- which reset on every cold start).
--
-- The check_rate_limit function is called with:
--   p_key       - unique key, typically "endpoint:ip"
--   p_limit     - max requests allowed in the window
--   p_window_sec - window size in seconds
--
-- It returns TRUE if the request is allowed, FALSE if the limit is exceeded.
-- Old rows are cleaned up automatically when they are expired.

CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  key        text        NOT NULL,
  count      integer     NOT NULL DEFAULT 0,
  reset_at   timestamptz NOT NULL,
  PRIMARY KEY (key, reset_at)
);

-- Only service_role (used by web-next server routes) needs access.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_limit_buckets TO service_role;

-- Periodic cleanup: delete expired rows older than 1 hour to keep table small.
-- (In production you could also use pg_cron for this.)
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key        text,
  p_limit      integer,
  p_window_sec integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now       timestamptz := now();
  v_reset_at  timestamptz := date_trunc('second', v_now) + (p_window_sec * '1 second'::interval);
  -- align slot to window boundary so all requests in the same window share a row
  v_slot_start timestamptz := v_reset_at - (p_window_sec * '1 second'::interval);
  v_count     integer;
BEGIN
  -- Clean up expired rows (best-effort, non-blocking)
  DELETE FROM public.rate_limit_buckets
  WHERE reset_at < v_now - interval '1 hour';

  -- Upsert: increment counter for this key+window, or create it at 1
  INSERT INTO public.rate_limit_buckets (key, count, reset_at)
  VALUES (p_key, 1, v_reset_at)
  ON CONFLICT (key, reset_at) DO UPDATE
    SET count = rate_limit_buckets.count + 1;

  -- Read back the current count
  SELECT count INTO v_count
  FROM public.rate_limit_buckets
  WHERE key = p_key AND reset_at = v_reset_at;

  RETURN v_count <= p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO service_role;
