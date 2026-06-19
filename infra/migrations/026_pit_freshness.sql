-- PIT freshness helpers for lifecycle features.
-- These replace the static mitigated_at/invalidated_at filters so zones,
-- order blocks, FVGs and structure events are evaluated against the full
-- candle history up to the signal timestamp.

CREATE OR REPLACE FUNCTION is_band_fresh(
    p_symbol TEXT,
    p_band_ts TIMESTAMPTZ,
    p_top DOUBLE PRECISION,
    p_bottom DOUBLE PRECISION,
    p_direction TEXT,
    p_as_of_ts TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1
        FROM candles_1m c
        WHERE c.symbol = p_symbol
          AND c.ts > p_band_ts
          AND c.ts <= p_as_of_ts
          AND (
              -- invalidated: close beyond the far side
              (p_direction = 'bullish' AND c.c < p_bottom)
              OR (p_direction = 'bearish' AND c.c > p_top)
              -- mitigated: any wick touched the band
              OR (c.h >= p_bottom AND c.l <= p_top)
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION is_structure_fresh(
    p_symbol TEXT,
    p_event_ts TIMESTAMPTZ,
    p_level DOUBLE PRECISION,
    p_direction TEXT,
    p_as_of_ts TIMESTAMPTZ
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN NOT EXISTS (
        SELECT 1
        FROM candles_1m c
        WHERE c.symbol = p_symbol
          AND c.ts > p_event_ts
          AND c.ts <= p_as_of_ts
          AND (
              (p_direction = 'bullish' AND c.c < p_level)
              OR (p_direction = 'bearish' AND c.c > p_level)
          )
    );
END;
$$ LANGUAGE plpgsql STABLE;
