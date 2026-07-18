-- Align mutable order-block lifecycle maintenance with canonical replay semantics.
-- Canonical contract:
--   first_touch_at = first post-formation wick/body intersection;
--   fill_pct = cumulative deepest penetration as of p_as_of_ts;
--   mitigated_at = first >=50% penetration, falling back to invalidation;
--   invalidated_at = first close beyond the far side;
--   is_fresh = true until invalidation.
--
-- Candidates are rescanned across the bounded lookback on every call. The old
-- formation-time checkpoint skipped lifecycle changes that occurred after an
-- event's first scan. IS DISTINCT FROM prevents unchanged rows from being
-- rewritten and keeps drain loops finite.

CREATE OR REPLACE FUNCTION public.refresh_order_block_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_count INT;
  v_table_name TEXT := 'features_order_block';
BEGIN
  INSERT INTO public.lifecycle_refresh_state (symbol, table_name)
  VALUES (p_symbol, v_table_name)
  ON CONFLICT (symbol, table_name) DO NOTHING;

  WITH candidates AS (
    SELECT ob.symbol, ob.tf, ob.ts, ob.ob_kind, ob.top, ob.bottom,
           ob.first_touch_at, ob.fill_pct, ob.mitigated_at,
           ob.invalidated_at, ob.is_fresh
    FROM public.features_order_block ob
    WHERE ob.symbol = p_symbol
      AND ob.ts >= p_as_of_ts - p_lookback_interval
      AND ob.ts <= p_as_of_ts
    ORDER BY ob.ts ASC, ob.tf, ob.ob_kind, ob.top, ob.bottom
    LIMIT p_limit
  ), computed AS (
    SELECT cnd.*,
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
            WHEN cnd.ob_kind = 'bullish' THEN
              LEAST(1::double precision, GREATEST(0::double precision,
                (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0)))
            ELSE
              LEAST(1::double precision, GREATEST(0::double precision,
                (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0)))
          END
        ) AS fill_pct_new,
        MIN(c.ts) FILTER (
          WHERE c.h >= cnd.bottom
            AND c.l <= cnd.top
            AND CASE
              WHEN cnd.ob_kind = 'bullish' THEN
                (cnd.top - GREATEST(cnd.bottom, c.l)) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
              ELSE
                (LEAST(cnd.top, c.h) - cnd.bottom) / NULLIF(cnd.top - cnd.bottom, 0) >= 0.5
            END
        ) AS fill_mitigation_at_new,
        MIN(c.ts) FILTER (
          WHERE (cnd.ob_kind = 'bullish' AND c.c < cnd.bottom)
             OR (cnd.ob_kind = 'bearish' AND c.c > cnd.top)
        ) AS invalidated_at_new
      FROM market.candles_1m_canonical c
      WHERE c.symbol = cnd.symbol
        AND c.ts > cnd.ts
        AND c.ts <= p_as_of_ts
    ) life ON TRUE
  ), upd AS (
    UPDATE public.features_order_block ob
    SET first_touch_at = c.first_touch_at_new,
        fill_pct = c.fill_pct_new,
        mitigated_at = c.mitigated_at_new,
        invalidated_at = c.invalidated_at_new,
        is_fresh = c.is_fresh_new
    FROM computed c
    WHERE ob.symbol = c.symbol
      AND ob.tf = c.tf
      AND ob.ts = c.ts
      AND ob.ob_kind = c.ob_kind
      AND ob.top = c.top
      AND ob.bottom = c.bottom
      AND (ob.first_touch_at, ob.fill_pct, ob.mitigated_at,
           ob.invalidated_at, ob.is_fresh)
          IS DISTINCT FROM
          (c.first_touch_at_new, c.fill_pct_new, c.mitigated_at_new,
           c.invalidated_at_new, c.is_fresh_new)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM upd;

  UPDATE public.lifecycle_refresh_state
  SET last_processed_ts = p_as_of_ts
  WHERE symbol = p_symbol AND table_name = v_table_name;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
