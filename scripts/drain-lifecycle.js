/**
 * Drain lifecycle columns for all symbols after a historical feature backfill.
 *
 * The per-table lifecycle refresh functions are checkpointed, so calling them
 * repeatedly with a small lookback window drains the full history in fast
 * increments instead of one massive scan.
 *
 * Usage:
 *   node scripts/drain-lifecycle.js [symbol1,symbol2,...]
 */

const { Pool } = require("pg");
const { updateLifecycleForSymbol } = require("../apps/engine/dist/index.js");

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

async function getSymbols(arg) {
  if (arg && arg !== "all") return arg.split(",").map((s) => s.trim().toUpperCase());
  const { rows } = await pool.query("SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol");
  return rows.map((r) => r.symbol);
}

async function getRange(symbol) {
  const { rows } = await pool.query(
    `SELECT MIN(ts) AS min_ts, MAX(ts) AS max_ts FROM candles_1m WHERE symbol = $1`,
    [symbol]
  );
  return {
    minTs: rows[0].min_ts ? new Date(rows[0].min_ts) : null,
    maxTs: rows[0].max_ts ? new Date(rows[0].max_ts) : null,
  };
}

async function drainSymbol(symbol, asOfTs) {
  let total = 0;
  let iterations = 0;
  let lastTotal = -1;

  while (true) {
    try {
      const results = await updateLifecycleForSymbol(pool, symbol, {
        asOf: asOfTs,
        lookbackDays: 2,
        limit: 5_000,
      });
      const rowsUpdated = results.reduce((s, r) => s + (r.rowsUpdated || 0), 0);
      total += rowsUpdated;
      iterations++;
      console.log(`[drain] ${symbol}: iteration ${iterations} | +${rowsUpdated} | total ${total}`);
      if (rowsUpdated === 0) break;
      if (rowsUpdated === lastTotal) {
        // Guard against a stuck checkpoint.
        console.warn(`[drain] ${symbol}: no progress, stopping`);
        break;
      }
      lastTotal = rowsUpdated;
    } catch (err) {
      console.error(`[drain] ${symbol}: error:`, err.message);
      break;
    }
  }

  console.log(`[drain] ${symbol}: done | ${total} rows updated in ${iterations} iterations`);
  return total;
}

async function main() {
  const arg = process.argv[2];
  const symbols = await getSymbols(arg);
  console.log(`[drain] Symbols: ${symbols.join(", ")}`);

  let grandTotal = 0;
  for (const symbol of symbols) {
    const { maxTs } = await getRange(symbol);
    if (!maxTs) {
      console.warn(`[drain] ${symbol}: no candle data, skipping`);
      continue;
    }
    console.log(`\n[drain] === ${symbol} | asOf ${maxTs.toISOString()} ===`);
    grandTotal += await drainSymbol(symbol, maxTs);
  }

  console.log(`\n[drain] === ALL DONE === | ${grandTotal} rows updated`);
  await pool.end();
}

main().catch((err) => {
  console.error("[drain] Fatal:", err);
  process.exit(1);
});
