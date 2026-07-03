CREATE TABLE IF NOT EXISTS features_fvg (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  direction TEXT,
  top NUMERIC,
  bottom NUMERIC,
  age_bars INTEGER,
  is_fresh BOOLEAN,
  engine_ver TEXT,
  input_hash TEXT,
  PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_fvg_symbol_tf_ts
  ON features_fvg (symbol, tf, ts DESC);
