-- Migration 093: Zone touch + retest counters
--
-- Track B (D013): retest zones are valid ICT/SMC entry candidates. To score
-- them properly we need to know how many times price has touched the zone
-- (touch_count) and how many of those touches happened *after* the first
-- touch (retest_count). The grader in entryQuality.ts already reads these
-- fields; this migration adds them to the storage layer so the engine can
-- persist them and the analyzer can use them for outcome learning.
--
-- touch_count  = total candle interactions with the zone (wick or body)
-- retest_count = touches that occurred AFTER first_touch_at (i.e. the zone
--                has been re-tested at least once)
--
-- Both default to 0 so existing rows remain valid. The lifecycle refresh
-- function is updated to compute these from candle interactions in the
-- lookback window.

ALTER TABLE features_zone
  ADD COLUMN IF NOT EXISTS touch_count  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retest_count INT NOT NULL DEFAULT 0;

-- Index for fast PIT lookups of zones that have been touched at least once
-- (used by the analyzer to learn retest-quality vs first-touch-quality).
CREATE INDEX IF NOT EXISTS idx_features_zone_touch
  ON features_zone(symbol, tf, ts DESC, touch_count)
  WHERE touch_count > 0;

CREATE INDEX IF NOT EXISTS idx_features_zone_retest
  ON features_zone(symbol, tf, ts DESC, retest_count)
  WHERE retest_count > 0;

-- Update refresh_zone_lifecycle to populate touch_count and retest_count.
-- A "touch" is any candle whose range overlaps the zone [bottom, top] after
-- the zone's formation_ts. The first such candle sets first_touch_at and
-- touch_count = 1; subsequent overlapping candles increment touch_count and
-- retest_count.
CREATE OR REPLACE FUNCTION refresh_zone_lifecycle(
  p_symbol TEXT,
  p_as_of_ts TIMESTAMPTZ DEFAULT NOW(),
  p_lookback_interval INTERVAL DEFAULT INTERVAL '10 days',
  p_limit INT DEFAULT 1000
) RETURNS INTEGER AS $$
DECLARE
  v_from_ts TIMESTAMPTZ;
  v_count   INT := 0;
BEGIN
  v_from_ts := p_as_of_ts - p_lookback_interval;

  WITH touches AS (
    SELECT
      z.symbol, z.tf, z.ts, z.zone_kind, z.top, z.bottom,
      COUNT(*) FILTER (
        WHERE c.ts > z.ts AND c.high >= z.bottom AND c.low <= z.top
      )::INT AS touch_count,
      COUNT(*) FILTER (
        WHERE c.ts > z.ts
          AND c.high >= z.bottom AND c.low <= z.top
          AND c.ts > COALESCE((
            SELECT MIN(c2.ts)
            FROM candles c2
            WHERE c2.symbol = z.symbol
              AND c2.tf     = z.tf
              AND c2.ts     > z.ts
              AND c2.high   >= z.bottom
              AND c2.low    <= z.top
          ), z.ts)
      )::INT AS retest_count
    FROM features_zone z
    LEFT JOIN LATERAL (
      SELECT ts, high, low
      FROM candles c
      WHERE c.symbol = z.symbol
        AND c.tf     = z.tf
        AND c.ts     > z.ts
        AND c.ts     <= p_as_of_ts
      ORDER BY c.ts ASC
    ) c ON TRUE
    WHERE z.symbol = p_symbol
      AND (z.mitigated_at IS NULL OR z.mitigated_at > v_from_ts)
      AND (z.invalidated_at IS NULL OR z.invalidated_at > v_from_ts)
    GROUP BY z.symbol, z.tf, z.ts, z.zone_kind, z.top, z.bottom
  )
  UPDATE features_zone z
  SET touch_count  = COALESCE(t.touch_count, 0),
      retest_count = COALESCE(t.retest_count, 0)
  FROM touches t
  WHERE z.symbol     = t.symbol
    AND z.tf         = t.tf
    AND z.ts         = t.ts
    AND z.zone_kind  = t.zone_kind
    AND z.top        = t.top
    AND z.bottom     = t.bottom;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
