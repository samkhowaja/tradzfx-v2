-- Order blocks detected from displacement candles at structure breaks.
CREATE TABLE IF NOT EXISTS features_order_block (
    symbol         TEXT NOT NULL,
    tf             TEXT NOT NULL,
    ts             TIMESTAMPTZ NOT NULL,
    ob_kind        TEXT NOT NULL,         -- 'bullish' | 'bearish'
    degree         TEXT NOT NULL DEFAULT 'swing', -- 'internal' | 'swing'
    top            DOUBLE PRECISION NOT NULL,
    bottom         DOUBLE PRECISION NOT NULL,
    formation_ts   TIMESTAMPTZ,
    age_bars       INT,
    is_fresh       BOOLEAN DEFAULT TRUE,
    strength_score DOUBLE PRECISION,
    mitigated_at   TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    engine_ver     TEXT NOT NULL DEFAULT '1.0.0',
    input_hash     TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, ob_kind, top, bottom)
);

CREATE INDEX IF NOT EXISTS idx_features_order_block_symbol
    ON features_order_block(symbol, tf, ts DESC);
CREATE INDEX IF NOT EXISTS idx_features_order_block_lifecycle
    ON features_order_block(symbol, tf, mitigated_at, invalidated_at);
