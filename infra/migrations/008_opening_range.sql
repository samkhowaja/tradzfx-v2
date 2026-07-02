-- Migration 005c: Opening Range (ORB) tracker
-- Stores opening range high/low/midpoint per session per day.
-- Supports 5m, 15m, and 30m opening ranges.
-- Used by: ORB Classic, Scarface 5m ORB, ForexStrategy Displacement ORB

CREATE TABLE IF NOT EXISTS features_opening_range (
  symbol        TEXT        NOT NULL,
  date          DATE        NOT NULL,
  session       TEXT        NOT NULL,  -- 'ny', 'london', 'asia'
  range_minutes INT         NOT NULL,  -- 5, 15, 30
  high          DOUBLE PRECISION NOT NULL,
  low           DOUBLE PRECISION NOT NULL,
  midpoint      DOUBLE PRECISION NOT NULL,
  engine_ver    TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash    TEXT        NOT NULL,
  PRIMARY KEY (symbol, date, session, range_minutes)
);

CREATE INDEX IF NOT EXISTS idx_features_opening_range_lookup
  ON features_opening_range(symbol, date DESC, session);

CREATE INDEX IF NOT EXISTS idx_features_opening_range_minutes
  ON features_opening_range(range_minutes, symbol, date DESC);
