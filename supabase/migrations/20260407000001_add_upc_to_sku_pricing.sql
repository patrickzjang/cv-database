-- Add UPC/barcode column to sku_pricing (synced from Google Sheet column F)
ALTER TABLE core.sku_pricing ADD COLUMN IF NOT EXISTS upc text;
