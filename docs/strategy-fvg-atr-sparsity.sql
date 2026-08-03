SELECT
  symbol,
  tf,
  COUNT(*) AS total_zones,
  COUNT(*) FILTER (WHERE zone_kind = 'fvg') AS fvg_count,
  COUNT(*) FILTER (WHERE zone_kind = 'fvg' AND gap_atr_ratio IS NOT NULL) AS measured,
  COUNT(*) FILTER (WHERE zone_kind = 'fvg' AND gap_atr_ratio IS NULL) AS unmeasured,
  MIN(ts) AS earliest,
  MAX(ts) AS latest
FROM features_zone
GROUP BY symbol, tf
ORDER BY symbol, tf;
