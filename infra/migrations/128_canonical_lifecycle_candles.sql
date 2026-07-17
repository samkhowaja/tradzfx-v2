-- 128_canonical_lifecycle_candles.sql
-- Route active lifecycle calculations through effective-dated canonical candle
-- policy. Preserve function signatures and all lifecycle semantics verbatim.
-- Raw maintenance functions (for example delete_weekend_fx_candles) remain raw.

BEGIN;

DO $migration$
DECLARE
  r record;
  v_definition text;
  v_rewritten text;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.oid::regprocedure::text AS signature,
           pg_get_functiondef(p.oid) AS definition
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'refresh_ifvg_lifecycle',
        'refresh_order_block_lifecycle',
        'refresh_structure_lifecycle',
        'refresh_sweep_lifecycle',
        'refresh_zone_lifecycle',
        'refresh_zone_touch_events'
      )
      AND pg_get_functiondef(p.oid) ~ '\mcandles_1m\M'
  LOOP
    v_definition := r.definition;
    v_rewritten := regexp_replace(
      v_definition,
      '\mFROM[[:space:]]+candles_1m\M',
      'FROM market.candles_1m_canonical',
      'gi'
    );
    v_rewritten := regexp_replace(
      v_rewritten,
      '\mJOIN[[:space:]]+candles_1m\M',
      'JOIN market.candles_1m_canonical',
      'gi'
    );

    IF v_rewritten = v_definition THEN
      RAISE EXCEPTION 'Lifecycle function % references candles_1m but no supported FROM/JOIN pattern was rewritten',
        r.signature;
    END IF;

    EXECUTE v_rewritten;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'refresh_ifvg_lifecycle',
        'refresh_order_block_lifecycle',
        'refresh_structure_lifecycle',
        'refresh_sweep_lifecycle',
        'refresh_zone_lifecycle',
        'refresh_zone_touch_events'
      )
      AND pg_get_functiondef(p.oid) ~ '\m(FROM|JOIN)[[:space:]]+candles_1m\M'
  ) THEN
    RAISE EXCEPTION 'Canonical lifecycle migration incomplete: targeted function still reads raw candles_1m';
  END IF;
END;
$migration$;

COMMENT ON VIEW market.candles_1m_canonical IS
  'Effective-dated policy-selected candle stream used by runtime, PIT/backtest, feature production, and lifecycle calculations; missing policy fails closed.';

COMMIT;
