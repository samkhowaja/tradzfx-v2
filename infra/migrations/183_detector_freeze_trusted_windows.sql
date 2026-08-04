-- Migration 183: immutable detector configuration and governed trusted windows.
-- No candle, quarantine, or feature rows are modified here.

BEGIN;

CREATE TABLE IF NOT EXISTS market.detector_config (
    detector_version TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'retired')),
    config JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL DEFAULT current_user,
    activated_at TIMESTAMPTZ,
    activated_by TEXT,
    retired_at TIMESTAMPTZ,
    retired_by TEXT,
    CHECK (status <> 'active' OR activated_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_detector_config_one_active
    ON market.detector_config ((status)) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS market.trusted_windows (
    window_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol TEXT NOT NULL CHECK (symbol = upper(symbol)),
    timeframe TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    window_end TIMESTAMPTZ NOT NULL,
    detector_version TEXT NOT NULL REFERENCES market.detector_config(detector_version),
    canonical_version TEXT NOT NULL,
    eligibility_version TEXT NOT NULL,
    broker_policy_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('candidate', 'trusted', 'superseded')),
    gate_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by TEXT NOT NULL DEFAULT current_user,
    promoted_at TIMESTAMPTZ,
    promoted_by TEXT,
    superseded_at TIMESTAMPTZ,
    superseded_by TEXT,
    CHECK (window_end > window_start),
    CHECK (status <> 'trusted' OR promoted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_trusted_windows_lookup
    ON market.trusted_windows(symbol, timeframe, status, window_start, window_end);

CREATE OR REPLACE VIEW market.active_trusted_windows AS
SELECT *
FROM market.trusted_windows
WHERE status = 'trusted';

COMMENT ON TABLE market.detector_config IS
    'Immutable detector parameter snapshots. Rows are never updated; status transitions are audited.';
COMMENT ON TABLE market.trusted_windows IS
    'Candidate/trusted canonical history windows. Backtests must use trusted rows, not hand-typed dates.';

COMMIT;
