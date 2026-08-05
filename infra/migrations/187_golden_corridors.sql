-- Migration 187: golden corridors — deployment-level gate over certified windows.
-- A golden corridor is a trusted window whose feature backfill parity has been
-- proven under the frozen parity harness (parity-harness-v1). Live/shadow
-- runners must refuse jobs outside an active golden corridor.
-- No candle, quarantine, or feature rows are modified here.

BEGIN;

CREATE TABLE IF NOT EXISTS market.golden_corridor_sets (
    corridor_id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    symbol           TEXT NOT NULL CHECK (symbol = upper(symbol)),
    timeframe        TEXT NOT NULL,
    window_start     TIMESTAMPTZ NOT NULL,
    window_end       TIMESTAMPTZ NOT NULL,
    window_id        BIGINT NOT NULL REFERENCES market.trusted_windows(window_id),
    set_hash         TEXT NOT NULL,  -- trusted-window gate setHash at certification time
    harness_version  TEXT NOT NULL,  -- parity harness that proved the cell
    detector_version TEXT NOT NULL REFERENCES market.detector_config(detector_version),
    canonical_version TEXT NOT NULL,
    certified_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    certified_by     TEXT NOT NULL,
    notes            TEXT,
    active           BOOLEAN NOT NULL DEFAULT true,
    retired_at       TIMESTAMPTZ,
    retired_by       TEXT,
    CHECK (window_end > window_start)
);

-- One active corridor per (symbol, timeframe, window) — re-certification of the
-- same span requires retiring the old row first (history preserved).
CREATE UNIQUE INDEX IF NOT EXISTS uq_golden_corridor_active_span
    ON market.golden_corridor_sets(symbol, timeframe, window_start, window_end)
    WHERE active;

-- Live gate lookup path: symbol + tf + interval containment.
CREATE INDEX IF NOT EXISTS ix_golden_corridor_lookup
    ON market.golden_corridor_sets(symbol, timeframe, window_start, window_end)
    WHERE active;

-- Canonical read surface for live/shadow runners and monitoring.
CREATE OR REPLACE VIEW market.golden_corridors AS
SELECT
    corridor_id,
    symbol,
    timeframe,
    window_start,
    window_end,
    window_id,
    set_hash,
    harness_version,
    detector_version,
    canonical_version,
    certified_at,
    certified_by,
    notes
FROM market.golden_corridor_sets
WHERE active;

COMMIT;
