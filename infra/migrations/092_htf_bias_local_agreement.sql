-- 092_htf_bias_local_agreement.sql
-- Add local_agreement column so the HTF bias feature can expose how well the
-- trading timeframe aligns with higher-timeframe consensus.

ALTER TABLE features_htf_bias
    ADD COLUMN IF NOT EXISTS local_agreement DOUBLE PRECISION;
