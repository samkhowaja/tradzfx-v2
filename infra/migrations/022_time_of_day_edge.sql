-- Migration 018: Time-of-day edge feature
-- Per-symbol, per-hour edge scoring for setup quality.

CREATE TABLE IF NOT EXISTS features_time_of_day_edge (
  symbol      TEXT        NOT NULL,
  tf          TEXT        NOT NULL,
  ts          TIMESTAMPTZ NOT NULL,
  edge        TEXT        NOT NULL,
  score       INT         NOT NULL,
  session     TEXT        NOT NULL,
  reasons     TEXT,
  low_sample  BOOLEAN     NOT NULL DEFAULT FALSE,
  engine_ver  TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash  TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_time_of_day_edge_lookup
  ON features_time_of_day_edge(symbol, tf, ts DESC);
