-- Migration 108: Add lifecycle refresh functions for missing feature producers
-- P1 fix: Add refresh functions for features_atr, features_spread, features_zone_retest,
-- features_candle_pattern, features_pricing, features_displacement

BEGIN;

-- ============================================================
-- features_atr lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_atr_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- ATR doesn't have lifecycle columns (mitigated_at, invalidated_at) like zones/OBs.
  -- This function is a no-op for lifecycle but exists for API consistency with
  -- refresh-lifecycle.js which expects a function per feature table.
  -- The actual ATR computation is done by the feature engine (apps/engine/src/features/atr.ts).
  -- We just return 0 to indicate no lifecycle rows were updated.
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_spread lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_spread_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- Spread feature doesn't have lifecycle columns.
  -- This function exists for API consistency with refresh-lifecycle.js.
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_zone_retest lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_zone_retest_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- Zone retest doesn't have lifecycle columns (mitigated_at, invalidated_at).
  -- It's a derived feature from zones + candles. The actual computation
  -- happens in the feature engine (apps/engine/src/features/zoneRetest.ts).
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_candle_pattern lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_candle_pattern_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- Candle pattern doesn't have lifecycle columns.
  -- Computed by feature engine (apps/engine/src/features/candlePattern.ts).
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_pricing lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_pricing_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- Pricing doesn't have lifecycle columns.
  -- Computed by feature engine (apps/engine/src/features/pricing.ts).
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_displacement lifecycle refresh
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_displacement_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit INT
) RETURNS INT AS $$
DECLARE
  v_updated INT := 0;
  v_cutoff TIMESTAMPTZ := p_as_of_ts - p_lookback_interval;
BEGIN
  -- Displacement doesn't have lifecycle columns.
  -- Computed by feature engine (apps/engine/src/features/displacement.ts).
  RETURN 0;
END;
$$ LANGUAGE plpgsql;

COMMIT;