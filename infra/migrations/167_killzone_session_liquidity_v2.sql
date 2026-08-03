-- Migration 167: canonical killzone calendar and typed session-liquidity v2.
-- Non-destructive shadow schema. No existing strategy or producer is switched.

CREATE TABLE IF NOT EXISTS market_window_occurrences (
  window_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  trading_date DATE NOT NULL,
  symbol_class TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL,
  local_start TIME NOT NULL,
  local_end TIME NOT NULL,
  preferred BOOLEAN NOT NULL DEFAULT false,
  expected_activity TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (window_id, policy_version, trading_date, symbol_class),
  CHECK (ends_at > starts_at),
  CHECK (expected_activity IN ('HIGH', 'MODERATE', 'LOW'))
);

CREATE INDEX IF NOT EXISTS idx_market_window_occurrences_active
  ON market_window_occurrences (starts_at, ends_at, window_id);

CREATE TABLE IF NOT EXISTS features_session_range_v2 (
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  session_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  trading_date DATE NOT NULL,
  range_kind TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  scheduled_ends_at TIMESTAMPTZ NOT NULL,
  as_of_ts TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  is_complete BOOLEAN NOT NULL,
  open DOUBLE PRECISION NOT NULL,
  high DOUBLE PRECISION NOT NULL,
  low DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  high_formed_at TIMESTAMPTZ NOT NULL,
  low_formed_at TIMESTAMPTZ NOT NULL,
  bar_count INTEGER NOT NULL,
  expected_bar_count INTEGER NOT NULL,
  coverage_ratio DOUBLE PRECISION NOT NULL,
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  PRIMARY KEY (symbol, tf, session_id, trading_date, range_kind, as_of_ts),
  CHECK (ts = as_of_ts),
  CHECK (scheduled_ends_at > starts_at),
  CHECK (as_of_ts >= starts_at),
  CHECK (completed_at IS NULL OR completed_at = scheduled_ends_at),
  CHECK (is_complete = (completed_at IS NOT NULL)),
  CHECK (high >= low),
  CHECK (bar_count >= 0 AND expected_bar_count > 0),
  CHECK (coverage_ratio >= 0 AND coverage_ratio <= 1),
  CHECK (range_kind IN ('full_session', 'opening_5m', 'opening_15m', 'opening_30m', 'pre_killzone'))
);

CREATE INDEX IF NOT EXISTS idx_features_session_range_v2_asof
  ON features_session_range_v2 (symbol, tf, session_id, range_kind, as_of_ts DESC);

CREATE TABLE IF NOT EXISTS features_liquidity_level_v2 (
  level_id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  price DOUBLE PRECISION NOT NULL,
  side TEXT NOT NULL,
  scope TEXT NOT NULL,
  class TEXT NOT NULL,
  source_tf TEXT NOT NULL,
  context_tf TEXT NOT NULL,
  source_ref JSONB NOT NULL,
  parent_leg_id TEXT,
  formed_at TIMESTAMPTZ NOT NULL,
  known_at TIMESTAMPTZ NOT NULL,
  valid_from TIMESTAMPTZ NOT NULL,
  valid_to TIMESTAMPTZ,
  swept_at TIMESTAMPTZ,
  broken_at TIMESTAMPTZ,
  mitigated_at TIMESTAMPTZ,
  session_id TEXT,
  trading_date DATE,
  touch_count INTEGER NOT NULL DEFAULT 0,
  equal_count INTEGER NOT NULL DEFAULT 1,
  strength_score DOUBLE PRECISION,
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  CHECK (side IN ('buy_side', 'sell_side')),
  CHECK (scope IN ('internal', 'external')),
  CHECK (class IN ('swing', 'equal', 'session_high', 'session_low', 'opening_range_high', 'opening_range_low', 'previous_day_high', 'previous_day_low', 'previous_week_high', 'previous_week_low')),
  CHECK (known_at >= formed_at),
  CHECK (valid_from >= known_at),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (touch_count >= 0 AND equal_count >= 1)
);

CREATE INDEX IF NOT EXISTS idx_features_liquidity_level_v2_lookup
  ON features_liquidity_level_v2 (symbol, scope, class, source_tf, known_at DESC);
CREATE INDEX IF NOT EXISTS idx_features_liquidity_level_v2_lifecycle
  ON features_liquidity_level_v2 (symbol, valid_from, valid_to, swept_at, broken_at, mitigated_at);

CREATE TABLE IF NOT EXISTS features_liquidity_event_v2 (
  event_id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL REFERENCES features_liquidity_level_v2(level_id),
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  event_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  source_tf TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  known_at TIMESTAMPTZ NOT NULL,
  penetration_atr DOUBLE PRECISION,
  close_back_bars INTEGER,
  extreme DOUBLE PRECISION NOT NULL,
  close DOUBLE PRECISION NOT NULL,
  displacement_atr DOUBLE PRECISION,
  structure_score DOUBLE PRECISION,
  killzone_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_versions JSONB NOT NULL DEFAULT '{}',
  evidence JSONB NOT NULL DEFAULT '{}',
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  CHECK (event_type IN ('raid', 'sweep', 'reclaim', 'break', 'retest', 'mitigation')),
  CHECK (direction IN ('bullish', 'bearish')),
  CHECK (known_at >= occurred_at),
  CHECK (penetration_atr IS NULL OR penetration_atr >= 0),
  CHECK (close_back_bars IS NULL OR close_back_bars >= 1)
);

CREATE INDEX IF NOT EXISTS idx_features_liquidity_event_v2_known
  ON features_liquidity_event_v2 (symbol, source_tf, known_at DESC);
CREATE INDEX IF NOT EXISTS idx_features_liquidity_event_v2_level
  ON features_liquidity_event_v2 (level_id, known_at DESC);

COMMENT ON TABLE market_window_occurrences IS 'Versioned DST-aware market time windows; intervals use [starts_at, ends_at).';
COMMENT ON TABLE features_session_range_v2 IS 'Evolving and complete session-range states with explicit knowledge time and coverage.';
COMMENT ON TABLE features_liquidity_level_v2 IS 'Typed internal/external liquidity levels with exact source lineage and PIT lifecycle.';
COMMENT ON TABLE features_liquidity_event_v2 IS 'Immutable liquidity event stream joined to exact level identity; known_at is actionable time.';
