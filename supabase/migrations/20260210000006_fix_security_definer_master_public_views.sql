-- Re-apply security_invoker to public master views.
-- CREATE OR REPLACE VIEW can reset this property, so keep this as a guard migration.

ALTER VIEW IF EXISTS public.master_pan_public
  SET (security_invoker = on);

ALTER VIEW IF EXISTS public.master_arena_public
  SET (security_invoker = on);

ALTER VIEW IF EXISTS public.master_daybreak_public
  SET (security_invoker = on);

ALTER VIEW IF EXISTS public.master_heelcare_public
  SET (security_invoker = on);
