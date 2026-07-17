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

require("dotenv").config({ path: ".env.local" });
const { Pool } = require("pg");

// Maintenance jobs (lifecycle rebuild) can legitimately run for minutes per
// call. The app-level TM_DB_STATEMENT_TIMEOUT (60s in .env.local) protects the
// web API from runaway queries and MUST NOT cap maintenance work, so this
// script uses its own knob and defaults to 0 (no per-call timeout); the batched
// loop (p_limit) keeps each call bounded. Override with TM_REFRESH_STATEMENT_TIMEOUT.
const STATEMENT_TIMEOUT = process.env.TM_REFRESH_STATEMENT_TIMEOUT !== undefined
  ? Number(process.env.TM_REFRESH_STATEMENT_TIMEOUT)
  : 0;

const ALL_TABLES = [
  { name: "features_zone", fn: "refresh_zone_lifecycle" },
  { name: "features_order_block", fn: "refresh_order_block_lifecycle" },
  { name: "features_ifvg", fn: "refresh_ifvg_lifecycle" },
  { name: "features_sweep", fn: "refresh_sweep_lifecycle" },
  { name: "features_structure", fn: "refresh_structure_lifecycle" },
  // P1: Add missing feature producers to scheduled refresh
  { name: "features_atr", fn: "refresh_atr_lifecycle" },
  { name: "features_spread", fn: "refresh_spread_lifecycle" },
  { name: "features_zone_retest", fn: "refresh_zone_retest_lifecycle" },
  { name: "features_candle_pattern", fn: "refresh_candle_pattern_lifecycle" },
  { name: "features_pricing", fn: "refresh_pricing_lifecycle" },
  { name: "features_displacement", fn: "refresh_displacement_lifecycle" },
  // P0: Added missing feature producers to scheduled refresh (conversation context Jul 2026)
  // features_opening_range is session-scoped; the lifecycle function is a no-op
  // for lifecycle columns (no mitigated_at/invalidated_at) but tracks the
  // lifecycle_refresh_state checkpoint so the stale_state_feature gate can
  // confirm the producer is alive.
  { name: "features_opening_range", fn: "refresh_opening_range_lifecycle" },
];

// Default to refreshing every lifecycle table. features_ifvg was historically
// skipped while its invalidation logic was buggy (fixed in migration 052; scars
// repaired + guarded by invariants in migration 101), so it is now refreshed
// alongside the other level/event tables. Set TM_LIFECYCLE_SKIP_TABLES to a
// comma-separated list to opt specific tables out of a run.
const skipTables = new Set(
  (process.env.TM_LIFECYCLE_SKIP_TABLES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const enabledTables = ALL_TABLES.filter((t) => !skipTables.has(t.name));

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME || "tradzfx-lifecycle",
  max: parseInt(process.env.TM_DB_POOL_MAX || "5", 10),
  connectionTimeoutMillis: parseInt(process.env.TM_DB_CONNECTION_TIMEOUT || "5000", 10),
  idleTimeoutMillis: parseInt(process.env.TM_DB_IDLE_TIMEOUT || "30000", 10),
  // node-postgres `options` uses the libpq startup-parameter form (-c key=val);
  // the previous `--statement_timeout=` prefix was silently ignored, so every
  // call fell back to the server default (60s) and large refreshes timed out.
  options: `-c statement_timeout=${STATEMENT_TIMEOUT}`,
});

async function refreshSymbol(symbol, lookbackDays, limit) {
  const { rows: tsRows } = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
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
    // PARALLEL: each table refresh is independent — different DB functions,
    // different WHERE clauses, no transaction overlap. Promise.all cuts wall
    // time from sum(table times) to max(table time). (Audit item #11)
    const tableTasks = enabledTables.map(async (t) => {
      try {
        let n = 0;
        if (t.name === "features_zone") {
          const { rows } = await pool.query(
            `SELECT ${t.fn}($1, $2::timestamptz, make_interval(days => $3), $4, NULL, false) AS rows_updated`,
            [symbol, maxTs, lookbackDays, limit]
          );
          n = Number(rows[0]?.rows_updated ?? 0);
        } else {
          const { rows } = await pool.query(
            `SELECT ${t.fn}($1, $2::timestamptz, make_interval(days => $3), $4) AS rows_updated`,
            [symbol, maxTs, lookbackDays, limit]
          );
          n = Number(rows[0]?.rows_updated ?? 0);
        }
        // Best-effort ledger write.
        try {
          await pool.query(
            `INSERT INTO feature_producer_runs
               (producer, feature_table, symbol, rows_updated, finished_at, status, watermark_ts, quality_json)
             VALUES ('lifecycle', $1, $2, $3, NOW(), 'done', $4, $5)`,
            [t.name, symbol, n, maxTs, JSON.stringify({ lookbackDays, limit, iteration })]
          );
        } catch { /* ledger is best-effort */ }
        return { name: t.name, n };
      } catch (err) {
        console.error(`[refresh-lifecycle] ${symbol}/${t.name} failed:`, err.message);
        return { name: t.name, n: 0 };
      }
    });

    const results = await Promise.all(tableTasks);
    const total = results.reduce((sum, r) => sum + r.n, 0);
    const parts = results.map((r) => `${r.name}=${r.n}`);
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
      `SELECT symbol
         FROM ops.feature_pipeline_symbols
        WHERE enabled = true
        ORDER BY symbol`
    );
    // Parallel per-symbol refresh (independent DB calls, separate pools).
    // Wall time = max(symbol time), not sum. (Audit item #11)
    const results = await Promise.all(
      rows.map(({ symbol }) => refreshSymbol(symbol, lookbackDays, limit))
    );
    const grandTotal = results.reduce((s, v) => s + v, 0);
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
