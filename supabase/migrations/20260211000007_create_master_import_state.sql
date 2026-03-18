CREATE TABLE IF NOT EXISTS public.master_import_state (
  brand text PRIMARY KEY,
  date_key text NOT NULL,
  file_name text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  inserted integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT, UPDATE ON public.master_import_state TO service_role;
