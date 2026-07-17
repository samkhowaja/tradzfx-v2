-- 103_market_data_contracts.sql
-- P0 durable core (V3 BUG-3.1/3.2/3.3, Codex Part 7 Fix #1/#2/#3):
--   * ATR quality columns (raw `value` preserved; winsorized effective_value added)
--   * market_volatility_profile (symbol/session ATR distribution for percentile gates)
--   * feature_producer_runs (SLA bookkeeping for engine/lifecycle/ingestion producers)
--   * candle_quality (side table for suspect 1m candles; avoids bloating the hypertable)
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS.

-- ── ATR quality ──────────────────────────────────────────────────────────────
ALTER TABLE features_atr
  ADD COLUMN IF NOT EXISTS effective_value DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS is_valid BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS outlier_score DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS tick_count INT,
  ADD COLUMN IF NOT EXISTS quality_reason TEXT;

-- ── Symbol/session ATR distribution (percentile gate source) ─────────────────
CREATE TABLE IF NOT EXISTS market_volatility_profile (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  period INT NOT NULL,
  session TEXT NOT NULL,
  lookback_days INT NOT NULL,
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
  PRIMARY KEY (symbol, tf, period, session, lookback_days)
);

-- ── Producer runs / SLA ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feature_producer_runs (
  run_id BIGSERIAL PRIMARY KEY,
  producer TEXT NOT NULL,            -- 'engine' | 'lifecycle' | 'ingestion'
  feature_table TEXT NOT NULL,
  symbol TEXT NOT NULL,
  tf TEXT,
  source_min_ts TIMESTAMPTZ,
  source_max_ts TIMESTAMPTZ,
  rows_seen INT,
  rows_inserted INT,
  rows_updated INT,
  rows_invalidated INT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',  -- running|done|error
  error_message TEXT,
  producer_version TEXT,
  watermark_ts TIMESTAMPTZ,
  quality_json JSONB
);
CREATE INDEX IF NOT EXISTS idx_fpr_sfts
  ON feature_producer_runs (symbol, feature_table, tf, status, finished_at DESC);

-- ── Candle quality (suspect ticks), side table ───────────────────────────────
CREATE TABLE IF NOT EXISTS candle_quality (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  is_suspect BOOLEAN NOT NULL DEFAULT true,
  reason TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (symbol, ts)
);
