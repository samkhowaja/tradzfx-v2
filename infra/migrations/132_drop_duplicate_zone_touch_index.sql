-- zone_touch_events_pkey already provides the identical (zone_id, touch_ts)
-- B-tree access path. Drop only the redundant non-constraint index.
-- Keep this as the sole statement: PostgreSQL requires DROP INDEX CONCURRENTLY
-- outside a transaction block.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_zone_touch_events_zone;
