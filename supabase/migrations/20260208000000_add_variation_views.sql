-- Distinct variation views for pagination
CREATE OR REPLACE VIEW public.master_pan_variations AS
SELECT DISTINCT "VARIATION_SKU"
FROM core.master_pan;

CREATE OR REPLACE VIEW public.master_arena_variations AS
SELECT DISTINCT "VARIATION_SKU"
FROM core.master_arena;

CREATE OR REPLACE VIEW public.master_daybreak_variations AS
SELECT DISTINCT "VARIATION_SKU"
FROM core.master_daybreak;

CREATE OR REPLACE VIEW public.master_heelcare_variations AS
SELECT DISTINCT "VARIATION_SKU"
FROM core.master_heelcare;

GRANT SELECT ON public.master_pan_variations TO anon;
GRANT SELECT ON public.master_arena_variations TO anon;
GRANT SELECT ON public.master_daybreak_variations TO anon;
GRANT SELECT ON public.master_heelcare_variations TO anon;
