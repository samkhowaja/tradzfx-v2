-- Migration 180: fail-closed lineage and blocked-data metadata.

ALTER TABLE feature_jobs
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS input_start_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS input_end_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canonical_version TEXT,
  ADD COLUMN IF NOT EXISTS eligibility_version TEXT;

ALTER TABLE feature_jobs
  DROP CONSTRAINT IF EXISTS feature_jobs_status_check;

ALTER TABLE feature_jobs
  ADD CONSTRAINT feature_jobs_status_check
  CHECK (status IN ('pending', 'processing', 'done', 'error', 'blocked'));

ALTER TABLE feature_cache
  ADD COLUMN IF NOT EXISTS lineage_state TEXT NOT NULL DEFAULT 'legacy_untrusted',
  ADD COLUMN IF NOT EXISTS canonical_version TEXT,
  ADD COLUMN IF NOT EXISTS eligibility_version TEXT;

CREATE INDEX IF NOT EXISTS idx_feature_cache_trusted
  ON feature_cache(feature_name, input_hash)
  WHERE lineage_state = 'trusted_current';

DO $$
DECLARE tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'features_%'
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS lineage_state TEXT NOT NULL DEFAULT ''legacy_untrusted''', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS canonical_version TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS eligibility_model_version TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS broker_policy_version TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS detector_version TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS validator_version TEXT', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS input_start_ts TIMESTAMPTZ', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS input_end_ts TIMESTAMPTZ', tbl);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ', tbl);
  END LOOP;
END $$;

-- New columns default to legacy_untrusted. Do not rewrite large cache tables here;
-- rebuild/invalidation job handles existing rows in bounded batches.