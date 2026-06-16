-- Migration 019: Structural liquidity pools feature
-- Session ranges, prior day/week extremes, round numbers, and sweep-match summary.

CREATE TABLE IF NOT EXISTS features_liquidity_pools (
  symbol               TEXT        NOT NULL,
  tf                   TEXT        NOT NULL,
  ts                   TIMESTAMPTZ NOT NULL,
  kind                 TEXT        NOT NULL,
  label                TEXT,
  price                DOUBLE PRECISION,
  distance             DOUBLE PRECISION,
  strength             DOUBLE PRECISION,
  interval             DOUBLE PRECISION,
  recent_sweep_matched BOOLEAN     NOT NULL DEFAULT FALSE,
  engine_ver           TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash           TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, kind)
);

CREATE INDEX IF NOT EXISTS idx_features_liquidity_pools_lookup
  ON features_liquidity_pools(symbol, tf, ts DESC);
