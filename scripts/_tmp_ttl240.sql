
WITH
st_htf_direction AS (
  SELECT
    symbol, ts, direction
  FROM features_bias
  WHERE tf = '1h'
    AND ts >= '2026-04-21T21:51:00.000Z'::timestamptz AND ts <= '2026-07-20T21:51:00.000Z'::timestamptz
    AND symbol = 'EURUSD'
  ORDER BY symbol, ts DESC
),
st_value_location AS (
  SELECT DISTINCT ON (st_htf_direction.symbol, st_htf_direction.ts)
    st_htf_direction.symbol,
    st_htf_direction.ts,
    st_htf_direction.direction,
    pit_value_location.ts AS value_location_ts
  FROM st_htf_direction,
  LATERAL (
    SELECT DISTINCT ON (symbol) *
    FROM features_pricing
    WHERE symbol = st_htf_direction.symbol
      AND tf = '15m'
      AND features_pricing.ts <= st_htf_direction.ts
      AND features_pricing.ts >= st_htf_direction.ts - INTERVAL '83 hours'
      
    ORDER BY symbol, ts DESC
  ) AS pit_value_location
  WHERE ((st_htf_direction.direction = 'bullish' AND pit_value_location.position IN ('discount', 'deep_discount', 'equilibrium')) OR (st_htf_direction.direction = 'bearish' AND pit_value_location.position IN ('premium', 'deep_premium', 'equilibrium')) )
    AND pit_value_location.ts >= st_htf_direction.ts - INTERVAL '120 minutes'
  ORDER BY st_htf_direction.symbol, st_htf_direction.ts
),
st_liquidity_sweep AS (
  SELECT DISTINCT ON (st_value_location.symbol, st_value_location.ts)
    st_value_location.symbol,
    st_value_location.ts,
    st_value_location.direction,
    pit_liquidity_sweep.ts AS liquidity_sweep_ts
  FROM st_value_location,
  LATERAL (
    SELECT DISTINCT ON (symbol, sweep_type, direction) *
    FROM features_sweep
    WHERE symbol = st_value_location.symbol
      AND tf = '5m'
      AND features_sweep.ts <= st_value_location.ts
      AND features_sweep.ts >= st_value_location.ts - INTERVAL '61 hours'
      AND (features_sweep.mitigated_at IS NULL OR features_sweep.mitigated_at > st_value_location.ts)
    ORDER BY symbol, sweep_type, direction, ts DESC
  ) AS pit_liquidity_sweep
  WHERE (pit_liquidity_sweep.direction = st_value_location.direction AND (pit_liquidity_sweep.mitigated_at IS NULL OR pit_liquidity_sweep.mitigated_at > st_value_location.ts))
    AND pit_liquidity_sweep.direction = st_value_location.direction
    AND pit_liquidity_sweep.ts >= st_value_location.ts - INTERVAL '120 minutes'
  ORDER BY st_value_location.symbol, st_value_location.ts
),
st_displacement AS (
  SELECT DISTINCT ON (st_liquidity_sweep.symbol, st_liquidity_sweep.ts)
    st_liquidity_sweep.symbol,
    st_liquidity_sweep.ts,
    st_liquidity_sweep.direction,
    pit_displacement.ts AS displacement_ts
  FROM st_liquidity_sweep,
  LATERAL (
    SELECT DISTINCT ON (symbol, direction) *
    FROM features_displacement
    WHERE symbol = st_liquidity_sweep.symbol
      AND tf = '5m'
      AND features_displacement.ts <= st_liquidity_sweep.ts
      AND features_displacement.ts >= st_liquidity_sweep.ts - INTERVAL '61 hours'
      
    ORDER BY symbol, direction, CASE grade WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 ELSE 0 END DESC NULLS LAST, ts DESC
  ) AS pit_displacement
  WHERE (pit_displacement.direction = st_liquidity_sweep.direction AND pit_displacement.grade IN ('MEDIUM', 'HIGH') )
    AND pit_displacement.direction = st_liquidity_sweep.direction
    AND pit_displacement.ts >= st_liquidity_sweep.ts - INTERVAL '240 minutes'
  ORDER BY st_liquidity_sweep.symbol, st_liquidity_sweep.ts
),
entry_signals AS (
  
  SELECT DISTINCT ON (st_displacement.symbol, st_displacement.ts) st_displacement.symbol, st_displacement.ts, st_displacement.direction as bias_direction
  FROM st_displacement
  ,LATERAL (
        SELECT DISTINCT ON (symbol, zone_kind, direction) *
        FROM features_zone
        WHERE symbol = st_displacement.symbol
          AND tf = '1m'
        AND features_zone.ts <= st_displacement.ts
        AND features_zone.ts >= st_displacement.ts - INTERVAL '63 hours'
        AND zone_kind = 'fvg'
          AND (features_zone.invalidated_at IS NULL OR features_zone.invalidated_at > st_displacement.ts)
        ORDER BY symbol, zone_kind, direction, rank_score DESC NULLS LAST, strength_score DESC NULLS LAST, quality_score DESC NULLS LAST, ts DESC
      ) AS pit_fvg_retrace
  WHERE (pit_fvg_retrace.zone_kind = 'fvg' AND pit_fvg_retrace.direction = st_displacement.direction AND pit_fvg_retrace.fill_pct < 0.8 AND (pit_fvg_retrace.invalidated_at IS NULL OR pit_fvg_retrace.invalidated_at > st_displacement.ts))
)

SELECT DISTINCT ON (symbol, date_trunc('day', ts AT TIME ZONE 'UTC'))
  *
FROM (
  SELECT DISTINCT ON (e.symbol, f.ts)
    e.symbol,
    f.ts,
    f.direction as bias_direction,
    f.top as fvg_top,
    f.bottom as fvg_bottom,
    ((f.top + f.bottom) / 2.0) as fvg_midpoint,
    o.high as orb_high,
    o.low as orb_low,
    p.position as pricing_position,
  COALESCE(a_5m.effective_value, a_5m.value) as atr_5m,
  COALESCE(a_5m.effective_value, a_5m.value) as atr_5,
    CASE
      WHEN f.direction = 'bullish' THEN 'buy'
      WHEN f.direction = 'bearish' THEN 'sell'
      ELSE NULL
    END as side,
    ((f.top + f.bottom) / 2.0) as entry_price,
    CASE
    WHEN e.bias_direction = 'bullish' THEN LEAST(COALESCE((CASE
    WHEN e.bias_direction = 'bullish' THEN (((f.top + f.bottom) / 2.0)) - (COALESCE(a_5m.effective_value, a_5m.value) * 1.2)
    WHEN e.bias_direction = 'bearish' THEN (((f.top + f.bottom) / 2.0)) + (COALESCE(a_5m.effective_value, a_5m.value) * 1.2)
  END), (((f.top + f.bottom) / 2.0)) - ((1.5000 * (COALESCE(p.pip_size, (CASE
    WHEN e.symbol LIKE '%XAU%' OR e.symbol LIKE '%GOLD%' THEN 0.1
    WHEN e.symbol LIKE '%JPY%' THEN 0.01
    WHEN e.symbol LIKE '%NAS100%' OR e.symbol LIKE '%NDX%' OR e.symbol LIKE '%US30%' OR e.symbol LIKE '%DJI%' OR e.symbol LIKE '%DE40%' OR e.symbol LIKE '%DAX%' OR e.symbol LIKE '%UK100%' OR e.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END)))))), (((f.top + f.bottom) / 2.0)) - ((1.5000 * (COALESCE(p.pip_size, (CASE
    WHEN e.symbol LIKE '%XAU%' OR e.symbol LIKE '%GOLD%' THEN 0.1
    WHEN e.symbol LIKE '%JPY%' THEN 0.01
    WHEN e.symbol LIKE '%NAS100%' OR e.symbol LIKE '%NDX%' OR e.symbol LIKE '%US30%' OR e.symbol LIKE '%DJI%' OR e.symbol LIKE '%DE40%' OR e.symbol LIKE '%DAX%' OR e.symbol LIKE '%UK100%' OR e.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END))))))
    WHEN e.bias_direction = 'bearish' THEN GREATEST(COALESCE((CASE
    WHEN e.bias_direction = 'bullish' THEN (((f.top + f.bottom) / 2.0)) - (COALESCE(a_5m.effective_value, a_5m.value) * 1.2)
    WHEN e.bias_direction = 'bearish' THEN (((f.top + f.bottom) / 2.0)) + (COALESCE(a_5m.effective_value, a_5m.value) * 1.2)
  END), (((f.top + f.bottom) / 2.0)) + ((1.5000 * (COALESCE(p.pip_size, (CASE
    WHEN e.symbol LIKE '%XAU%' OR e.symbol LIKE '%GOLD%' THEN 0.1
    WHEN e.symbol LIKE '%JPY%' THEN 0.01
    WHEN e.symbol LIKE '%NAS100%' OR e.symbol LIKE '%NDX%' OR e.symbol LIKE '%US30%' OR e.symbol LIKE '%DJI%' OR e.symbol LIKE '%DE40%' OR e.symbol LIKE '%DAX%' OR e.symbol LIKE '%UK100%' OR e.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END)))))), (((f.top + f.bottom) / 2.0)) + ((1.5000 * (COALESCE(p.pip_size, (CASE
    WHEN e.symbol LIKE '%XAU%' OR e.symbol LIKE '%GOLD%' THEN 0.1
    WHEN e.symbol LIKE '%JPY%' THEN 0.01
    WHEN e.symbol LIKE '%NAS100%' OR e.symbol LIKE '%NDX%' OR e.symbol LIKE '%US30%' OR e.symbol LIKE '%DJI%' OR e.symbol LIKE '%DE40%' OR e.symbol LIKE '%DAX%' OR e.symbol LIKE '%UK100%' OR e.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END))))))
  END as stop_loss,
    CASE
      WHEN e.bias_direction = 'bullish' THEN (((f.top + f.bottom) / 2.0)) + ((COALESCE(a_5m.effective_value, a_5m.value) * 1.2)) * 2.50
      WHEN e.bias_direction = 'bearish' THEN (((f.top + f.bottom) / 2.0)) - ((COALESCE(a_5m.effective_value, a_5m.value) * 1.2)) * 2.50
    END as take_profit,
    'limit' as entry_type
  FROM entry_signals e
  JOIN LATERAL (
    SELECT *
    FROM features_zone f
    WHERE f.symbol = e.symbol
      AND f.tf = '1m'
      AND f.zone_kind = 'fvg'
      AND f.ts <= e.ts
      AND f.ts >= e.ts - INTERVAL '63 hours'
      AND (f.invalidated_at IS NULL OR f.invalidated_at > e.ts)
      AND f.direction = CASE WHEN e.bias_direction = 'bullish' THEN 'bullish' ELSE 'bearish' END
    ORDER BY
      (f.top - f.bottom) DESC,
      f.ts DESC
    LIMIT 1
  ) f ON TRUE
  JOIN LATERAL (
    SELECT ctf.*
    FROM market.candles_5m_canonical ctf
    WHERE ctf.symbol = f.symbol AND ctf.ts = f.ts - interval '10 minutes'
    LIMIT 1
  ) fvg_c1 ON TRUE
  JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '15m'
    AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '15m' AND ts <= e.ts)
  JOIN LATERAL (
    SELECT c15.h as high, c15.l as low
    FROM market.candles_15m_canonical c15
    WHERE c15.symbol = e.symbol
      AND c15.ts = date_trunc('day', f.ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '13 hours 30 minutes'
    LIMIT 1
  ) o ON true
JOIN features_atr a_5m ON e.symbol = a_5m.symbol AND a_5m.tf = '5m' AND a_5m.period = 5
  AND a_5m.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '5m' AND period = 5 AND ts <= e.ts)
  WHERE f.direction IN ('bullish', 'bearish')
    AND (
      (f.direction = 'bullish' AND f.bottom > o.high)
      OR
      (f.direction = 'bearish' AND f.top < o.low)
    )
    AND f.ts::time >= time '13:45'
    AND f.ts::time <= time '16:00'
  ORDER BY e.symbol, f.ts, e.ts
) fvg_candidates
ORDER BY symbol, date_trunc('day', ts AT TIME ZONE 'UTC'), ts ASC

