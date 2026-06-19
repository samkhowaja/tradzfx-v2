-- Add spread column to raw 1m candles so the spread feature can compute an
-- average spread over recent bars.

ALTER TABLE candles_1m
  ADD COLUMN IF NOT EXISTS spread DOUBLE PRECISION;
