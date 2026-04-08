-- Ensure public views run with caller privileges (security invoker),
-- so RLS/policies are applied for the querying role.
ALTER VIEW IF EXISTS public.master_pan_public SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_arena_public SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_daybreak_public SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_heelcare_public SET (security_invoker = on);

ALTER VIEW IF EXISTS public.master_pan_variations SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_arena_variations SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_daybreak_variations SET (security_invoker = on);
ALTER VIEW IF EXISTS public.master_heelcare_variations SET (security_invoker = on);

ALTER VIEW IF EXISTS public.products_sku SET (security_invoker = on);
