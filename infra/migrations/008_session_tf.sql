-- Migration 008: Add tf column to features_session
-- The compiler generates "WHERE tf = '...'" for all feature CTEs.

ALTER TABLE features_session
  ADD COLUMN IF NOT EXISTS tf TEXT;

UPDATE features_session SET tf = COALESCE(tf, '1m') WHERE tf IS NULL;

ALTER TABLE features_session DROP CONSTRAINT IF EXISTS features_session_pkey;
ALTER TABLE features_session ADD PRIMARY KEY (symbol, tf, ts);
