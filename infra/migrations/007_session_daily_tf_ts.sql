-- Migration 007: Add tf/ts columns to daily session tables
-- The DAG runner and strategy compiler expect every feature table to have
-- symbol, tf, ts columns for "latest as of" joins. Daily session tables use
-- `date` as the logical time key, but still need tf/ts for pipeline compatibility.

-- Opening range
ALTER TABLE features_opening_range
  ADD COLUMN IF NOT EXISTS tf TEXT,
  ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;

-- Session H/L
ALTER TABLE features_session_hl
  ADD COLUMN IF NOT EXISTS tf TEXT,
  ADD COLUMN IF NOT EXISTS ts TIMESTAMPTZ;

-- Backfill tf/ts from existing rows so strategy SQL can join them
UPDATE features_opening_range SET tf = COALESCE(tf, '1d'), ts = COALESCE(ts, date + interval '1 day' - interval '1 second') WHERE tf IS NULL;
UPDATE features_session_hl SET tf = COALESCE(tf, '1d'), ts = COALESCE(ts, date + interval '1 day' - interval '1 second') WHERE tf IS NULL;

-- Drop and recreate primary keys to include tf
ALTER TABLE features_opening_range DROP CONSTRAINT IF EXISTS features_opening_range_pkey;
ALTER TABLE features_opening_range ADD PRIMARY KEY (symbol, tf, date, session, range_minutes);

ALTER TABLE features_session_hl DROP CONSTRAINT IF EXISTS features_session_hl_pkey;
ALTER TABLE features_session_hl ADD PRIMARY KEY (symbol, tf, date, session);
