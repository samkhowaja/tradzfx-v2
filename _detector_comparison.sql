-- V2 vs V3 Detector Comparison Query
-- v3-robust: Magnitude-only, MAX_1M_RANGE_PIPS=1000, universal threshold
-- v2-calendar: Calendar-aware, relative jumps, session-aware (frozen, historical only)
-- v4-calibrated: Symbol-specific thresholds (frozen, not deployed)

-- Current candle_quality flags (v3-robust only, all symbols)
SELECT 
  symbol,
  COUNT(*) as suspect_count,
  COUNT(CASE WHEN reason LIKE '%1m range%' THEN 1 END) as magnitude_flags,
  STRING_AGG(DISTINCT reason, ' | ' ORDER BY reason) as reason_types,
  MIN(ts) as earliest_flag,
  MAX(ts) as latest_flag
FROM candle_quality
WHERE is_suspect = true
GROUP BY symbol
ORDER BY suspect_count DESC;
