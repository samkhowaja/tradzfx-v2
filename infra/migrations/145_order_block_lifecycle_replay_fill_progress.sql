-- Allow replay rows for each market timestamp where cumulative fill depth grows.
-- Migration 144 remains immutable after application.

ALTER TABLE public.order_block_lifecycle_replay_shadow
  DROP CONSTRAINT IF EXISTS order_block_lifecycle_replay_shadow_kind_check;

ALTER TABLE public.order_block_lifecycle_replay_shadow
  ADD CONSTRAINT order_block_lifecycle_replay_shadow_kind_check
  CHECK (transition_kind IN ('formation', 'first_touch', 'fill_progress', 'mitigation', 'invalidation'));
