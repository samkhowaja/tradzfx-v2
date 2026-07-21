-- 147_features_volatility_normalized.sql
-- Parallel, shadow-only normalized volatility state. Does not modify features_atr.

CREATE TABLE IF NOT EXISTS features_volatility_normalized (
  symbol          TEXT             NOT NULL,
  tf              TEXT             NOT NULL,
  ts              TIMESTAMPTZ      NOT NULL,
  period          INT              NOT NULL,
  session         TEXT             NOT NULL,
  atr_raw         DOUBLE PRECISION NOT NULL,
  atr_effective   DOUBLE PRECISION NOT NULL,
  pip_size        DOUBLE PRECISION NOT NULL,
  close_price     DOUBLE PRECISION NOT NULL,
  atr_pips        DOUBLE PRECISION NOT NULL,
  atr_bps         DOUBLE PRECISION NOT NULL,
  percentile_rank DOUBLE PRECISION,
  robust_z        DOUBLE PRECISION,
  regime          TEXT,
  sample_count    INT              NOT NULL,
  sample_start    TIMESTAMPTZ,
  source_atr_engine_ver TEXT,
  is_valid        BOOLEAN          NOT NULL,
  quality_reason  TEXT,
  engine_ver      TEXT             NOT NULL,
  input_hash      TEXT             NOT NULL,
  PRIMARY KEY (symbol, tf, period, session, ts),
  CHECK (period > 0),
  CHECK (pip_size > 0),
  CHECK (close_price > 0),
  CHECK (atr_raw > 0),
  CHECK (atr_effective > 0),
  CHECK (percentile_rank IS NULL OR percentile_rank BETWEEN 0 AND 1),
  CHECK (sample_count >= 0),
  CHECK (regime IS NULL OR regime IN
    ('extreme_low', 'low', 'normal', 'high', 'extreme_high'))
);

CREATE INDEX IF NOT EXISTS idx_features_volatility_normalized_lookup
  ON features_volatility_normalized (symbol, tf, period, session, ts DESC);
