-- Master refresh template (all brands)
-- 1) Run backup_core_master.sql first.
-- 2) Enable app maintenance mode (MAINTENANCE_MODE=true) before executing.
-- 3) Replace TODO blocks with your exact schema and data load SQL.

BEGIN;

-- Optional: clear data first
TRUNCATE TABLE core.master_pan RESTART IDENTITY;
TRUNCATE TABLE core.master_arena RESTART IDENTITY;
TRUNCATE TABLE core.master_daybreak RESTART IDENTITY;
TRUNCATE TABLE core.master_heelcare RESTART IDENTITY;

-- TODO: schema changes (add/drop/rename columns) in ALL brand tables
-- ALTER TABLE core.master_pan ADD COLUMN ...;
-- ALTER TABLE core.master_arena ADD COLUMN ...;
-- ALTER TABLE core.master_daybreak ADD COLUMN ...;
-- ALTER TABLE core.master_heelcare ADD COLUMN ...;

-- TODO: load data
-- COPY core.master_pan (...) FROM '...';
-- COPY core.master_arena (...) FROM '...';
-- COPY core.master_daybreak (...) FROM '...';
-- COPY core.master_heelcare (...) FROM '...';

-- Rebuild public views after schema changes
CREATE OR REPLACE VIEW public.master_pan_public AS
SELECT * FROM core.master_pan;

CREATE OR REPLACE VIEW public.master_arena_public AS
SELECT * FROM core.master_arena;

CREATE OR REPLACE VIEW public.master_daybreak_public AS
SELECT * FROM core.master_daybreak;

CREATE OR REPLACE VIEW public.master_heelcare_public AS
SELECT * FROM core.master_heelcare;

CREATE OR REPLACE VIEW public.master_pan_variations AS
SELECT DISTINCT "VARIATION_SKU" FROM core.master_pan;

CREATE OR REPLACE VIEW public.master_arena_variations AS
SELECT DISTINCT "VARIATION_SKU" FROM core.master_arena;

CREATE OR REPLACE VIEW public.master_daybreak_variations AS
SELECT DISTINCT "VARIATION_SKU" FROM core.master_daybreak;

CREATE OR REPLACE VIEW public.master_heelcare_variations AS
SELECT DISTINCT "VARIATION_SKU" FROM core.master_heelcare;

CREATE OR REPLACE VIEW public.products_sku AS
SELECT DISTINCT "VARIATION_SKU" AS variation_sku
FROM core.master_pan;

-- Keep views using caller privileges (linter + RLS-safe)
ALTER VIEW public.master_pan_public SET (security_invoker = on);
ALTER VIEW public.master_arena_public SET (security_invoker = on);
ALTER VIEW public.master_daybreak_public SET (security_invoker = on);
ALTER VIEW public.master_heelcare_public SET (security_invoker = on);
ALTER VIEW public.master_pan_variations SET (security_invoker = on);
ALTER VIEW public.master_arena_variations SET (security_invoker = on);
ALTER VIEW public.master_daybreak_variations SET (security_invoker = on);
ALTER VIEW public.master_heelcare_variations SET (security_invoker = on);
ALTER VIEW public.products_sku SET (security_invoker = on);

-- Required grants
GRANT SELECT ON public.master_pan_public TO anon;
GRANT SELECT ON public.master_arena_public TO anon;
GRANT SELECT ON public.master_daybreak_public TO anon;
GRANT SELECT ON public.master_heelcare_public TO anon;
GRANT SELECT ON public.master_pan_variations TO anon;
GRANT SELECT ON public.master_arena_variations TO anon;
GRANT SELECT ON public.master_daybreak_variations TO anon;
GRANT SELECT ON public.master_heelcare_variations TO anon;
GRANT SELECT ON public.products_sku TO anon;

GRANT USAGE ON SCHEMA core TO service_role;
GRANT SELECT ON TABLE core.master_pan TO service_role;
GRANT SELECT ON TABLE core.master_arena TO service_role;
GRANT SELECT ON TABLE core.master_daybreak TO service_role;
GRANT SELECT ON TABLE core.master_heelcare TO service_role;

COMMIT;
