CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_features_order_block_logical_id_observation ON public.features_order_block (logical_id) WHERE logical_id IS NOT NULL;
