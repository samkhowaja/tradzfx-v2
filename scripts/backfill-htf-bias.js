/**
 * Backfill features_htf_bias historically for every timestamp where a bias row
 * already exists. This is needed after introducing the HTF bias feature so that
 * backtests have PIT context available.
 *
 * Usage:
 *   node scripts/backfill-htf-bias.js [symbol|ALL] [days]
 */

const { Pool } = require("pg");
const { DAGRunner, globalDAG } = require("../apps/engine/dist");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 5,
});

async function backfillSymbol(symbol, days) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const tfs = ["15m", "1h", "4h"];
  const runner = new DAGRunner(pool, globalDAG);

  let total = 0;
  for (const tf of tfs) {
    const { rows } = await pool.query(
      `SELECT ts FROM features_bias
       WHERE symbol = $1 AND tf = $2 AND ts >= $3
       ORDER BY ts ASC`,
      [symbol, tf, since]
    );
    console.log(`[backfill-htf-bias] ${symbol}@${tf}: ${rows.length} bias timestamps`);

    for (const { ts } of rows) {
      try {
        await runner.run({
          symbol,
          tf,
          endTs: new Date(ts),
          requestedFeatures: ["features_htf_bias"],
          lookbackBars: 500,
        });
        total++;
      } catch (err) {
        console.error(`[backfill-htf-bias] Failed ${symbol}@${tf} ${ts}:`, err.message);
      }
    }
  }

  console.log(`[backfill-htf-bias] ${symbol} done: ${total} rows computed`);
}

async function main() {
  const target = process.argv[2] ?? "ALL";
  const days = parseInt(process.argv[3] ?? "30", 10);

  const symbols =
    target.toUpperCase() === "ALL"
      ? (await pool.query(`SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol`)).rows.map((r) => r.symbol)
      : [target];

  for (const symbol of symbols) {
    await backfillSymbol(symbol, days);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[backfill-htf-bias] Fatal:", err);
  process.exit(1);
});
