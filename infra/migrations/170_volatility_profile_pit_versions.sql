-- 170: Separate causal volatility profiles for PIT backtests.
-- Keep live market_volatility_profile unchanged. Historical profiles must not
-- overwrite current profiles or use future samples.
CREATE TABLE IF NOT EXISTS market_volatility_profile_pit (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  period INT NOT NULL,
  session TEXT NOT NULL,
  lookback_days INT NOT NULL,
  as_of_ts TIMESTAMPTZ NOT NULL,
  p05 DOUBLE PRECISION,
  p25 DOUBLE PRECISION,
  p50 DOUBLE PRECISION,
  p75 DOUBLE PRECISION,
  p95 DOUBLE PRECISION,
  p99 DOUBLE PRECISION,
  sample_count INT NOT NULL DEFAULT 0,
  sample_start TIMESTAMPTZ,
  sample_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, tf, period, session, lookback_days, as_of_ts)
);
