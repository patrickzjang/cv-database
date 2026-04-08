ALTER TABLE core.pricing_rules ADD COLUMN IF NOT EXISTS variation_sku text;
CREATE INDEX IF NOT EXISTS idx_pricing_rules_var ON core.pricing_rules(variation_sku);
-- Drop old unique constraint and add new one
ALTER TABLE core.pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_brand_coalesce_idx;
ALTER TABLE core.pricing_rules DROP CONSTRAINT IF EXISTS pricing_rules_brand_parents_sku_key;
