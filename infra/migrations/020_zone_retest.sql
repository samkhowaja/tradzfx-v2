-- Migration 016: Zone retest confirmation
-- Detects candle interaction with active supply/demand/FVG zones.

CREATE TABLE IF NOT EXISTS features_zone_retest (
  symbol              TEXT        NOT NULL,
  tf                  TEXT        NOT NULL,
  ts                  TIMESTAMPTZ NOT NULL,
  zone_kind           TEXT        NOT NULL,
  top                 DOUBLE PRECISION NOT NULL,
  bottom              DOUBLE PRECISION NOT NULL,
  wick_into_zone      BOOLEAN     NOT NULL DEFAULT FALSE,
  close_inside_zone   BOOLEAN     NOT NULL DEFAULT FALSE,
  engulfing_at_zone   BOOLEAN     NOT NULL DEFAULT FALSE,
  direction           TEXT        NOT NULL,
  engine_ver          TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash          TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, zone_kind, top, bottom)
);

CREATE INDEX IF NOT EXISTS idx_features_zone_retest_lookup
  ON features_zone_retest(symbol, tf, ts DESC, zone_kind);
