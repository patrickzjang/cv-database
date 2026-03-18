-- Add new columns required by latest master CSV files.
-- Columns are uppercase to match existing master table naming style.

ALTER TABLE core.master_pan
  ADD COLUMN IF NOT EXISTS "BRAND" text,
  ADD COLUMN IF NOT EXISTS "CBV" text,
  ADD COLUMN IF NOT EXISTS "VAT" text,
  ADD COLUMN IF NOT EXISTS "MONTH" text;

ALTER TABLE core.master_arena
  ADD COLUMN IF NOT EXISTS "BRAND" text,
  ADD COLUMN IF NOT EXISTS "CBV" text,
  ADD COLUMN IF NOT EXISTS "VAT" text,
  ADD COLUMN IF NOT EXISTS "MONTH" text;

ALTER TABLE core.master_daybreak
  ADD COLUMN IF NOT EXISTS "BRAND" text,
  ADD COLUMN IF NOT EXISTS "CBV" text,
  ADD COLUMN IF NOT EXISTS "VAT" text,
  ADD COLUMN IF NOT EXISTS "MONTH" text;

ALTER TABLE core.master_heelcare
  ADD COLUMN IF NOT EXISTS "BRAND" text,
  ADD COLUMN IF NOT EXISTS "CBV" text,
  ADD COLUMN IF NOT EXISTS "VAT" text,
  ADD COLUMN IF NOT EXISTS "MONTH" text;

-- Recreate public views to ensure schema cache picks up new columns immediately.
CREATE OR REPLACE VIEW public.master_pan_public AS
SELECT * FROM core.master_pan;

CREATE OR REPLACE VIEW public.master_arena_public AS
SELECT * FROM core.master_arena;

CREATE OR REPLACE VIEW public.master_daybreak_public AS
SELECT * FROM core.master_daybreak;

CREATE OR REPLACE VIEW public.master_heelcare_public AS
SELECT * FROM core.master_heelcare;
