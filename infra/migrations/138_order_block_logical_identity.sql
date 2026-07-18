-- Add immutable detector lineage for the order-block identity pilot.
-- Existing rows remain NULL because their exact triggering structure event cannot
-- be reconstructed safely from current persisted data.
ALTER TABLE public.features_order_block
  ADD COLUMN IF NOT EXISTS source_event_ts TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source_event_type TEXT,
  ADD COLUMN IF NOT EXISTS source_event_direction TEXT,
  ADD COLUMN IF NOT EXISTS source_event_level DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS logical_id BYTEA;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.features_order_block'::regclass
      AND conname = 'features_order_block_lineage_all_or_none_check'
  ) THEN
    ALTER TABLE public.features_order_block
      ADD CONSTRAINT features_order_block_lineage_all_or_none_check
      CHECK (
        (source_event_ts IS NULL
          AND source_event_type IS NULL
          AND source_event_direction IS NULL
          AND source_event_level IS NULL
          AND logical_id IS NULL)
        OR
        (source_event_ts IS NOT NULL
          AND source_event_type IS NOT NULL
          AND source_event_direction IS NOT NULL
          AND source_event_level IS NOT NULL
          AND logical_id IS NOT NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.features_order_block'::regclass
      AND conname = 'features_order_block_logical_id_32_check'
  ) THEN
    ALTER TABLE public.features_order_block
      ADD CONSTRAINT features_order_block_logical_id_32_check
      CHECK (logical_id IS NULL OR octet_length(logical_id) = 32) NOT VALID;
  END IF;
END $$;
