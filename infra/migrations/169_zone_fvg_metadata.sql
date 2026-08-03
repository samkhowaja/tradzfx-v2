-- Additive FVG measurement metadata. Values are observational only; no filters.
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS gap_size DOUBLE PRECISION;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS gap_atr_ratio DOUBLE PRECISION;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS middle_body_ratio DOUBLE PRECISION;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS middle_body_atr DOUBLE PRECISION;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS middle_body_vs_average DOUBLE PRECISION;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS direction_aligned BOOLEAN;
ALTER TABLE features_zone ADD COLUMN IF NOT EXISTS gap_percentile DOUBLE PRECISION;