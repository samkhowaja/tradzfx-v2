-- Migration 005a: Unified oscillator indicator table
-- Replaces need for 10+ single-indicator tables (RSI, Stochastic, MACD, ADX, OBV, etc.)
-- All simple oscillators go here; complex indicators (Bollinger, Keltner, SuperTrend) get their own tables.

CREATE TABLE IF NOT EXISTS features_indicator (
  symbol      TEXT        NOT NULL,
  tf          TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  indicator_name TEXT     NOT NULL,  -- 'rsi', 'stochastic_k', 'stochastic_d', 'macd_line', 'macd_signal', 'macd_histogram', 'adx', 'adx_plus_di', 'adx_minus_di', 'obv'
  period      INT         NOT NULL,
  value       DOUBLE PRECISION NOT NULL,
  params_json JSONB       DEFAULT '{}',
  engine_ver  TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash  TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, indicator_name, period)
);

CREATE INDEX IF NOT EXISTS idx_features_indicator_lookup
  ON features_indicator(symbol, tf, ts DESC, indicator_name);

CREATE INDEX IF NOT EXISTS idx_features_indicator_name_period
  ON features_indicator(indicator_name, period, symbol, tf, ts DESC);

-- TimescaleDB hypertable setup (if TimescaleDB extension is available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('features_indicator', 'ts', if_not_exists => TRUE, chunk_time_interval => INTERVAL '7 days');
  END IF;
END $$;
