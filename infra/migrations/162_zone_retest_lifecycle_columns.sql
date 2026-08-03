-- Migration 162: add lifecycle columns to features_zone_retest.
--
-- refresh_zone_retest_lifecycle() (restored by migration 158) scans open retest
-- events and stamps mitigated_at / invalidated_at from candle intersections, but
-- the table never had those columns — the function failed on every call
-- ("column zr.mitigated_at does not exist"). Non-destructive ADD COLUMN.

BEGIN;

ALTER TABLE public.features_zone_retest
  ADD COLUMN IF NOT EXISTS mitigated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invalidated_at TIMESTAMPTZ;

COMMIT;
