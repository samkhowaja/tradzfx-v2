require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
(async () => {
  const p = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });
  const q = `
  WITH st_htf_direction AS (
    SELECT DISTINCT ON (symbol) symbol, ts, direction
    FROM features_bias WHERE tf='1h' AND symbol='EURUSD'
      AND ts >= '2026-04-21T21:51:00.000Z'::timestamptz AND ts <= '2026-07-20T21:51:00.000Z'::timestamptz
    ORDER BY symbol, ts DESC
  ),
  st_value_location AS (
    SELECT DISTINCT ON (st_htf_direction.symbol, st_htf_direction.ts)
      st_htf_direction.symbol, st_htf_direction.ts, st_htf_direction.direction,
      pit_value_location.ts AS value_location_ts
    FROM st_htf_direction,
    LATERAL (
      SELECT DISTINCT ON (symbol) * FROM features_pricing
      WHERE symbol = st_htf_direction.symbol AND tf='15m'
        AND features_pricing.ts <= st_htf_direction.ts
        AND features_pricing.ts >= st_htf_direction.ts - INTERVAL '83 hours'
      ORDER BY symbol, ts DESC
    ) AS pit_value_location
    WHERE ((st_htf_direction.direction = 'bullish' AND pit_value_location.position IN ('discount','deep_discount','equilibrium'))
        OR (st_htf_direction.direction = 'bearish' AND pit_value_location.position IN ('premium','deep_premium','equilibrium')))
      AND pit_value_location.ts >= st_htf_direction.ts - INTERVAL '120 minutes'
    ORDER BY st_htf_direction.symbol, st_htf_direction.ts
  ),
  st_liquidity_sweep AS (
    SELECT DISTINCT ON (st_value_location.symbol, st_value_location.ts)
      st_value_location.symbol, st_value_location.ts, st_value_location.direction,
      pit_liquidity_sweep.ts AS liquidity_sweep_ts
    FROM st_value_location,
    LATERAL (
      SELECT DISTINCT ON (symbol, sweep_type, direction) * FROM features_sweep
      WHERE symbol = st_value_location.symbol AND tf='5m'
        AND features_sweep.ts <= st_value_location.ts
        AND features_sweep.ts >= st_value_location.ts - INTERVAL '61 hours'
        AND (features_sweep.mitigated_at IS NULL OR features_sweep.mitigated_at > st_value_location.ts)
      ORDER BY symbol, sweep_type, direction, ts DESC
    ) AS pit_liquidity_sweep
    WHERE (pit_liquidity_sweep.direction = st_value_location.direction AND (pit_liquidity_sweep.mitigated_at IS NULL OR pit_liquidity_sweep.mitigated_at > st_value_location.ts))
      AND pit_liquidity_sweep.direction = st_value_location.direction
      AND pit_liquidity_sweep.ts >= st_value_location.ts - INTERVAL '120 minutes'
    ORDER BY st_value_location.symbol, st_value_location.ts
  )
  SELECT COUNT(*) AS n FROM st_liquidity_sweep;
  `;
  const r = await p.query(q);
  console.log("liquidity_sweep rows:", r.rows[0].n);
  await p.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
