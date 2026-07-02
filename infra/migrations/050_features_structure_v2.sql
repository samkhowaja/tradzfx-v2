-- Extend features_structure for Structure Detection v2:
-- confirmation, strength grading, HTF alignment, and failure tracking.

ALTER TABLE features_structure
    ADD COLUMN IF NOT EXISTS strength TEXT,
    ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS confirmation_ts TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS opposing_sweep_ts TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS htf_aligned BOOLEAN DEFAULT FALSE;

-- Backfill existing rows with conservative defaults.
UPDATE features_structure
SET confirmed = FALSE,
    htf_aligned = FALSE
WHERE confirmed IS NULL;
