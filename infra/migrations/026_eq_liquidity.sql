-- Equal highs / equal lows liquidity levels detected from clustered pivot extremes.
CREATE TABLE IF NOT EXISTS features_eq_liquidity (
    symbol         TEXT NOT NULL,
    tf             TEXT NOT NULL,
    ts             TIMESTAMPTZ NOT NULL,
    kind           TEXT NOT NULL,         -- 'eqh' | 'eql'
    price          DOUBLE PRECISION NOT NULL,
    strength       DOUBLE PRECISION,
    touched        BOOLEAN DEFAULT FALSE,
    engine_ver     TEXT NOT NULL DEFAULT '1.0.0',
    input_hash     TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, kind, price)
);

CREATE INDEX IF NOT EXISTS idx_features_eq_liquidity_symbol
    ON features_eq_liquidity(symbol, tf, ts DESC);
