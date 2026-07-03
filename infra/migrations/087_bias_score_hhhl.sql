-- Add hhhl score column to features_bias for the simplified bias model.
ALTER TABLE features_bias
ADD COLUMN IF NOT EXISTS score_hhhl NUMERIC DEFAULT 0;

-- Backfill existing rows so the column is non-null for downstream reads.
UPDATE features_bias
SET score_hhhl = 0
WHERE score_hhhl IS NULL;
