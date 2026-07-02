-- Add body-based order-block range columns.
-- The full candle high/low is kept for backward compatibility; body_top/body_bottom
-- allow strategies to use a tighter, more precise OB zone.
ALTER TABLE features_order_block
  ADD COLUMN IF NOT EXISTS body_top DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS body_bottom DOUBLE PRECISION;
