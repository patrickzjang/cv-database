-- Create brand-specific master tables based on core.master_pan structure
CREATE TABLE IF NOT EXISTS core.master_arena (LIKE core.master_pan INCLUDING ALL);
CREATE TABLE IF NOT EXISTS core.master_daybreak (LIKE core.master_pan INCLUDING ALL);
CREATE TABLE IF NOT EXISTS core.master_heelcare (LIKE core.master_pan INCLUDING ALL);

-- Public views for each brand
CREATE OR REPLACE VIEW public.master_arena_public AS
SELECT * FROM core.master_arena;

CREATE OR REPLACE VIEW public.master_daybreak_public AS
SELECT * FROM core.master_daybreak;

CREATE OR REPLACE VIEW public.master_heelcare_public AS
SELECT * FROM core.master_heelcare;

GRANT SELECT ON public.master_arena_public TO anon;
GRANT SELECT ON public.master_daybreak_public TO anon;
GRANT SELECT ON public.master_heelcare_public TO anon;
