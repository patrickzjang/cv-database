-- Add Category, Collection, SIZE columns to sku_pricing (synced from Google Sheet columns K, L, M)
ALTER TABLE core.sku_pricing ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE core.sku_pricing ADD COLUMN IF NOT EXISTS collection text;
ALTER TABLE core.sku_pricing ADD COLUMN IF NOT EXISTS size text;
