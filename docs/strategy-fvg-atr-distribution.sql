-- Candle-only FVG gap distribution by pair and timeframe.
SELECT
  symbol,
  tf,
  COUNT(*) AS fvg_count,
  percentile_cont(0.25) WITHIN GROUP (ORDER BY gap_atr_ratio) AS p25,
  percentile_cont(0.50) WITHIN GROUP (ORDER BY gap_atr_ratio) AS p50,
  percentile_cont(0.75) WITHIN GROUP (ORDER BY gap_atr_ratio) AS p75,
  percentile_cont(0.90) WITHIN GROUP (ORDER BY gap_atr_ratio) AS p90
FROM features_zone
WHERE zone_kind = 'fvg'
  AND gap_atr_ratio IS NOT NULL
GROUP BY symbol, tf
ORDER BY symbol, tf;
