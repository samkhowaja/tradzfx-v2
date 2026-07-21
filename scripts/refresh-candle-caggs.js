#!/usr/bin/env node
/**
 * Refresh raw broker TimescaleDB continuous aggregates, then rebuild governed
 * canonical HTF projections over the same source range.
 *
 * Why this exists:
 *   The HTF candle views are continuous aggregates. Their materialized portion
 *   only covers the range up to the cagg watermark; the realtime portion only
 *   covers ts >= watermark. When the watermark is recent, historical buckets
 *   fall into neither half and the views (and every feature derived from them:
 *   bias/pricing/structure at 5m/15m/1h) become sparse for backtest windows.
 *   Refreshing the caggs over the full candles_1m range materializes the
 *   missing history so HTF features can be backfilled densely.
 *
 * Usage:
 *   node scripts/refresh-candle-caggs.js [from] [to]
 *   node scripts/refresh-candle-caggs.js            # full candles_1m range
 *   node scripts/refresh-candle-caggs.js 2026-01-01 2026-07-09
 */
require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

const CAGGS = [
  "candles_5m",
  "candles_15m",
  "candles_1h",
  "candles_4h",
  "candles_1d_utc",
  "candles_1d_ny",
];

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: Number(process.env.TM_DB_PORT || 5432),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  const fromArg = process.argv[2];
  const toArg = process.argv[3];

  let from = fromArg;
  let to = toArg;
  if (!from || !to) {
    const { rows } = await pool.query(
      "SELECT min(ts) AS min, max(ts) AS max FROM candles_1m"
    );
    from = from ?? rows[0].min.toISOString();
    // `to` is exclusive in refresh_continuous_aggregate; push one day past max.
    to = to ?? new Date(rows[0].max.getTime() + 86_400_000).toISOString();
  }

  console.log(`[refresh-candle-caggs] range: ${from} -> ${to}`);

  let failed = false;
  for (const cagg of CAGGS) {
    const t0 = Date.now();
    try {
      await pool.query("CALL refresh_continuous_aggregate($1, $2::timestamptz, $3::timestamptz)", [
        cagg,
        from,
        to,
      ]);
      console.log(`[refresh-candle-caggs] ${cagg}: OK (${Date.now() - t0}ms)`);
    } catch (err) {
      failed = true;
      console.error(`[refresh-candle-caggs] ${cagg}: FAILED - ${err.message}`);
    }
  }

  if (!failed) {
    const t0 = Date.now();
    const { rows } = await pool.query(
      "SELECT * FROM market.refresh_canonical_htf(NULL, $1::timestamptz, $2::timestamptz)",
      [from, to]
    );
    console.log(`[refresh-candle-caggs] canonical HTF: OK (${Date.now() - t0}ms)`);
    console.table(rows);
  } else {
    process.exitCode = 1;
    console.error("[refresh-candle-caggs] canonical HTF skipped because raw cagg refresh failed");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[refresh-candle-caggs] fatal:", err.message);
  process.exit(1);
});
