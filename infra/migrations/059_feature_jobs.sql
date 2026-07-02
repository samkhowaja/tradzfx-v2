-- Migration 048: Incremental feature job queue for Phase 2.
-- Tracks pending/recent feature computations triggered by incoming candles.

CREATE TABLE IF NOT EXISTS feature_jobs (
    id            BIGSERIAL PRIMARY KEY,
    symbol        TEXT NOT NULL,
    tf            TEXT NOT NULL,
    ts            TIMESTAMPTZ NOT NULL,
    feature_name  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending',
    input_hash    TEXT,
    output_hash   TEXT,
    depends_on    BIGINT[],
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at  TIMESTAMPTZ,
    UNIQUE (symbol, tf, ts, feature_name)
);

CREATE INDEX IF NOT EXISTS idx_feature_jobs_pending
    ON feature_jobs(status, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_feature_jobs_symbol_tf_ts
    ON feature_jobs(symbol, tf, ts DESC);

-- Ensure every feature table carries an engine version stamp.
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOR tbl IN
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name LIKE 'features_%'
    LOOP
        EXECUTE format(
            'ALTER TABLE %I ADD COLUMN IF NOT EXISTS engine_ver TEXT',
            tbl
        );
    END LOOP;
END $$;
