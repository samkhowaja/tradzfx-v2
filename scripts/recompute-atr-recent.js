/**
 * Scoped ATR recompute for the recent (live-edge) window — P0-C (skeleton SK-15).
 *
 * Overwrites stale engine_ver rows (e.g. v1.1.0) with the current v1.2.0 ATR
 * (effective_value + quality fields) for the last N hours, without recomputing
 * full history. skipCache is required because features_atr.input_hash covers
 * o/h/l/c only (:q1) — the cache would otherwise return pre-quality rows.
 *
 * Usage:
 *   node scripts/recompute-atr-recent.js [symbol=XAUUSD] [hours=36] [tfs=5m,15m,1h,4h]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");
const { getCandleTableForTf } = require("../packages/shared/dist/index.js");

const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
const hours = Number(process.argv[3] || 36);
const tfs = (process.argv[4] || "5m,15m,1h,4h").split(",").map((s) => s.trim());
const FEATURE = "features_atr";

const pool = new Pool({
  host: "localhost", port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres", password: process.env.TM_DB_PASSWORD, max: 4,
});

async function range(tf) {
  const table = getCandleTableForTf(tf);
  const { rows } = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM ${table} WHERE symbol = $1`, [symbol]
  );
  const maxTs = rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
  return { table, maxTs };
}

async function bars(table, sinceTs, untilTs) {
  const { rows } = await pool.query(
    `SELECT ts FROM ${table} WHERE symbol = $1 AND ts >= $2 AND ts <= $3 ORDER BY ts`,
    [symbol, sinceTs, untilTs]
  );
  return rows.map((r) => new Date(r.ts));
}

(async () => {
  console.log(`[recompute-atr-recent] ${symbol} trailing ${hours}h (per-tf data clock) tfs=${tfs.join(",")}`);
  let grand = 0;
  for (const tf of tfs) {
    const { table, maxTs } = await range(tf);
    if (!maxTs) { console.log(`  ${tf}: no candles`); continue; }
    const since = new Date(maxTs.getTime() - hours * 3600_000);
    const timestamps = await bars(table, since, maxTs);
    if (timestamps.length === 0) { console.log(`  ${tf}: no bars in window`); continue; }
    const runner = new DAGRunner(pool, globalDAG);
    let processed = 0, errors = 0;
    const t0 = performance.now();
    for (const ts of timestamps) {
      try {
        await runner.run({
          symbol, tf, endTs: ts, requestedFeatures: [FEATURE],
          lookbackBars: 40, skipCache: true, batchInserts: true, batchSize: 1000, skipLifecycle: true,
        });
        processed++;
      } catch (err) { errors++; console.warn(`  ${tf} err ${ts.toISOString()}: ${err.message}`); }
    }
    await runner.flush();
    grand += processed;
    console.log(`  ${tf}: ${processed} computed, ${errors} errors in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  }
  console.log(`[recompute-atr-recent] done: ${grand} bars recomputed`);
  await pool.end();
})().catch((e) => { console.error("[recompute-atr-recent] fatal:", e.message); process.exit(1); });
