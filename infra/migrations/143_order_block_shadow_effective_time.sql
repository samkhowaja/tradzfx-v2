-- Add market-effective time beside observation time for order-block shadow history.
-- `observed_at` is ingestion/audit time. `effective_at` is when represented state
-- became true in market time. Existing history is classified conservatively;
-- this does not fabricate missing intermediate lifecycle states and is not yet
-- sufficient for PIT reader cutover.

ALTER TABLE public.order_block_state_history_shadow
  ADD COLUMN IF NOT EXISTS effective_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS change_kind TEXT;

UPDATE public.order_block_state_history_shadow h
SET effective_at = GREATEST(
      e.formed_at,
      COALESCE(h.first_touch_at, '-infinity'::timestamptz),
      COALESCE(h.mitigated_at, '-infinity'::timestamptz),
      COALESCE(h.invalidated_at, '-infinity'::timestamptz)
    ),
    change_kind = CASE
      WHEN h.first_touch_at IS NOT NULL
        OR h.mitigated_at IS NOT NULL
        OR h.invalidated_at IS NOT NULL
        OR NOT h.is_fresh
      THEN 'lifecycle_snapshot'
      ELSE 'observation'
    END
FROM public.order_block_event_shadow e
WHERE e.event_id = h.event_id
  AND (h.effective_at IS NULL OR h.change_kind IS NULL);

ALTER TABLE public.order_block_state_history_shadow
  ALTER COLUMN effective_at SET NOT NULL,
  ALTER COLUMN change_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.order_block_state_history_shadow'::regclass
      AND conname = 'order_block_state_history_shadow_change_kind_check'
  ) THEN
    ALTER TABLE public.order_block_state_history_shadow
      ADD CONSTRAINT order_block_state_history_shadow_change_kind_check
      CHECK (change_kind IN ('observation', 'geometry_revision', 'lifecycle_transition', 'lifecycle_snapshot'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_order_block_state_history_shadow_effective
  ON public.order_block_state_history_shadow(event_id, effective_at DESC, state_version DESC);

CREATE OR REPLACE FUNCTION public.mirror_order_block_event_state_shadow()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_event_id BIGINT;
  v_formed_at TIMESTAMPTZ := COALESCE(NEW.formation_ts, NEW.ts);
  v_now TIMESTAMPTZ := clock_timestamp();
  v_state_version BIGINT;
  v_effective_at TIMESTAMPTZ;
  v_change_kind TEXT;
  v_prior public.order_block_state_shadow%ROWTYPE;
  v_had_prior BOOLEAN := FALSE;
  v_lifecycle_changed BOOLEAN := FALSE;
  v_geometry_changed BOOLEAN := FALSE;
BEGIN
  IF NEW.logical_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.order_block_event_shadow (
    logical_id, symbol, tf, formed_at,
    source_event_ts, source_event_type, source_event_direction, source_event_level,
    ob_kind
  ) VALUES (
    NEW.logical_id, NEW.symbol, NEW.tf, v_formed_at,
    NEW.source_event_ts, NEW.source_event_type, NEW.source_event_direction, NEW.source_event_level,
    NEW.ob_kind
  )
  ON CONFLICT (logical_id) DO NOTHING;

  SELECT event_id INTO STRICT v_event_id
  FROM public.order_block_event_shadow
  WHERE logical_id = NEW.logical_id;

  IF NEW.first_touch_at IS NOT NULL AND NEW.first_touch_at < v_formed_at THEN
    RAISE EXCEPTION 'order-block first_touch_at precedes formation for logical_id %', encode(NEW.logical_id, 'hex');
  END IF;

  SELECT * INTO v_prior
  FROM public.order_block_state_shadow
  WHERE event_id = v_event_id
  FOR UPDATE;
  v_had_prior := FOUND;

  IF v_had_prior THEN
    v_lifecycle_changed :=
      (v_prior.is_fresh, v_prior.first_touch_at, v_prior.fill_pct,
       v_prior.mitigated_at, v_prior.invalidated_at)
      IS DISTINCT FROM
      (COALESCE(NEW.is_fresh, TRUE), NEW.first_touch_at, COALESCE(NEW.fill_pct, 0),
       NEW.mitigated_at, NEW.invalidated_at);
    v_geometry_changed :=
      (v_prior.degree, v_prior.top, v_prior.bottom, v_prior.body_top, v_prior.body_bottom,
       v_prior.engine_ver, v_prior.input_hash)
      IS DISTINCT FROM
      (NEW.degree, NEW.top, NEW.bottom, NEW.body_top, NEW.body_bottom,
       NEW.engine_ver, NEW.input_hash);
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
    IF NOT v_had_prior THEN
      v_effective_at := GREATEST(
        v_formed_at,
        COALESCE(NEW.first_touch_at, '-infinity'::timestamptz),
        COALESCE(NEW.mitigated_at, '-infinity'::timestamptz),
        COALESCE(NEW.invalidated_at, '-infinity'::timestamptz)
      );
      v_change_kind := CASE
        WHEN NEW.first_touch_at IS NOT NULL OR NEW.mitigated_at IS NOT NULL
          OR NEW.invalidated_at IS NOT NULL OR NOT COALESCE(NEW.is_fresh, TRUE)
        THEN 'lifecycle_snapshot'
        ELSE 'observation'
      END;
    ELSIF v_lifecycle_changed THEN
      v_effective_at := GREATEST(
        v_formed_at,
        COALESCE(NEW.first_touch_at, '-infinity'::timestamptz),
        COALESCE(NEW.mitigated_at, '-infinity'::timestamptz),
        COALESCE(NEW.invalidated_at, '-infinity'::timestamptz)
      );
      v_change_kind := 'lifecycle_transition';
    ELSIF v_geometry_changed THEN
      v_effective_at := v_now;
      v_change_kind := 'geometry_revision';
    ELSE
      v_effective_at := v_now;
      v_change_kind := 'observation';
    END IF;

    INSERT INTO public.order_block_state_history_shadow (
      event_id, state_version, observed_at, effective_at, change_kind,
      degree, top, bottom, body_top, body_bottom,
      is_fresh, first_touch_at, fill_pct, mitigated_at, invalidated_at, engine_ver, input_hash
    ) VALUES (
      v_event_id, v_state_version, v_now, v_effective_at, v_change_kind,
      NEW.degree, NEW.top, NEW.bottom, NEW.body_top, NEW.body_bottom,
      COALESCE(NEW.is_fresh, TRUE), NEW.first_touch_at, COALESCE(NEW.fill_pct, 0),
      NEW.mitigated_at, NEW.invalidated_at, NEW.engine_ver, NEW.input_hash
    );
  END IF;

  RETURN NEW;
END;
$$;
