-- Track forward-looking outcomes for every completed zone so the quality model
-- can learn from history instead of relying only on heuristics.

CREATE TABLE IF NOT EXISTS zone_outcomes (
    id              BIGSERIAL PRIMARY KEY,
    symbol          TEXT NOT NULL,
    tf              TEXT NOT NULL,
    zone_kind       TEXT NOT NULL,
    top             DOUBLE PRECISION NOT NULL,
    bottom          DOUBLE PRECISION NOT NULL,
    formation_ts    TIMESTAMPTZ NOT NULL,
    outcome         TEXT, -- 'reversal', 'mitigated', 'invalidated', 'untouched'
    max_favorable   DOUBLE PRECISION,
    max_adverse     DOUBLE PRECISION,
    exit_ts         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (symbol, tf, zone_kind, top, bottom, formation_ts)
);

CREATE INDEX IF NOT EXISTS idx_zone_outcomes_lookup
    ON zone_outcomes(symbol, tf, zone_kind, formation_ts DESC);
