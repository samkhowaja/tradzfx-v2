-- Optimize incremental lifecycle refresh functions.
--
-- The original set-based joins scanned all future candles for every open row,
-- which was too slow for dense symbols such as XAUUSD. This migration replaces
-- them with early-exit scalar subqueries (one index lookup per row per event)
-- so each refresh call stops at the first mitigating/invalidating candle.
--
-- Partial indexes on the open rows are also added to speed candidate selection.

-- Partial indexes for open-row candidate scans.
CREATE INDEX IF NOT EXISTS idx_features_zone_open_lifecycle
  ON features_zone(symbol, ts)
  WHERE mitigated_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_order_block_open_lifecycle
  ON features_order_block(symbol, ts)
  WHERE mitigated_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_ifvg_open_lifecycle
  ON features_ifvg(symbol, ts)
  WHERE mitigated_at IS NULL AND invalidated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_sweep_open_lifecycle
  ON features_sweep(symbol, ts)
  WHERE mitigated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_features_structure_open_lifecycle
  ON features_structure(symbol, ts)
  WHERE invalidated_at IS NULL;

-- Refresh features_zone lifecycle using early-exit index lookups.
CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT z.symbol, z.tf, z.ts, z.top, z.bottom, z.zone_kind, z.direction
    FROM features_zone z
    WHERE z.symbol = p_symbol
      AND z.mitigated_at IS NULL
      AND z.invalidated_at IS NULL
      AND z.ts >= p_as_of_ts - p_lookback_interval
      AND z.ts <= p_as_of_ts
    ORDER BY z.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND c.h >= cnd.bottom
          AND c.l <= cnd.top
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (
              CASE
                WHEN cnd.zone_kind = 'demand' THEN 'bullish'
                WHEN cnd.zone_kind = 'supply' THEN 'bearish'
                ELSE COALESCE(cnd.direction, 'bullish')
              END = 'bullish'
              AND c.c < cnd.bottom
            )
            OR
            (
              CASE
                WHEN cnd.zone_kind = 'demand' THEN 'bullish'
                WHEN cnd.zone_kind = 'supply' THEN 'bearish'
                ELSE COALESCE(cnd.direction, 'bullish')
              END = 'bearish'
              AND c.c > cnd.top
            )
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_zone z
  SET
    mitigated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN NULL
      ELSE c.mit_ts
    END,
    invalidated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN c.inv_ts
      ELSE NULL
    END,
    is_fresh = false,
    tapped = CASE
      WHEN c.mit_ts IS NOT NULL AND NOT (c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts)) THEN true
      ELSE z.tapped
    END
  FROM computed c
  WHERE z.symbol = c.symbol
    AND z.tf = c.tf
    AND z.ts = c.ts
    AND (c.mit_ts IS NOT NULL OR c.inv_ts IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_order_block lifecycle using early-exit index lookups.
CREATE OR REPLACE FUNCTION refresh_order_block_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT ob.symbol, ob.tf, ob.ts, ob.top, ob.bottom, ob.ob_kind
    FROM features_order_block ob
    WHERE ob.symbol = p_symbol
      AND ob.mitigated_at IS NULL
      AND ob.invalidated_at IS NULL
      AND ob.ts >= p_as_of_ts - p_lookback_interval
      AND ob.ts <= p_as_of_ts
    ORDER BY ob.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND c.h >= cnd.bottom
          AND c.l <= cnd.top
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.ob_kind = 'bullish' AND c.c < cnd.bottom)
            OR (cnd.ob_kind = 'bearish' AND c.c > cnd.top)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_order_block ob
  SET
    mitigated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN NULL
      ELSE c.mit_ts
    END,
    invalidated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN c.inv_ts
      ELSE NULL
    END,
    is_fresh = false
  FROM computed c
  WHERE ob.symbol = c.symbol
    AND ob.tf = c.tf
    AND ob.ts = c.ts
    AND (c.mit_ts IS NOT NULL OR c.inv_ts IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_ifvg lifecycle using early-exit index lookups.
-- iFVG semantics: mitigation = close beyond in iFVG direction (it fails as S/R);
-- invalidation = close beyond the far side (it holds and is confirmed).
CREATE OR REPLACE FUNCTION refresh_ifvg_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT f.symbol, f.tf, f.ts, f.top, f.bottom, f.direction
    FROM features_ifvg f
    WHERE f.symbol = p_symbol
      AND f.mitigated_at IS NULL
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
    ORDER BY f.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c < cnd.bottom)
            OR (cnd.direction = 'bearish' AND c.c > cnd.top)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (opposite_direction(cnd.direction) = 'bullish' AND c.c < cnd.bottom)
            OR (opposite_direction(cnd.direction) = 'bearish' AND c.c > cnd.top)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_ifvg f
  SET
    mitigated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN NULL
      ELSE c.mit_ts
    END,
    invalidated_at = CASE
      WHEN c.inv_ts IS NOT NULL AND (c.mit_ts IS NULL OR c.inv_ts < c.mit_ts) THEN c.inv_ts
      ELSE NULL
    END,
    is_fresh = false
  FROM computed c
  WHERE f.symbol = c.symbol
    AND f.tf = c.tf
    AND f.ts = c.ts
    AND (c.mit_ts IS NOT NULL OR c.inv_ts IS NOT NULL);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_sweep lifecycle using early-exit index lookups.
-- Sweep mitigation = price later closes beyond the swept level in the sweep direction.
CREATE OR REPLACE FUNCTION refresh_sweep_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_sweep s
    WHERE s.symbol = p_symbol
      AND s.mitigated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c > cnd.level)
            OR (cnd.direction = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts
    FROM candidates cnd
  )
  UPDATE features_sweep s
  SET
    mitigated_at = c.mit_ts,
    is_fresh = false
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts
    AND c.mit_ts IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- Refresh features_structure lifecycle using early-exit index lookups.
-- Structure invalidation = price closes beyond the broken level in the opposite direction.
CREATE OR REPLACE FUNCTION refresh_structure_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol) VALUES (p_symbol)
  ON CONFLICT (symbol) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol;

  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level
    FROM features_structure s
    WHERE s.symbol = p_symbol
      AND s.invalidated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts DESC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM candles_1m c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts > v_from_ts
          AND c.ts <= p_as_of_ts
          AND (
            (opposite_direction(cnd.direction) = 'bullish' AND c.c > cnd.level)
            OR (opposite_direction(cnd.direction) = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts
    FROM candidates cnd
  )
  UPDATE features_structure s
  SET
    invalidated_at = c.inv_ts,
    is_fresh = false
  FROM computed c
  WHERE s.symbol = c.symbol
    AND s.tf = c.tf
    AND s.ts = c.ts
    AND c.inv_ts IS NOT NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
