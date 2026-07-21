#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
});
async function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const days = Number(process.argv[3] || 90);
  const { rows } = await pool.query(
    `WITH edge AS (
       SELECT max(ts) AS ts FROM market.candles_1m_canonical WHERE symbol=$1
     )
     SELECT count(*)::int AS candle_count,
            count(spread)::int AS spread_count,
            count(*) FILTER (WHERE spread > 0)::int AS positive_spread_count,
            percentile_cont(ARRAY[0.1,0.5,0.9,0.99]) WITHIN GROUP (ORDER BY spread) FILTER (WHERE spread > 0) AS spread_pips,
            min(c.ts) AS min_ts, max(c.ts) AS max_ts,
            array_agg(DISTINCT broker) AS brokers
       FROM market.candles_1m_canonical c, edge
      WHERE c.symbol=$1 AND c.ts >= edge.ts - ($2 * interval '1 day')`,
    [symbol, days]
  );
  console.log(JSON.stringify({ symbol, days, ...rows[0] }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
