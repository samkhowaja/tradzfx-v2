-- Migration 015: SMA cross detection
-- Tracks current SMA cross state for common fast/slow pairs.

CREATE TABLE IF NOT EXISTS features_sma_cross (
  symbol      TEXT        NOT NULL,
  tf          TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  fast_period INT         NOT NULL,
  slow_period INT         NOT NULL,
  direction   TEXT        NOT NULL,  -- 'bullish', 'bearish', 'neutral'
  fast_value  DOUBLE PRECISION NOT NULL,
  slow_value  DOUBLE PRECISION NOT NULL,
  engine_ver  TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash  TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, fast_period, slow_period)
);

CREATE INDEX IF NOT EXISTS idx_features_sma_cross_lookup
  ON features_sma_cross(symbol, tf, ts DESC, fast_period, slow_period);
