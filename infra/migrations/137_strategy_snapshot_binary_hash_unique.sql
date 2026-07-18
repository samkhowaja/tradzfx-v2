-- Add binary lookup/uniqueness path without replacing the authoritative text
-- unique constraint yet. Keep this as the sole statement: PostgreSQL requires
-- CREATE INDEX CONCURRENTLY outside a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS strategy_settings_snapshot_content_hash_bin_key
  ON public.strategy_settings_snapshot (content_hash_bin);
