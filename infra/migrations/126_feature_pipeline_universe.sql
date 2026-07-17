-- 126_feature_pipeline_universe.sql
-- Canonical feature-compute coverage, independent from strategy activation.

BEGIN;

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.feature_pipeline_symbols (
    symbol TEXT PRIMARY KEY CHECK (symbol = UPPER(symbol) AND symbol ~ '^[A-Z0-9._-]+$'),
    enabled BOOLEAN NOT NULL DEFAULT true,
    canonical_broker_id TEXT,
    required_timeframes TEXT[] NOT NULL,
    required_feature_profile TEXT NOT NULL,
    profile_version INTEGER NOT NULL DEFAULT 1 CHECK (profile_version > 0),
    expected_data_clock_lag_seconds INTEGER NOT NULL DEFAULT 900
        CHECK (expected_data_clock_lag_seconds >= 0),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER,
    CONSTRAINT feature_pipeline_symbols_timeframes_nonempty
        CHECK (cardinality(required_timeframes) > 0),
    CONSTRAINT feature_pipeline_symbols_timeframes_valid
        CHECK (required_timeframes <@ ARRAY['1m','5m','15m','1h','4h','1d']::TEXT[])
);

CREATE INDEX IF NOT EXISTS idx_feature_pipeline_symbols_enabled
    ON ops.feature_pipeline_symbols (symbol)
    WHERE enabled;

COMMENT ON TABLE ops.feature_pipeline_symbols IS
    'Canonical feature-compute universe. Strategy activation must not implicitly add or remove rows.';
COMMENT ON COLUMN ops.feature_pipeline_symbols.required_feature_profile IS
    'Versioned profile name resolved by application-owned feature profile registry.';

-- One-time bootstrap from source coverage, not strategy activation. Future
-- strategy changes never mutate this table. Operators must use audited config.
INSERT INTO ops.feature_pipeline_symbols (
    symbol,
    enabled,
    canonical_broker_id,
    required_timeframes,
    required_feature_profile,
    profile_version,
    expected_data_clock_lag_seconds,
    changed_by
)
SELECT
    symbol,
    true,
    CASE WHEN COUNT(DISTINCT broker) = 1 THEN MIN(broker) ELSE NULL END,
    ARRAY['1m','5m','15m','1h','4h','1d']::TEXT[],
    'live-complete',
    1,
    900,
    'migration-126-bootstrap'
FROM candles_1m
GROUP BY symbol
ON CONFLICT (symbol) DO NOTHING;

COMMIT;
