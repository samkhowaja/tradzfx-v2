-- 091_drop_legacy_fresh_functions.sql
-- Remove the legacy point-in-time freshness helpers. The PIT backtester and
-- live compiler now use the stored lifecycle columns (mitigated_at,
-- invalidated_at) directly, so these functions are no longer called.

DROP FUNCTION IF EXISTS is_band_fresh;
DROP FUNCTION IF EXISTS is_structure_fresh;
