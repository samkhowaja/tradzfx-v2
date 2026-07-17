-- Pipeline health monitoring view.
-- Reports per-symbol pipeline status for active strategy variants.
-- Used by GET /api/v2/pipeline/health and ops/monitor-v2-health.ps1.

CREATE OR REPLACE VIEW pipeline_health AS
SELECT
  sv.symbol,
  sv.variant_id,
  COALESCE(pts.updated_at, '1970-01-01'::timestamptz) AS last_pipeline_run,
  EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) / 60 AS minutes_since_run,
  lr.ts AS last_rejection_ts,
  lr.reason AS last_rejection_reason,
  CASE
    WHEN EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) > 30 * 60 THEN 'stale'
    WHEN EXTRACT(EPOCH FROM NOW() - COALESCE(pts.updated_at, '1970-01-01'::timestamptz)) > 15 * 60 THEN 'warning'
    ELSE 'healthy'
  END AS status
FROM (
  SELECT id AS variant_id, family_id, is_active, UNNEST(symbols) AS symbol
  FROM strategy_variants
  WHERE is_active = true
) sv
JOIN strategy_families sf ON sf.id = sv.family_id AND sf.is_archived = false
LEFT JOIN pipeline_trigger_state pts ON pts.symbol = sv.symbol
LEFT JOIN LATERAL (
  SELECT ts, reason
  FROM live_signal_rejection
  WHERE symbol = sv.symbol
    AND strategy_id = sv.variant_id
  ORDER BY ts DESC
  LIMIT 1
) lr ON true;
