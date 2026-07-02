-- Fix iFVG lifecycle direction semantics.
-- Mitigation = close beyond the iFVG direction (bullish: close above top, bearish: close below bottom).
-- Invalidation = close beyond the far side (bullish: close below bottom, bearish: close above top).
-- The previous implementation swapped these two checks, causing every confirmed iFVG to be
-- incorrectly marked as invalidated and therefore never tradable.

CREATE OR REPLACE FUNCTION refresh_ifvg_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count INT;
  v_max_ts TIMESTAMPTZ;
  v_table_name TEXT := 'features_ifvg';
BEGIN
  INSERT INTO lifecycle_refresh_state (symbol, table_name) VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  SELECT GREATEST(last_processed_ts, p_as_of_ts - p_lookback_interval)
  INTO v_from_ts
  FROM lifecycle_refresh_state
  WHERE symbol = p_symbol AND table_name = v_table_name;

  WITH candidates AS (
    SELECT f.symbol, f.tf, f.ts, f.top, f.bottom, f.direction
    FROM features_ifvg f
    WHERE f.symbol = p_symbol
      AND f.invalidated_at IS NULL
      AND f.ts >= p_as_of_ts - p_lookback_interval
      AND f.ts <= p_as_of_ts
      AND f.ts > v_from_ts
    ORDER BY f.ts ASC
    LIMIT p_limit
  ),
  first_touches AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, ft.ts AS first_touch_ts
    FROM candidates cnd
    CROSS JOIN LATERAL (
      SELECT c.ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND c.h >= cnd.bottom
        AND c.l <= cnd.top
      ORDER BY c.ts ASC
      LIMIT 1
    ) ft
  ),
  mitigations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, mg.ts AS mg_ts
    FROM candidates cnd
    CROSS JOIN LATERAL (
      SELECT c.ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND (
          (cnd.direction = 'bullish' AND c.c > cnd.top)
          OR (cnd.direction = 'bearish' AND c.c < cnd.bottom)
        )
      ORDER BY c.ts ASC
      LIMIT 1
    ) mg
  ),
  invalidations AS (
    SELECT cnd.symbol, cnd.tf, cnd.ts, inv.ts AS inv_ts
    FROM candidates cnd
    CROSS JOIN LATERAL (
      SELECT c.ts
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
        AND (
          (cnd.direction = 'bullish' AND c.c < cnd.bottom)
          OR (cnd.direction = 'bearish' AND c.c > cnd.top)
        )
      ORDER BY c.ts ASC
      LIMIT 1
    ) inv
  ),
  fill_pcts AS (
    SELECT ft.symbol, ft.tf, ft.ts, fp.fill_pct
    FROM first_touches ft
    JOIN candidates cnd USING (symbol, tf, ts)
    CROSS JOIN LATERAL (
      SELECT
        CASE
          WHEN cnd.direction = 'bullish'
            THEN LEAST(1, GREATEST(0, MAX((cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0))))
          ELSE LEAST(1, GREATEST(0, MAX((LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0))))
        END AS fill_pct
      FROM candles_1m c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= ft.first_touch_ts
    ) fp
  ),
  computed AS (
    SELECT
      COALESCE(ft.symbol, mg.symbol, i.symbol) AS symbol,
      COALESCE(ft.tf, mg.tf, i.tf) AS tf,
      COALESCE(ft.ts, mg.ts, i.ts) AS ts,
      ft.first_touch_ts AS first_touch_at,
      fp.fill_pct,
      mg.mg_ts AS mitigated_at,
      i.inv_ts AS invalidated_at
    FROM first_touches ft
    FULL OUTER JOIN mitigations mg USING (symbol, tf, ts)
    FULL OUTER JOIN invalidations i USING (symbol, tf, ts)
    LEFT JOIN fill_pcts fp USING (symbol, tf, ts)
  ),
  upd AS (
    UPDATE features_ifvg f
    SET
      first_touch_at = c.first_touch_at,
      fill_pct = COALESCE(c.fill_pct, f.fill_pct, 0),
      mitigated_at = COALESCE(c.mitigated_at, f.mitigated_at),
      invalidated_at = c.invalidated_at,
      is_fresh = (c.invalidated_at IS NULL)
    FROM candidates cnd
    LEFT JOIN computed c ON c.symbol = cnd.symbol AND c.tf = cnd.tf AND c.ts = cnd.ts
    WHERE f.symbol = cnd.symbol
      AND f.tf = cnd.tf
      AND f.ts = cnd.ts
    RETURNING f.ts
  )
  SELECT COUNT(*), MAX(ts) INTO v_count, v_max_ts FROM upd;

  UPDATE lifecycle_refresh_state
  SET last_processed_ts = COALESCE(v_max_ts, p_as_of_ts)
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
