-- Ensure web-next server routes (service_role) can read underlying core tables
-- when public views use security_invoker.
GRANT USAGE ON SCHEMA core TO service_role;

GRANT SELECT ON TABLE core.master_pan TO service_role;
GRANT SELECT ON TABLE core.master_arena TO service_role;
GRANT SELECT ON TABLE core.master_daybreak TO service_role;
GRANT SELECT ON TABLE core.master_heelcare TO service_role;
