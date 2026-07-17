---
--- Migration 122: Add refresh_opening_range_lifecycle function
---
--- features_opening_range is session-scoped and doesn't have lifecycle columns
--- (mitigated_at, invalidated_at) like zones/OBs. But the lifecycle refresh
--- framework tracks per-table checkpoints in lifecycle_refresh_state, and the
--- stale_state_feature gate checks that ledger to confirm the producer is alive.
---
--- Without this function, the opening_range table gets no entry in
--- lifecycle_refresh_state, so the freshness gate can't tell whether the
--- producer stalled vs. just having no new sessions yet.
---

CREATE OR REPLACE FUNCTION refresh_opening_range_lifecycle(
  p_symbol          TEXT,
  p_as_of_ts        TIMESTAMPTZ,
  p_lookback_interval INTERVAL,
  p_limit           INT
) RETURNS INT AS $$
DECLARE
  v_table_name CONSTANT TEXT := 'features_opening_range';
  v_count INT := 0;
BEGIN
  -- Opening range has no lifecycle columns (no mitigated_at, invalidated_at).
  -- This is a no-op for lifecycle but exists for API consistency with
  -- refresh-lifecycle.js which expects a function per feature table.
  -- 
  -- The function updates lifecycle_refresh_state so the checkpoint advances,
  -- proving the lifecycle system is running for this table.
  INSERT INTO lifecycle_refresh_state (symbol, table_name, last_processed_ts)
  VALUES (p_symbol, v_table_name, p_as_of_ts)
  ON CONFLICT (symbol, table_name)
  DO UPDATE SET last_processed_ts = p_as_of_ts;

  RETURN 0;
END;
$$ LANGUAGE plpgsql;

-- Also need to handle the special 5-arg variant for zone (6-arg) vs 4-arg generic
-- in refresh-lifecycle.js. features_opening_range uses the 4-arg path (else branch).
-- No extra work needed.
