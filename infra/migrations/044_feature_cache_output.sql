-- Add full serialized output to feature_cache so PostgreSQL can act as the
-- durable backing store for the hybrid Redis + PG feature cache.

ALTER TABLE feature_cache
    ADD COLUMN IF NOT EXISTS output_jsonb JSONB;

-- Help the engine look up recent cache entries when Redis is cold.
CREATE INDEX IF NOT EXISTS idx_feature_cache_lookup
    ON feature_cache(feature_name, input_hash)
    WHERE output_jsonb IS NOT NULL;
