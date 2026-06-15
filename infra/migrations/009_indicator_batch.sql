-- TradeMentor V2 — Indicator Batch (Phase 3 follow-on)
-- Adds configurable moving averages, Bollinger Bands, Keltner Channels,
-- inverse FVGs, and richer zone/displacement/candle metadata.

-- ── Configurable moving averages (SMA + EMA) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS features_moving_average (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    ma_type     TEXT NOT NULL,            -- 'sma' | 'ema'
    period      INT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, ma_type, period)
);
CREATE INDEX IF NOT EXISTS idx_features_moving_average_symbol ON features_moving_average(symbol, tf, ts DESC);

-- ── Bollinger Bands ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_bollinger (
    symbol      TEXT NOT NULL,
    tf          TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    period      INT NOT NULL,
    multiplier  DOUBLE PRECISION NOT NULL,
    upper_band  DOUBLE PRECISION NOT NULL,
    middle_band DOUBLE PRECISION NOT NULL,
    lower_band  DOUBLE PRECISION NOT NULL,
    bandwidth   DOUBLE PRECISION NOT NULL,
    percent_b   DOUBLE PRECISION NOT NULL,
    engine_ver  TEXT NOT NULL DEFAULT '1.0.0',
    input_hash  TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, period, multiplier)
);
CREATE INDEX IF NOT EXISTS idx_features_bollinger_symbol ON features_bollinger(symbol, tf, ts DESC);

-- ── Keltner Channels ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_keltner (
    symbol         TEXT NOT NULL,
    tf             TEXT NOT NULL,
    ts             TIMESTAMPTZ NOT NULL,
    ema_period     INT NOT NULL,
    atr_period     INT NOT NULL,
    multiplier     DOUBLE PRECISION NOT NULL,
    upper_channel  DOUBLE PRECISION NOT NULL,
    middle_channel DOUBLE PRECISION NOT NULL,
    lower_channel  DOUBLE PRECISION NOT NULL,
    engine_ver     TEXT NOT NULL DEFAULT '1.0.0',
    input_hash     TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, ema_period, atr_period, multiplier)
);
CREATE INDEX IF NOT EXISTS idx_features_keltner_symbol ON features_keltner(symbol, tf, ts DESC);

-- ── Inverse Fair Value Gaps (iFVG) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS features_ifvg (
    symbol         TEXT NOT NULL,
    tf             TEXT NOT NULL,
    ts             TIMESTAMPTZ NOT NULL,
    direction      TEXT NOT NULL,         -- 'bullish' | 'bearish'
    top            DOUBLE PRECISION NOT NULL,
    bottom         DOUBLE PRECISION NOT NULL,
    fill_pct       DOUBLE PRECISION,
    tapped         BOOLEAN DEFAULT FALSE,
    age_bars       INT,
    is_fresh       BOOLEAN,
    strength_score DOUBLE PRECISION,
    engine_ver     TEXT NOT NULL DEFAULT '1.0.0',
    input_hash     TEXT NOT NULL,
    PRIMARY KEY (symbol, tf, ts, direction, top, bottom)
);
CREATE INDEX IF NOT EXISTS idx_features_ifvg_symbol ON features_ifvg(symbol, tf, ts DESC);

-- ── Richer zone metadata ─────────────────────────────────────────────────────
ALTER TABLE features_zone
    ADD COLUMN IF NOT EXISTS formation TEXT,
    ADD COLUMN IF NOT EXISTS strength_score DOUBLE PRECISION;

-- ── Displacement sequence metadata ───────────────────────────────────────────
ALTER TABLE features_displacement
    ADD COLUMN IF NOT EXISTS consecutive_count INT,
    ADD COLUMN IF NOT EXISTS sequence_grade TEXT;

-- ── Wick-close confirmation flag on candle patterns ──────────────────────────
ALTER TABLE features_candle_pattern
    ADD COLUMN IF NOT EXISTS is_wick_close BOOLEAN;
