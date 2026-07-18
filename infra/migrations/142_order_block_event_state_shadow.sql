-- Order-block event/state dual-write shadow pilot.
-- No live or PIT reader uses these relations. Historical rows without exact
-- source lineage remain excluded. History records observation time and must not
-- be treated as reconstructed point-in-time truth.

CREATE TABLE IF NOT EXISTS public.order_block_event_shadow (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  logical_id BYTEA NOT NULL UNIQUE,
  symbol TEXT NOT NULL,
  tf TEXT NOT NULL,
  formed_at TIMESTAMPTZ NOT NULL,
  source_event_ts TIMESTAMPTZ NOT NULL,
  source_event_type TEXT NOT NULL,
  source_event_direction TEXT NOT NULL,
  source_event_level DOUBLE PRECISION NOT NULL,
  ob_kind TEXT NOT NULL,
  first_observed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT order_block_event_shadow_logical_id_32_check
    CHECK (octet_length(logical_id) = 32)
);

CREATE INDEX IF NOT EXISTS idx_order_block_event_shadow_anchor
  ON public.order_block_event_shadow(symbol, tf, formed_at DESC);

CREATE TABLE IF NOT EXISTS public.order_block_state_shadow (
  event_id BIGINT PRIMARY KEY
    REFERENCES public.order_block_event_shadow(event_id) ON DELETE RESTRICT,
  degree TEXT NOT NULL,
  top DOUBLE PRECISION NOT NULL,
  bottom DOUBLE PRECISION NOT NULL,
  body_top DOUBLE PRECISION,
  body_bottom DOUBLE PRECISION,
  is_fresh BOOLEAN NOT NULL,
  first_touch_at TIMESTAMPTZ,
  fill_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  mitigated_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  state_version BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT order_block_state_shadow_geometry_check CHECK (bottom <= top),
  CONSTRAINT order_block_state_shadow_fill_check
    CHECK (fill_pct >= 0 AND fill_pct <= 1)
);

-- Cross-table temporal validity is enforced in mirror trigger because
-- PostgreSQL CHECK constraints cannot contain subqueries.
CREATE TABLE IF NOT EXISTS public.order_block_state_history_shadow (
  event_id BIGINT NOT NULL
    REFERENCES public.order_block_event_shadow(event_id) ON DELETE RESTRICT,
  state_version BIGINT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  degree TEXT NOT NULL,
  top DOUBLE PRECISION NOT NULL,
  bottom DOUBLE PRECISION NOT NULL,
  body_top DOUBLE PRECISION,
  body_bottom DOUBLE PRECISION,
  is_fresh BOOLEAN NOT NULL,
  first_touch_at TIMESTAMPTZ,
  fill_pct DOUBLE PRECISION NOT NULL,
  mitigated_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  PRIMARY KEY (event_id, state_version)
);

CREATE INDEX IF NOT EXISTS idx_order_block_state_history_shadow_observed
  ON public.order_block_state_history_shadow(event_id, observed_at DESC);

CREATE OR REPLACE FUNCTION public.mirror_order_block_event_state_shadow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id BIGINT;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_state_version BIGINT;
BEGIN
  IF NEW.logical_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.order_block_event_shadow (
    logical_id, symbol, tf, formed_at,
    source_event_ts, source_event_type, source_event_direction, source_event_level,
    ob_kind
  ) VALUES (
    NEW.logical_id, NEW.symbol, NEW.tf, COALESCE(NEW.formation_ts, NEW.ts),
    NEW.source_event_ts, NEW.source_event_type, NEW.source_event_direction, NEW.source_event_level,
    NEW.ob_kind
  )
  ON CONFLICT (logical_id) DO NOTHING;

  SELECT event_id INTO STRICT v_event_id
  FROM public.order_block_event_shadow
  WHERE logical_id = NEW.logical_id;

  IF NEW.first_touch_at IS NOT NULL AND NEW.first_touch_at < COALESCE(NEW.formation_ts, NEW.ts) THEN
    RAISE EXCEPTION 'order-block first_touch_at precedes formation for logical_id %', encode(NEW.logical_id, 'hex');
  END IF;

  INSERT INTO public.order_block_state_shadow (
    event_id, degree, top, bottom, body_top, body_bottom,
    is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at,
    engine_ver, input_hash, state_version, updated_at
  ) VALUES (
    v_event_id, NEW.degree, NEW.top, NEW.bottom, NEW.body_top, NEW.body_bottom,
    COALESCE(NEW.is_fresh, TRUE), NEW.first_touch_at,
    COALESCE(NEW.fill_pct, 0), NEW.mitigated_at, NEW.invalidated_at,
    NEW.engine_ver, NEW.input_hash, 1, v_now
  )
  ON CONFLICT (event_id) DO UPDATE SET
    degree = EXCLUDED.degree,
    top = EXCLUDED.top,
    bottom = EXCLUDED.bottom,
    body_top = EXCLUDED.body_top,
    body_bottom = EXCLUDED.body_bottom,
    is_fresh = EXCLUDED.is_fresh,
    first_touch_at = EXCLUDED.first_touch_at,
    fill_pct = EXCLUDED.fill_pct,
    mitigated_at = EXCLUDED.mitigated_at,
    invalidated_at = EXCLUDED.invalidated_at,
    engine_ver = EXCLUDED.engine_ver,
    input_hash = EXCLUDED.input_hash,
    state_version = order_block_state_shadow.state_version + 1,
    updated_at = EXCLUDED.updated_at
  WHERE (order_block_state_shadow.degree,
         order_block_state_shadow.top,
         order_block_state_shadow.bottom,
         order_block_state_shadow.body_top,
         order_block_state_shadow.body_bottom,
         order_block_state_shadow.is_fresh,
         order_block_state_shadow.first_touch_at,
         order_block_state_shadow.fill_pct,
         order_block_state_shadow.mitigated_at,
         order_block_state_shadow.invalidated_at,
         order_block_state_shadow.engine_ver,
         order_block_state_shadow.input_hash)
    IS DISTINCT FROM
        (EXCLUDED.degree,
         EXCLUDED.top,
         EXCLUDED.bottom,
         EXCLUDED.body_top,
         EXCLUDED.body_bottom,
         EXCLUDED.is_fresh,
         EXCLUDED.first_touch_at,
         EXCLUDED.fill_pct,
         EXCLUDED.mitigated_at,
         EXCLUDED.invalidated_at,
         EXCLUDED.engine_ver,
         EXCLUDED.input_hash)
  RETURNING state_version INTO v_state_version;

  IF v_state_version IS NOT NULL THEN
    INSERT INTO public.order_block_state_history_shadow (
      event_id, state_version, observed_at, degree, top, bottom, body_top, body_bottom,
      is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at, engine_ver, input_hash
    ) VALUES (
      v_event_id, v_state_version, v_now, NEW.degree, NEW.top, NEW.bottom,
      NEW.body_top, NEW.body_bottom, COALESCE(NEW.is_fresh, TRUE),
      NEW.first_touch_at, COALESCE(NEW.fill_pct, 0), NEW.mitigated_at,
      NEW.invalidated_at, NEW.engine_ver, NEW.input_hash
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_order_block_event_state_shadow
  ON public.features_order_block;
CREATE TRIGGER trg_mirror_order_block_event_state_shadow
AFTER INSERT OR UPDATE OF logical_id, is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at
ON public.features_order_block
FOR EACH ROW
EXECUTE FUNCTION public.mirror_order_block_event_state_shadow();
