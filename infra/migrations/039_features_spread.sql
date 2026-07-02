-- Spread feature table.
--
-- Stores the average spread over the most recent 1m candles that reported spread
-- data. Used by the spread gate to block entries during wide-spread conditions.

CREATE TABLE IF NOT EXISTS features_spread (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    spread      DOUBLE PRECISION,
    samples     INTEGER NOT NULL DEFAULT 0,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_spread_symbol
    ON features_spread(symbol, tf, ts DESC);
