-- Migration 017: Cross-asset correlation / SMT feature
-- Stores rolling correlation and divergence against a reference symbol (e.g., DXY).

CREATE TABLE IF NOT EXISTS features_correlation (
  symbol              TEXT        NOT NULL,
  tf                  TEXT        NOT NULL,
  ts                  TIMESTAMPTZ NOT NULL,
  reference_symbol    TEXT        NOT NULL,
  correlation_1h      DOUBLE PRECISION,
  correlation_4h      DOUBLE PRECISION,
  correlation_1d      DOUBLE PRECISION,
  divergence_detected BOOLEAN     NOT NULL DEFAULT FALSE,
  divergence_type     TEXT,
  engine_ver          TEXT        NOT NULL DEFAULT '1.0.0',
  input_hash          TEXT        NOT NULL,
  PRIMARY KEY (symbol, tf, ts, reference_symbol)
);

CREATE INDEX IF NOT EXISTS idx_features_correlation_lookup
  ON features_correlation(symbol, tf, ts DESC, reference_symbol);
