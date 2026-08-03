/**
 * Backtest smoke test (#14C).
 *
 * Runs every active variant in --mode=fast with a dynamically computed window
 * (2× warmupMs minimum) and asserts exit code 0.
 * Exits 1 on any failure — wired into the CI gate so no future commit can ship
 * a backtester crash.
 *
 * Usage:
 *   node scripts/backtest-smoke-test.js [--symbol=EURUSD] [--min-days=7]
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { execSync } = require("child_process");
const path = require("path");

const BACKTEST_SCRIPT = path.join(__dirname, "backtest-pit-v2.js");
const DEFAULT_SYMBOL = "EURUSD";
const DEFAULT_MIN_DAYS = 7;
const END_BUFFER_DAYS = 4; // pin end date this many days ago to avoid stale-at-edge

// Reuse warmup-computation logic from the backtester
const {
  computeWarmupMs,
} = require(BACKTEST_SCRIPT);
const {
  deriveSignalTf,
  loadStrategyFromDB,
} = require(path.join(__dirname, "..", "packages", "strategies", "dist", "index.js"));

/**
 * Compute the minimum backtest window (in days) so 2× warmup fits.
 */
function computeMinDays(spec) {
  const warmupMs = computeWarmupMs(spec);
  // 2× warmup, plus 1h buffer, rounded up to nearest day
  return Math.ceil((2 * warmupMs + 3600000) / 86400000);
}

/**
 * Return a pinned end date string (YYYY-MM-DD) a few days ago so features are
 * guaranteed fresh and we avoid "stale at market edge" false alarms.
 */
function pinnedEndDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - END_BUFFER_DAYS);
  // Floor to midnight UTC
  return d.toISOString().slice(0, 10);
}

async function main() {
  const symbol = process.argv.find((a) => a.startsWith("--symbol="))?.slice("--symbol=".length) ?? DEFAULT_SYMBOL;
  const minDays = parseInt(process.argv.find((a) => a.startsWith("--min-days="))?.slice("--min-days=".length) ?? String(DEFAULT_MIN_DAYS), 10);

  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  console.log(`[backtest-smoke] Fetching active variants...`);

  const { rows } = await pool.query(
    `SELECT v.id, v.name
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.is_active = true
     ORDER BY v.id`
  );

  if (rows.length === 0) {
    console.log("[backtest-smoke] No active variants found. Nothing to test.");
    await pool.end();
    return;
  }

  console.log(`[backtest-smoke] Found ${rows.length} active variant(s):\n`);
  for (const r of rows) {
    console.log(`  ${r.id}  (${r.name})`);
  }
  console.log("");

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const variant of rows) {
    const label = `${variant.id} (${variant.name})`;

    // Load spec, compute required window, and choose a compatible symbol.
    let variantDays;
    let variantSymbol = symbol;
    try {
      const spec = await loadStrategyFromDB(pool, variant.id);
      if (!spec) {
        console.error(`[backtest-smoke] ❌ Cannot load spec for ${label} — skipping`);
        failed++;
        failures.push({ id: variant.id, reason: "no_spec", detail: "Cannot load variant spec from DB" });
        continue;
      }
      const allowedSymbols = spec.filters?.symbols ?? [];
      if (allowedSymbols.length > 0 && !allowedSymbols.includes(symbol)) {
        variantSymbol = allowedSymbols[0];
      }
      const warmupDays = computeMinDays(spec);
      variantDays = Math.max(minDays, warmupDays);
      const signalTf = deriveSignalTf(spec);
      const warmupMs = computeWarmupMs(spec);
      console.log(`[backtest-smoke] ── ${label}: symbol=${variantSymbol}, signalTf=${signalTf}, warmupMs=${warmupMs}ms (${(warmupMs/3600000).toFixed(1)}h), window=${variantDays}d`);
    } catch (err) {
      console.error(`[backtest-smoke] ❌ Spec load failed for ${label}: ${err.message}`);
      failed++;
      failures.push({ id: variant.id, reason: "spec_load", detail: err.message });
      continue;
    }

    // Determine pinned end date so the backtest uses a window where features are
    // guaranteed fresh (avoiding stale-at-market-edge false alarms).
    const endDate = pinnedEndDate();

    // Run backtest with a pinned historical window and env var that downgrades
    // producer-stale & stale-state to warnings (they are irrelevant to a PIT-correct
    // historical window ending before now).
    console.log(`[backtest-smoke] 🏃 Running ${label} on ${variantSymbol} ${variantDays}d → ${endDate} (mode=fast)...`);
    try {
      execSync(
        `node "${BACKTEST_SCRIPT}" ${variantSymbol} ${variantDays} ${variant.id} --end=${endDate} --mode=fast`,
        {
          stdio: "pipe",
          timeout: 300_000, // 5 min per variant
          cwd: path.join(__dirname, ".."),
          env: { ...process.env, BACKTEST_HISTORICAL_STALE_OK: "1" },
        }
      );
      console.log(`[backtest-smoke] ✓ Passed: ${label}`);
      passed++;
    } catch (err) {
      console.error(`[backtest-smoke] ❌ FAILED: ${label}`);
      console.error(`  exit code: ${err.status}, signal: ${err.signal}`);
      const stderr = (err.stderr?.toString() ?? "").split("\n").filter(Boolean).slice(-10);
      stderr.forEach((l) => console.error(`  ${l}`));
      failed++;
      failures.push({ id: variant.id, reason: "backtest_crash", detail: stderr.join("; ") });
    }
  }

  await pool.end();

  // Summary
  console.log(`\n[backtest-smoke] ═══════════════════════════════════`);
  console.log(`[backtest-smoke]  Passed: ${passed}  |  Failed: ${failed}  |  Total: ${rows.length}`);
  if (failures.length > 0) {
    console.error(`[backtest-smoke] Failures:`);
    for (const f of failures) {
      console.error(`  - ${f.id}: ${f.reason} — ${f.detail}`);
    }
    process.exit(1);
  }
  console.log(`[backtest-smoke] ✅ All variants passed.`);
}

main().catch((e) => {
  console.error("[backtest-smoke] ❌ Fatal:", e);
  process.exit(1);
});
