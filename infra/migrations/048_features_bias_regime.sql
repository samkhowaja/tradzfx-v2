-- Extend features_bias to store the multi-factor RegimeBias model output.

ALTER TABLE features_bias
    ADD COLUMN IF NOT EXISTS regime TEXT,
    ADD COLUMN IF NOT EXISTS score_htf_alignment DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_ema_slope DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_structure DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_volume DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_session DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS score_volatility DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS factors TEXT;
