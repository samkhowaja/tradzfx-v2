-- Higher-timeframe bias feature table.
--
-- Stores the weighted consensus computed from fresh order blocks and structure
-- on higher timeframes (1D, 4H, 1H, 15m). The weights follow the documented
-- MTF model: 1D=3.0, 4H=2.0, 1H=1.0, 15m=0.5.

CREATE TABLE IF NOT EXISTS features_htf_bias (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    direction   TEXT NOT NULL,
    confidence  DOUBLE PRECISION NOT NULL DEFAULT 0,
    state       TEXT NOT NULL DEFAULT 'BLOCK',
    score       DOUBLE PRECISION NOT NULL DEFAULT 0,
    reason      TEXT,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_htf_bias_symbol
    ON features_htf_bias(symbol, tf, ts DESC);
