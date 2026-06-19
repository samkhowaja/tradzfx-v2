/**
 * Backfill lifecycle columns for zones, order blocks, FVGs, sweeps, and structure.
 *
 * Usage:
 *   node scripts/refresh-lifecycle.js XAUUSD [days] [limit]
 *   node scripts/refresh-lifecycle.js ALL [days] [limit]
 *
 * `days` controls how far back from the latest candle to scan for open rows
 * (default 30). `limit` controls how many rows per table are processed per call
 * (default 10000).
 *
 * The script uses the latest candle timestamp for the symbol as the as-of time,
 * and resets the per-symbol lifecycle refresh state so the full lookback window
 * is re-scanned. This makes the backfill idempotent and correct even when
 * candles are stored with future/simulated timestamps.
 */

const { Pool } = require("pg");

const STATEMENT_TIMEOUT = process.env.TM_DB_STATEMENT_TIMEOUT
  ? Number(process.env.TM_DB_STATEMENT_TIMEOUT)
  : 600_000; // 10 minutes

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "tradementor_v2",
  user: "postgres",
  password: "2k16Dub@i",
  max: 5,
  options: `--statement_timeout=${STATEMENT_TIMEOUT}`,
});

async function refreshSymbol(symbol, lookbackDays, limit) {
  const { rows: tsRows } = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM candles_1m WHERE symbol = $1`,
    [symbol]
  );
  const maxTs = tsRows[0]?.max_ts;
  if (!maxTs) {
    console.log(`[refresh-lifecycle] ${symbol}: no candles, skipping`);
    return 0;
  }

  // Reset incremental state so the full lookback window is scanned.
  await pool.query(
    `INSERT INTO lifecycle_refresh_state (symbol, last_processed_ts)
     VALUES ($1, $2)
     ON CONFLICT (symbol) DO UPDATE SET last_processed_ts = EXCLUDED.last_processed_ts`,
    [symbol, new Date(Date.parse(maxTs) - lookbackDays * 24 * 60 * 60 * 1000).toISOString()]
  );

  console.log(
    `[refresh-lifecycle] Refreshing ${symbol} as-of ${maxTs} (last ${lookbackDays} days, limit ${limit})...`
  );
  const start = performance.now();
  const { rows } = await pool.query(
    `SELECT * FROM refresh_lifecycle_for_symbol($1, $2::timestamptz, make_interval(days => $3), $4)`,
    [symbol, maxTs, lookbackDays, limit]
  );
  const elapsed = performance.now() - start;
  const total = rows.reduce((s, r) => s + Number(r.rows_updated), 0);
  console.log(`[refresh-lifecycle] ${symbol} done in ${elapsed.toFixed(0)}ms`);
  for (const r of rows) {
    console.log(`  ${r.table_name}: ${r.rows_updated} rows updated`);
  }
  return total;
}

async function main() {
  const target = process.argv[2];
  const lookbackDays = parseInt(process.argv[3] ?? "30", 10);
  const limit = parseInt(process.argv[4] ?? "10000", 10);
  if (!target || Number.isNaN(lookbackDays) || Number.isNaN(limit)) {
    console.error("Usage: node scripts/refresh-lifecycle.js <SYMBOL|ALL> [days] [limit]");
    process.exit(1);
  }

  if (target.toUpperCase() === "ALL") {
    const { rows } = await pool.query(
      `SELECT DISTINCT symbol FROM candles_1m ORDER BY symbol`
    );
    let grandTotal = 0;
    for (const { symbol } of rows) {
      grandTotal += await refreshSymbol(symbol, lookbackDays, limit);
    }
    console.log(`[refresh-lifecycle] ALL done. Grand total: ${grandTotal} rows updated`);
  } else {
    const total = await refreshSymbol(target, lookbackDays, limit);
    console.log(`[refresh-lifecycle] ${target} total: ${total} rows updated`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[refresh-lifecycle] Fatal error:", err);
  process.exit(1);
});
