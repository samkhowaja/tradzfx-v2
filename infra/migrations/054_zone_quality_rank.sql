-- Extend features_zone with a final ranking score and outcome hint.

ALTER TABLE features_zone
    ADD COLUMN IF NOT EXISTS rank_score DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS outcome TEXT;
