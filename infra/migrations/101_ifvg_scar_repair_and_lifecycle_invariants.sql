-- Migration 101: Repair iFVG lifecycle scars and enforce lifecycle invariants.
--
-- Root cause (reports/BACKTEST_FAILURES_AND_BUGS_2026-07-09_V2.md §1/§8.1/§9.3):
--   A pre-052 bug swapped mitigation/invalidation in refresh_ifvg_lifecycle(),
--   writing invalidated_at / mitigated_at timestamps that are EARLIER than the
--   row's own ts (a logically impossible state) for ~99.7% of features_ifvg
--   rows. The corrected function (052) only processes rows where
--   invalidated_at IS NULL, so it can never self-heal the scarred rows, and the
--   orchestrator (scripts/refresh-lifecycle.js) skips features_ifvg by default.
--   Net effect: is_fresh = false for every row → smart_risk_ob_ifvg_1m and every
--   iFVG consumer produce 0 signals.
--
-- This migration:
--   1. Surgically clears provably-corrupt lifecycle timestamps on features_ifvg
--      (invalidated_at < ts OR mitigated_at < ts). These states are impossible,
--      so NULLing them is always safe; first_touch_at / fill_pct are preserved.
--      The corrected refresh recomputes the true values from candles afterward.
--   2. Adds lifecycle invariants as CHECK constraints (NOT VALID, so we do not
--      scan multi-million-row tables) on the level features so a future buggy
--      refresh cannot re-write backward timestamps. NOT VALID still enforces on
--      every INSERT/UPDATE going forward, which is what prevents re-scarring.
--
-- Scoped to features_ifvg for the data repair because features_zone and
-- features_order_block were verified clean (0 scarred rows on XAUUSD). The
-- invariants are added to all three level tables for uniform future-proofing.

BEGIN;

-- 1. Repair provably-corrupt iFVG lifecycle state (all symbols).
UPDATE features_ifvg
SET invalidated_at = NULL,
    mitigated_at   = NULL,
    is_fresh       = true
WHERE invalidated_at < ts
   OR mitigated_at   < ts;

-- 2. Lifecycle invariants (NOT VALID = enforce on new writes without scanning).
DO $$ BEGIN
  -- features_ifvg
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ifvg_inv_after_ts') THEN
    ALTER TABLE features_ifvg ADD CONSTRAINT ifvg_inv_after_ts
      CHECK (invalidated_at IS NULL OR invalidated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ifvg_mit_after_ts') THEN
    ALTER TABLE features_ifvg ADD CONSTRAINT ifvg_mit_after_ts
      CHECK (mitigated_at IS NULL OR mitigated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ifvg_geometry') THEN
    ALTER TABLE features_ifvg ADD CONSTRAINT ifvg_geometry
      CHECK (bottom <= top) NOT VALID;
  END IF;

  -- features_zone (currently clean; guardrail only)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_inv_after_ts') THEN
    ALTER TABLE features_zone ADD CONSTRAINT zone_inv_after_ts
      CHECK (invalidated_at IS NULL OR invalidated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_mit_after_ts') THEN
    ALTER TABLE features_zone ADD CONSTRAINT zone_mit_after_ts
      CHECK (mitigated_at IS NULL OR mitigated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'zone_geometry') THEN
    ALTER TABLE features_zone ADD CONSTRAINT zone_geometry
      CHECK (bottom <= top) NOT VALID;
  END IF;

  -- features_order_block (currently clean; guardrail only)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ob_inv_after_ts') THEN
    ALTER TABLE features_order_block ADD CONSTRAINT ob_inv_after_ts
      CHECK (invalidated_at IS NULL OR invalidated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ob_mit_after_ts') THEN
    ALTER TABLE features_order_block ADD CONSTRAINT ob_mit_after_ts
      CHECK (mitigated_at IS NULL OR mitigated_at >= ts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ob_geometry') THEN
    ALTER TABLE features_order_block ADD CONSTRAINT ob_geometry
      CHECK (bottom <= top) NOT VALID;
  END IF;
END $$;

COMMIT;
