-- Add binary lookup/uniqueness path without replacing the authoritative text
-- unique constraint yet. Keep this as the sole statement: PostgreSQL requires
-- CREATE INDEX CONCURRENTLY outside a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS feature_config_snapshot_content_hash_bin_key
  ON public.feature_config_snapshot (content_hash_bin);
