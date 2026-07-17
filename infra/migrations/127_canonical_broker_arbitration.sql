-- 127_canonical_broker_arbitration.sql
-- Add governed, effective-dated canonical broker selection without moving or
-- deleting broker-qualified candle history.

BEGIN;

CREATE SCHEMA IF NOT EXISTS raw;
CREATE SCHEMA IF NOT EXISTS market;
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS raw.brokers (
    broker_id TEXT PRIMARY KEY CHECK (btrim(broker_id) <> ''),
    display_name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'broker' CHECK (source_type IN ('broker', 'synthetic', 'test')),
    enabled BOOLEAN NOT NULL DEFAULT true,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER
);

CREATE TABLE IF NOT EXISTS raw.symbol_broker_policy (
    policy_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol TEXT NOT NULL CHECK (symbol = UPPER(symbol) AND symbol ~ '^[A-Z0-9._-]+$'),
    broker_id TEXT NOT NULL REFERENCES raw.brokers(broker_id),
    priority INTEGER NOT NULL CHECK (priority > 0),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    min_coverage_ratio DOUBLE PRECISION NOT NULL DEFAULT 0.98
        CHECK (min_coverage_ratio > 0 AND min_coverage_ratio <= 1),
    max_lag_seconds INTEGER NOT NULL DEFAULT 900 CHECK (max_lag_seconds >= 0),
    failover_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (failover_mode IN ('manual', 'session_lease')),
    reason TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER,
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    UNIQUE (symbol, priority, effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_symbol_broker_policy_open_priority
    ON raw.symbol_broker_policy(symbol, priority)
    WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_symbol_broker_policy_lookup
    ON raw.symbol_broker_policy(symbol, effective_from DESC, priority);

CREATE OR REPLACE FUNCTION raw.reject_overlapping_symbol_broker_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM raw.symbol_broker_policy p
        WHERE p.symbol = NEW.symbol
          AND p.priority = NEW.priority
          AND p.policy_id <> COALESCE(NEW.policy_id, 0)
          AND tstzrange(p.effective_from, p.effective_to, '[)') &&
              tstzrange(NEW.effective_from, NEW.effective_to, '[)')
    ) THEN
        RAISE EXCEPTION 'Overlapping broker policy for symbol %, priority %', NEW.symbol, NEW.priority;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trg_reject_overlapping_symbol_broker_policy
BEFORE INSERT OR UPDATE ON raw.symbol_broker_policy
FOR EACH ROW EXECUTE FUNCTION raw.reject_overlapping_symbol_broker_policy();

CREATE TABLE IF NOT EXISTS ops.broker_arbitration_runs (
    run_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol TEXT NOT NULL,
    session_key TEXT,
    selected_broker_id TEXT REFERENCES raw.brokers(broker_id),
    policy_id BIGINT REFERENCES raw.symbol_broker_policy(policy_id),
    decision TEXT NOT NULL CHECK (decision IN ('selected', 'failed_closed', 'manual_failover')),
    source_max_ts TIMESTAMPTZ,
    coverage_ratio DOUBLE PRECISION,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    changed_by TEXT NOT NULL DEFAULT CURRENT_USER
);

CREATE INDEX IF NOT EXISTS idx_broker_arbitration_runs_symbol_started
    ON ops.broker_arbitration_runs(symbol, started_at DESC);

INSERT INTO raw.brokers (broker_id, display_name, source_type, changed_by)
SELECT DISTINCT
    broker,
    broker,
    CASE
        WHEN broker = 'synthetic' THEN 'synthetic'
        WHEN broker IN ('test', 'smoke-test') THEN 'test'
        ELSE 'broker'
    END,
    'migration-127-bootstrap'
FROM candles_1m
ON CONFLICT (broker_id) DO NOTHING;

-- Current governed primary. Historical imported MT5 rows and OANDA/test feeds
-- remain raw secondary sources. Failover is manual until session-lease quality
-- arbitration is implemented and observed.
INSERT INTO raw.symbol_broker_policy (
    symbol, broker_id, priority, effective_from, min_coverage_ratio,
    max_lag_seconds, failover_mode, reason, changed_by
)
SELECT
    u.symbol,
    CASE WHEN u.symbol = 'DXY' THEN 'synthetic' ELSE '1x Trade Ltd.' END,
    1,
    '-infinity'::timestamptz,
    0.98,
    u.expected_data_clock_lag_seconds,
    'manual',
    'Initial canonical source: deepest continuous primary-feed history',
    'migration-127-bootstrap'
FROM ops.feature_pipeline_symbols u
WHERE u.enabled
  AND EXISTS (
      SELECT 1 FROM candles_1m c
      WHERE c.symbol = u.symbol
        AND c.broker = CASE WHEN u.symbol = 'DXY' THEN 'synthetic' ELSE '1x Trade Ltd.' END
  )
ON CONFLICT (symbol, priority, effective_from) DO NOTHING;

UPDATE ops.feature_pipeline_symbols u
SET canonical_broker_id = p.broker_id,
    changed_at = NOW(),
    changed_by = 'migration-127-bootstrap'
FROM raw.symbol_broker_policy p
WHERE p.symbol = u.symbol
  AND p.priority = 1
  AND p.effective_to IS NULL
  AND u.canonical_broker_id IS DISTINCT FROM p.broker_id;

CREATE OR REPLACE VIEW market.candles_1m_canonical AS
SELECT c.symbol, c.ts, c.o, c.h, c.l, c.c, c.v, c.spread, c.broker, c.digits,
       p.policy_id
FROM candles_1m c
JOIN LATERAL (
    SELECT policy_id, broker_id
    FROM raw.symbol_broker_policy p
    WHERE p.symbol = c.symbol
      AND p.effective_from <= c.ts
      AND (p.effective_to IS NULL OR c.ts < p.effective_to)
    ORDER BY p.priority ASC
    LIMIT 1
) p ON p.broker_id = c.broker;

COMMENT ON TABLE raw.symbol_broker_policy IS
    'Effective-dated broker priority. Priority 1 is canonical; overlapping intervals at one priority are rejected.';
COMMENT ON VIEW market.candles_1m_canonical IS
    'Exactly one policy-selected raw broker stream per symbol and policy interval; missing policy yields no canonical rows.';
COMMENT ON TABLE ops.broker_arbitration_runs IS
    'Audit ledger for broker selection, failed-closed decisions, and explicit failover.';

COMMIT;
