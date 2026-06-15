-- Migration 005d: Candlestick pattern detection
-- Stores detected patterns per candle.
-- Used by: Watukushay No.2, Fib Swing, ORB strategies, Farley Patterns

CREATE TABLE IF NOT EXISTS features_candle_pattern (
  symbol         TEXT        NOT NULL,
  tf             TEXT        NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  pattern_name   TEXT        NOT NULL,  -- 'engulfing_bull', 'engulfing_bear', 'pin_bar', 'hammer', 'hanging_man', 'three_white_soldiers', 'three_black_crows', 'doji', 'morning_star', 'evening_star'
  direction      TEXT        NOT NULL,  -- 'bull', 'bear', 'neutral'
  confidence     DOUBLE PRECISION,      -- 0-1 scoring
  body_pct_of_atr   DOUBLE PRECISION,
  shadow_pct_of_atr DOUBLE PRECISION,
  engine_ver     TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash     TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_features_candle_pattern_lookup
  ON features_candle_pattern(symbol, tf, ts DESC, pattern_name);

CREATE INDEX IF NOT EXISTS idx_features_candle_pattern_name
  ON features_candle_pattern(pattern_name, symbol, tf, ts DESC);

-- TimescaleDB hypertable setup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('features_candle_pattern', 'ts', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
  END IF;
END $$;
