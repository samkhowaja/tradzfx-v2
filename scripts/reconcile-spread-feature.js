#!/usr/bin/env node
/**
 * Recompute existing features_spread rows through the canonical DAG producer.
 * Limits replay to timestamps already persisted; does not create a 1m row at
 * every candle timestamp.
 *
 * Usage:
 *   node scripts/reconcile-spread-feature.js [days=90] [symbols=ALL]
 */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist/index.js");

const days = Number(process.argv[2] || 90);
const symbolsArg = (process.argv[3] || "ALL").toUpperCase();
const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: "spread-feature-reconcile",
  max: 4,
});

async function main() {
  const symbols = symbolsArg === "ALL"
    ? (await pool.query(
        "SELECT DISTINCT symbol FROM features_spread WHERE tf = '1m' AND ts >= NOW() - $1::interval ORDER BY symbol",
        [`${days} days`]
      )).rows.map((row) => row.symbol)
    : symbolsArg.split(",").map((symbol) => symbol.trim()).filter(Boolean);

  let total = 0;
  for (const symbol of symbols) {
    const { rows } = await pool.query(
      `SELECT ts FROM features_spread
        WHERE symbol = $1 AND tf = '1m' AND ts >= NOW() - $2::interval
        ORDER BY ts`,
      [symbol, `${days} days`]
    );
    const runner = new DAGRunner(pool, globalDAG);
    let completed = 0;
    let errors = 0;
    const started = Date.now();
    for (const row of rows) {
      try {
        await runner.run({
          symbol,
          tf: "1m",
          endTs: new Date(row.ts),
          requestedFeatures: ["features_spread"],
          lookbackBars: 50,
          skipCache: true,
          batchInserts: true,
          batchSize: 500,
          skipLifecycle: true,
        });
        completed++;
      } catch (error) {
        errors++;
        console.warn(`[spread-reconcile] ${symbol} ${new Date(row.ts).toISOString()}: ${error.message}`);
      }
    }
    await runner.flush();
    total += completed;
    console.log(`[spread-reconcile] ${symbol}: ${completed}/${rows.length}, errors=${errors}, seconds=${((Date.now() - started) / 1000).toFixed(1)}`);
  }
  console.log(`[spread-reconcile] done: ${total} existing rows recomputed`);
}

main().catch((error) => {
  console.error("[spread-reconcile] fatal:", error);
  process.exitCode = 1;
}).finally(() => pool.end());
