-- Migration 160: Sweep/structure/iFVG lifecycle rescan open entries every cycle
--
-- Problem: All three lifecycle functions use `AND s.ts > v_from_ts` in their
-- candidate filter. Once the checkpoint cursor passes an entry's formation
-- timestamp, that entry is NEVER re-examined. A post-scan candle breach that
-- should trigger mitigation/invalidation is silently missed.
--
-- Fix: Drop the `ts > v_from_ts` filter for open entries (mitigated_at IS NULL
-- / invalidated_at IS NULL). The lookback window (`p_as_of_ts - p_lookback_interval`)
-- bounds total candidates; the open-state filter (IS NULL) keeps row counts
-- manageable. IS DISTINCT FROM prevents no-op writes on unchanged rows.
-- The checkpoint is advanced to p_as_of_ts after each cycle (same pattern as
-- migration 146's order_block rescan).
--
-- Also routes candle references through market.candles_1m_canonical.

BEGIN;

-- ============================================================
-- features_sweep lifecycle
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_sweep_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_sweep';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Scan ALL open sweeps within lookback window — no ts > v_from_ts filter,
  -- so sweeps that formed before the cursor are still rescanned for late
  -- mitigation. The lookback window bounds total candidates.
  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level,
           s.mitigated_at
    FROM features_sweep s
    WHERE s.symbol = p_symbol
      AND s.mitigated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts ASC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM market.candles_1m_canonical c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts <= p_as_of_ts
          AND (
            (cnd.direction = 'bullish' AND c.c > cnd.level)
            OR (cnd.direction = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS mit_ts_new
    FROM candidates cnd
  ),
  upd AS (
    UPDATE features_sweep s
    SET mitigated_at = COALESCE(c.mit_ts_new, s.mitigated_at)
    FROM computed c
    WHERE s.symbol = c.symbol
      AND s.tf = c.tf
      AND s.ts = c.ts
      AND s.mitigated_at IS DISTINCT FROM c.mit_ts_new
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_structure lifecycle
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_structure_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_structure';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Scan ALL open structures within lookback window — no ts > v_from_ts filter.
  WITH candidates AS (
    SELECT s.symbol, s.tf, s.ts, s.direction, s.level,
           s.invalidated_at
    FROM features_structure s
    WHERE s.symbol = p_symbol
      AND s.invalidated_at IS NULL
      AND s.ts >= p_as_of_ts - p_lookback_interval
      AND s.ts <= p_as_of_ts
    ORDER BY s.ts ASC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      (
        SELECT c.ts
        FROM market.candles_1m_canonical c
        WHERE c.symbol = cnd.symbol
          AND c.ts > cnd.ts
          AND c.ts <= p_as_of_ts
          AND (
            (opposite_direction(cnd.direction) = 'bullish' AND c.c > cnd.level)
            OR (opposite_direction(cnd.direction) = 'bearish' AND c.c < cnd.level)
          )
        ORDER BY c.ts ASC
        LIMIT 1
      ) AS inv_ts_new
    FROM candidates cnd
  ),
  upd AS (
    UPDATE features_structure s
    SET invalidated_at = COALESCE(c.inv_ts_new, s.invalidated_at)
    FROM computed c
    WHERE s.symbol = c.symbol
      AND s.tf = c.tf
      AND s.ts = c.ts
      AND s.invalidated_at IS DISTINCT FROM c.inv_ts_new
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- features_ifvg lifecycle
-- ============================================================
CREATE OR REPLACE FUNCTION refresh_ifvg_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_ifvg';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  -- Scan ALL open iFVGs within lookback window — no ts > v_from_ts filter.
  WITH candidates AS (
    SELECT f.symbol, f.tf, f.ts, f.top, f.bottom, f.direction,
           f.first_touch_at, f.fill_pct, f.mitigated_at, f.invalidated_at, f.is_fresh
    FROM features_ifvg f
    WHERE f.symbol = p_symbol
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
    ORDER BY f.ts ASC
    LIMIT p_limit
  ),
  computed AS (
    SELECT
      cnd.symbol,
      cnd.tf,
      cnd.ts,
      life.first_touch_at_new,
      COALESCE(life.fill_pct_new, 0::double precision) AS fill_pct_new,
      COALESCE(life.fill_mitigation_at_new, life.invalidated_at_new) AS mitigated_at_new,
      life.invalidated_at_new,
      life.invalidated_at_new IS NULL AS is_fresh_new
    FROM candidates cnd
    LEFT JOIN LATERAL (
      SELECT
        MIN(c.ts) FILTER (
          WHERE c.h >= cnd.bottom AND c.l <= cnd.top
        ) AS first_touch_at_new,
        MAX(
          CASE
            WHEN c.h < cnd.bottom OR c.l > cnd.top OR cnd.top <= cnd.bottom THEN NULL
            WHEN cnd.direction = 'bullish'
              THEN LEAST(1::double precision, GREATEST(0::double precision,
                (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0)))
            ELSE LEAST(1::double precision, GREATEST(0::double precision,
                (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0)))
          END
        ) AS fill_pct_new,
        MIN(c.ts) FILTER (
          WHERE c.h >= cnd.bottom AND c.l <= cnd.top
            AND CASE
              WHEN cnd.direction = 'bullish'
                THEN (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
              ELSE (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
            END
        ) AS fill_mitigation_at_new,
        MIN(c.ts) FILTER (
          WHERE (cnd.direction = 'bullish' AND c.c < cnd.bottom)
             OR (cnd.direction = 'bearish' AND c.c > cnd.top)
        ) AS invalidated_at_new
      FROM market.candles_1m_canonical c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
    ) life ON TRUE
  ),
  upd AS (
    UPDATE features_ifvg f
    SET
      first_touch_at = c.first_touch_at_new,
      fill_pct = c.fill_pct_new,
      mitigated_at = c.mitigated_at_new,
      invalidated_at = c.invalidated_at_new,
      is_fresh = c.is_fresh_new
    FROM computed c
    WHERE f.symbol = c.symbol
      AND f.tf = c.tf
      AND f.ts = c.ts
      AND (f.first_touch_at, f.fill_pct, f.mitigated_at,
           f.invalidated_at, f.is_fresh)
          IS DISTINCT FROM
          (c.first_touch_at_new, c.fill_pct_new, c.mitigated_at_new,
           c.invalidated_at_new, c.is_fresh_new)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
