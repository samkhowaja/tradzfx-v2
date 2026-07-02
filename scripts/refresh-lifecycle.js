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

const ALL_TABLES = [
  { name: "features_zone", fn: "refresh_zone_lifecycle" },
  { name: "features_order_block", fn: "refresh_order_block_lifecycle" },
  { name: "features_ifvg", fn: "refresh_ifvg_lifecycle" },
  { name: "features_sweep", fn: "refresh_sweep_lifecycle" },
  { name: "features_structure", fn: "refresh_structure_lifecycle" },
];

const skipTables = new Set(
  (process.env.TM_LIFECYCLE_SKIP_TABLES ?? "features_ifvg")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const enabledTables = ALL_TABLES.filter((t) => !skipTables.has(t.name));

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
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

  // Reset per-table incremental state so the full lookback window is re-scanned.
  await pool.query(
    `DELETE FROM lifecycle_refresh_state WHERE symbol = $1`,
    [symbol]
  );

  console.log(
    `[refresh-lifecycle] Refreshing ${symbol} as-of ${maxTs} (last ${lookbackDays} days, limit ${limit})...`
  );
  const start = performance.now();
  let grandTotal = 0;
  let iteration = 0;
  while (true) {
    iteration++;
    let total = 0;
    const parts = [];
    for (const t of enabledTables) {
      const { rows } = await pool.query(
        `SELECT ${t.fn}($1, $2::timestamptz, make_interval(days => $3), $4) AS rows_updated`,
        [symbol, maxTs, lookbackDays, limit]
      );
      const n = Number(rows[0]?.rows_updated ?? 0);
      parts.push(`${t.name}=${n}`);
      total += n;
    }
    grandTotal += total;
    console.log(`  iteration ${iteration}: ${parts.join(", ")}`);
    if (total === 0) break;
  }
  const elapsed = performance.now() - start;
  console.log(`[refresh-lifecycle] ${symbol} done in ${elapsed.toFixed(0)}ms, total ${grandTotal} rows updated`);
  return grandTotal;
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
