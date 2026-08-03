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
const { evaluateLifecycleProgress } = require("./lib/lifecycle-convergence.js");

const OWNER = "tz-refresh-lifecycle";
const MAX_ITERATIONS = parseInt(process.env.TM_LIFECYCLE_MAX_ITERATIONS || "100", 10);
const DEADLINE_MS = parseInt(process.env.TM_LIFECYCLE_DEADLINE_MS || "900000", 10);

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

// These producer functions advance a checkpoint/update bookkeeping row on
// every call. Repeating them cannot drain lifecycle work and can keep the
// outer loop alive until MAX_ITERATIONS. Run them once per symbol/pass.
const SINGLE_PASS_TABLES = new Set([
  "features_atr",
  "features_spread",
  "features_candle_pattern",
  "features_pricing",
  "features_displacement",
  "features_opening_range",
]);

const pool = new Pool({
  host: process.env.TM_DB_HOST || "localhost",
  port: parseInt(process.env.TM_DB_PORT || "5432", 10),
  database: process.env.TM_DB_NAME || "tradzfx_v2",
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  application_name: process.env.TM_DB_APPLICATION_NAME || "tradzfx-lifecycle",
  // Lifecycle refresh is maintenance work. One client prevents this runner
  // from amplifying lock contention while the web/engine pools are active.
  max: parseInt(process.env.TM_DB_POOL_MAX || "1", 10),
  connectionTimeoutMillis: parseInt(process.env.TM_DB_CONNECTION_TIMEOUT || "5000", 10),
  idleTimeoutMillis: parseInt(process.env.TM_DB_IDLE_TIMEOUT || "30000", 10),
  // node-postgres `options` uses the libpq startup-parameter form (-c key=val);
  // the previous `--statement_timeout=` prefix was silently ignored, so every
  // call fell back to the server default (60s) and large refreshes timed out.
  options: `-c statement_timeout=${STATEMENT_TIMEOUT}`,
});

async function readCheckpoints(client, symbol) {
  const { rows } = await client.query(
    `SELECT table_name, last_processed_ts
       FROM lifecycle_refresh_state
      WHERE symbol = $1`,
    [symbol]
  );
  return Object.fromEntries(rows.map((row) => [row.table_name, row.last_processed_ts]));
}

async function refreshSymbol(symbol, lookbackDays, limit) {
  const client = await pool.connect();
  // Shared key with inline updater: canonical and best-effort owners cannot overlap.
  const lockKey = `lifecycle:${symbol}`;
  try {
    const { rows: lockRows } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockKey]
    );
    if (!lockRows[0]?.locked) {
      console.log(`[refresh-lifecycle] ${symbol}: already_running`);
      return { symbol, status: "already_running", rowsUpdated: 0 };
    }

    const { rows: tsRows } = await client.query(
      `SELECT MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
      [symbol]
    );
    const maxTs = tsRows[0]?.max_ts;
    if (!maxTs) {
      console.log(`[refresh-lifecycle] ${symbol}: no candles, skipping`);
      return { symbol, status: "no_data", rowsUpdated: 0 };
    }

    const before = await readCheckpoints(client, symbol);
    console.log(
      `[refresh-lifecycle] Refreshing ${symbol} as-of ${maxTs} (last ${lookbackDays} days, limit ${limit})...`
    );
    const startedAt = Date.now();
    let grandTotal = 0;
    let iteration = 0;
    let hitBound = false;
    let failures = [];
    const repeatableTables = enabledTables.filter((table) => !SINGLE_PASS_TABLES.has(table.name));
    const refreshTable = async (t) => {
      try {
        const args = [symbol, maxTs, lookbackDays, limit];
        const sql = t.name === "features_zone"
          ? `SELECT ${t.fn}($1, $2::timestamptz, make_interval(days => $3), $4, NULL, false) AS rows_updated`
          : `SELECT ${t.fn}($1, $2::timestamptz, make_interval(days => $3), $4) AS rows_updated`;
        const { rows } = await client.query(sql, args);
        return { name: t.name, n: Number(rows[0]?.rows_updated ?? 0) };
      } catch (err) {
        failures.push({ table: t.name, error: err.message });
        return { name: t.name, n: 0 };
      }
    };
    const firstPass = [];
    for (const table of enabledTables) {
      firstPass.push(await refreshTable(table));
    }
    grandTotal += firstPass.reduce((sum, result) => sum + result.n, 0);
    console.log(`  iteration 1: ${firstPass.map((r) => `${r.name}=${r.n}`).join(", ")}`);
    while (true) {
      iteration++;
      if (iteration > MAX_ITERATIONS || Date.now() - startedAt >= DEADLINE_MS) {
        hitBound = true;
        break;
      }
      const results = [];
      for (const table of repeatableTables) {
        results.push(await refreshTable(table));
      }
      const total = results.reduce((sum, result) => sum + result.n, 0);
      grandTotal += total;
      console.log(`  iteration ${iteration}: ${results.map((r) => `${r.name}=${r.n}`).join(", ")}`);
      if (failures.length > 0 || total === 0) break;
    }

    const after = await readCheckpoints(client, symbol);
    const perTable = enabledTables.map((table) => {
      const progress = evaluateLifecycleProgress({
        before: before[table.name],
        after: after[table.name],
        rowsUpdated: grandTotal,
        eligibleWork: { exists: grandTotal > 0, asOf: maxTs },
        hitBound,
      });
      return { table: table.name, before: before[table.name] ?? null, after: after[table.name] ?? null, ...progress };
    });
    const noProgress = perTable.some((item) => item.verdict === "NO_PROGRESS");
    const status = failures.length > 0 || noProgress ? "error" : "done";
    const quality = { owner: OWNER, lookbackDays, limit, iteration, hitBound, failures, checkpoints: perTable };
    await client.query(
      `INSERT INTO feature_producer_runs
         (producer, feature_table, symbol, rows_updated, finished_at, status, error_message, watermark_ts, quality_json)
       VALUES ('lifecycle', '*', $1, $2, NOW(), $3, $4, $5, $6)`,
      [symbol, grandTotal, status, failures.length ? JSON.stringify(failures) : noProgress ? "NO_PROGRESS" : null, maxTs, quality]
    );
    if (status === "error") throw new Error(`Lifecycle ${symbol} failed: ${failures.length ? "table failure" : "NO_PROGRESS"}`);
    console.log(`[refresh-lifecycle] ${symbol} ${hitBound ? "partial" : "done"}, total ${grandTotal} rows updated`);
    return { symbol, status: hitBound ? "partial" : "done", rowsUpdated: grandTotal };
  } finally {
    try { await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockKey]); } catch { /* connection cleanup releases lock */ }
    client.release();
  }
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
    // Process symbols sequentially. Parallel refreshes acquire independent
    // clients and call lifecycle functions that update shared state/candles;
    // concurrent symbols previously caused deadlocks and pool exhaustion.
    const results = [];
    for (const { symbol } of rows) {
      results.push(await refreshSymbol(symbol, lookbackDays, limit));
    }
    const grandTotal = results.reduce((sum, result) => sum + result.rowsUpdated, 0);
    const partial = results.filter((result) => result.status === "partial").length;
    const skipped = results.filter((result) => result.status === "already_running").length;
    console.log(`[refresh-lifecycle] ALL done. Grand total: ${grandTotal} rows updated; partial=${partial}; already_running=${skipped}`);
  } else {
    const result = await refreshSymbol(target, lookbackDays, limit);
    console.log(`[refresh-lifecycle] ${target}: status=${result.status}, total=${result.rowsUpdated} rows updated`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[refresh-lifecycle] Fatal error:", err);
  process.exit(1);
});
