-- Add product_images jsonb to core.master_pan
ALTER TABLE core.master_pan
  ADD COLUMN IF NOT EXISTS product_images jsonb
  DEFAULT '[]'::jsonb;
