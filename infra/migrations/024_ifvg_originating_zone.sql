-- Add originating_zone_ts to features_ifvg so the chart can draw iFVG rectangles
-- from the original FVG formation candle instead of the detection/reversal candle.
ALTER TABLE features_ifvg
  ADD COLUMN IF NOT EXISTS originating_zone_ts TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_features_ifvg_originating_zone
  ON features_ifvg(symbol, tf, originating_zone_ts);
