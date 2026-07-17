-- 105_features_direction_state.sql
--
-- Direction Arbiter (P0 / SK-27..33): single reconciled, regime-classified
-- direction per (symbol, tf, ts), produced by the engine feature
-- `features_direction_state` (dependencies: features_bias, features_htf_bias).
-- Resolves the "two direction truths" smell (features_bias vs features_htf_bias
-- disagree ~50%) into one consumable row with explicit agreement + the unified
-- regime. State feature (latest_as_of): ts is the evaluation anchor.

CREATE TABLE IF NOT EXISTS features_direction_state (
  symbol        TEXT        NOT NULL,
  tf            TEXT        NOT NULL,
  ts            TIMESTAMPTZ NOT NULL,
  direction     TEXT        NOT NULL,          -- bullish | bearish | neutral
  regime        TEXT        NOT NULL,          -- trending | ranging | volatile | low_volatility
  agreement     BOOLEAN     NOT NULL DEFAULT false,  -- bias.direction == htf_bias.direction != neutral
  bias_direction TEXT,
  htf_direction  TEXT,
  htf_state      TEXT,                          -- READY | SOFT_WARN | BLOCK
  confidence    DOUBLE PRECISION NOT NULL DEFAULT 0,
  reason        TEXT,
  engine_ver    TEXT,
  input_hash    TEXT,
  PRIMARY KEY (symbol, tf, ts)
);

CREATE INDEX IF NOT EXISTS idx_features_direction_state_lookup
  ON features_direction_state (symbol, tf, ts DESC);

-- Latest-as-of reads for the reconciled direction/regime at a bar.
CREATE INDEX IF NOT EXISTS idx_features_direction_state_pit
  ON features_direction_state (symbol, tf, ts DESC)
  INCLUDE (direction, regime, agreement, htf_state, confidence);
