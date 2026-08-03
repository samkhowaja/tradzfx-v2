-- Candle-only FVG session outcome analysis.
-- zone_outcomes stores generic outcomes; session derives from formation_ts UTC.
WITH fvg AS (
  SELECT symbol, tf,
    CASE
      WHEN EXTRACT(HOUR FROM formation_ts AT TIME ZONE 'UTC') >= 19
        OR EXTRACT(HOUR FROM formation_ts AT TIME ZONE 'UTC') < 2 THEN 'asia'
      WHEN EXTRACT(HOUR FROM formation_ts AT TIME ZONE 'UTC') < 8 THEN 'london'
      WHEN EXTRACT(HOUR FROM formation_ts AT TIME ZONE 'UTC') < 12 THEN 'ny_overlap'
      ELSE 'ny_afternoon'
    END AS session, outcome, max_favorable, max_adverse
  FROM zone_outcomes
  WHERE zone_kind = 'fvg'
)
SELECT symbol, tf, session, COUNT(*) AS outcomes,
  AVG(CASE WHEN outcome IN ('reversal', 'mitigated') THEN 1.0 ELSE 0.0 END) AS favorable_rate,
  AVG(max_favorable) AS avg_max_favorable,
  AVG(max_adverse) AS avg_max_adverse
FROM fvg
GROUP BY symbol, tf, session
ORDER BY symbol, tf, session;
