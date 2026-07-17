-- feature_config_snapshot_content_hash_key already enforces uniqueness and
-- provides the identical (content_hash) B-tree access path.
-- Keep this as the sole statement: PostgreSQL requires DROP INDEX CONCURRENTLY
-- outside a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_feature_config_snapshot_hash;
