-- Backup current core master tables before refresh.
-- Run in Supabase SQL editor (or via psql) before any schema/data changes.

DO $$
DECLARE
  suffix text := to_char(now(), 'YYYYMMDD_HH24MISS');
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS core.master_pan_bak_%s AS TABLE core.master_pan', suffix);
  EXECUTE format('CREATE TABLE IF NOT EXISTS core.master_arena_bak_%s AS TABLE core.master_arena', suffix);
  EXECUTE format('CREATE TABLE IF NOT EXISTS core.master_daybreak_bak_%s AS TABLE core.master_daybreak', suffix);
  EXECUTE format('CREATE TABLE IF NOT EXISTS core.master_heelcare_bak_%s AS TABLE core.master_heelcare', suffix);
END $$;
