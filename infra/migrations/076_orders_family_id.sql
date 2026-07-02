-- Link orders directly to strategy families so gates don't have to infer family from suffixes.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS family_id TEXT;

-- Backfill existing rows from their variant's family.
UPDATE orders o
SET family_id = v.family_id
FROM strategy_variants v
WHERE o.variant_id = v.id
  AND o.family_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_family_id ON orders(family_id);
CREATE INDEX IF NOT EXISTS idx_orders_variant_id ON orders(variant_id);
