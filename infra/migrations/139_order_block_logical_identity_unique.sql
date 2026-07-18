CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS features_order_block_logical_id_key ON public.features_order_block (logical_id) WHERE logical_id IS NOT NULL;
