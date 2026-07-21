-- 156_features_push_pull.sql
-- Push-Pull pattern detection (10XROI system).
-- A push is 2+ consecutive same-direction closes. A pull is 1-2 counter-trend
-- closes that retrace into the push's range. Entry triggers when price
-- continues beyond the pullback extreme in the push direction.
--
-- Detects: push_pull (standard), push_pull_reversal, push_pull_with_doji,
--          push_pull_after_pullback, push_pull_multi (3+ push candles)

CREATE TABLE IF NOT EXISTS features_push_pull (
  symbol              TEXT             NOT NULL,
  tf                  TEXT             NOT NULL,
  ts                  TIMESTAMPTZ      NOT NULL,
  pattern_name        TEXT             NOT NULL,  -- 'push_pull', 'push_pull_reversal', 'push_pull_doji', 'push_pull_after_pullback', 'push_pull_multi'
  direction           TEXT             NOT NULL,  -- 'bullish', 'bearish'
  push_count          INT              NOT NULL,  -- number of push candles
  pull_count          INT              NOT NULL,  -- number of pull candles
  push_start          DOUBLE PRECISION NOT NULL,  -- start of push move
  push_end            DOUBLE PRECISION NOT NULL,  -- end of push move (extreme)
  pull_low            DOUBLE PRECISION NOT NULL,  -- low of pullback (bullish) / high of pullback (bearish)
  pull_high           DOUBLE PRECISION NOT NULL,  -- high of pullback
  pull_retrace_pct    DOUBLE PRECISION,           -- how far pull retraced into push range (0-1)
  push_pull_level     DOUBLE PRECISION NOT NULL,  -- key level (close of first push candle)
  confidence          DOUBLE PRECISION,           -- 0-1 score
  engine_ver          TEXT             NOT NULL DEFAULT '1.0.0',
  input_hash          TEXT             NOT NULL,
  PRIMARY KEY (symbol, tf, ts, pattern_name)
);

CREATE INDEX IF NOT EXISTS idx_features_push_pull_lookup
  ON features_push_pull(symbol, tf, ts DESC, pattern_name, direction);

CREATE INDEX IF NOT EXISTS idx_features_push_pull_dir
  ON features_push_pull(symbol, tf, direction, ts DESC, confidence DESC);

-- TimescaleDB hypertable setup
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('features_push_pull', 'ts', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
  END IF;
END $$;
