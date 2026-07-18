-- Deterministic market-time lifecycle replay for identified order-block events.
-- Separate from observation history: replay rows are reconstructed from canonical
-- 1m candles and never claim when the DB first learned a transition.

CREATE TABLE IF NOT EXISTS public.order_block_lifecycle_replay_shadow (
  event_id BIGINT NOT NULL
    REFERENCES public.order_block_event_shadow(event_id) ON DELETE RESTRICT,
  effective_at TIMESTAMPTZ NOT NULL,
  transition_kind TEXT NOT NULL,
  is_fresh BOOLEAN NOT NULL,
  first_touch_at TIMESTAMPTZ,
  fill_pct DOUBLE PRECISION NOT NULL,
  mitigated_at TIMESTAMPTZ,
  invalidated_at TIMESTAMPTZ,
  replayed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  replay_version TEXT NOT NULL,
  PRIMARY KEY (event_id, effective_at),
  CONSTRAINT order_block_lifecycle_replay_shadow_kind_check
    CHECK (transition_kind IN ('formation', 'first_touch', 'mitigation', 'invalidation')),
  CONSTRAINT order_block_lifecycle_replay_shadow_fill_check
    CHECK (fill_pct >= 0 AND fill_pct <= 1)
);

CREATE INDEX IF NOT EXISTS idx_order_block_lifecycle_replay_shadow_pit
  ON public.order_block_lifecycle_replay_shadow(event_id, effective_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_block_lifecycle_replay_shadow_effective
  ON public.order_block_lifecycle_replay_shadow(effective_at DESC, event_id);

COMMENT ON TABLE public.order_block_lifecycle_replay_shadow IS
  'PIT lifecycle states reconstructed from policy-selected canonical 1m candles. Separate from DB observation history.';
COMMENT ON COLUMN public.order_block_lifecycle_replay_shadow.effective_at IS
  'Market timestamp when this cumulative lifecycle state became effective.';
COMMENT ON COLUMN public.order_block_lifecycle_replay_shadow.replayed_at IS
  'DB audit timestamp for replay execution; never used as PIT effective time.';
