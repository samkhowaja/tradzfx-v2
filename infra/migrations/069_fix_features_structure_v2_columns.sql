-- Fix schema drift in features_structure v2.
-- Migration 050 added these columns, but the live table was recreated without them.
-- This migration re-adds them safely and backfills conservative defaults.

-- @reconcile: column:features_structure.strength
-- @reconcile: column:features_structure.confirmed
-- @reconcile: column:features_structure.confirmation_ts
-- @reconcile: column:features_structure.opposing_sweep_ts
-- @reconcile: column:features_structure.htf_aligned

ALTER TABLE features_structure
    ADD COLUMN IF NOT EXISTS strength TEXT,
    ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS confirmation_ts TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS opposing_sweep_ts TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS htf_aligned BOOLEAN DEFAULT FALSE;

-- Backfill existing rows with conservative defaults where NULL.
UPDATE features_structure
SET strength = COALESCE(strength, 'medium'),
    confirmed = COALESCE(confirmed, FALSE),
    htf_aligned = COALESCE(htf_aligned, FALSE)
WHERE strength IS NULL
   OR confirmed IS NULL
   OR htf_aligned IS NULL;
