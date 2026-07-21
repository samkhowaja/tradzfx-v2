/**
 * Backtest smoke test (#14C).
 *
 * Runs every active variant for 1 day in --mode=fast and asserts exit code 0.
 * Exits 1 on any failure — wired into the CI gate so no future commit can ship
 * a backtester crash.
 *
 * Usage:
 *   node scripts/backtest-smoke-test.js [--symbol=EURUSD] [--days=1]
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { execSync } = require("child_process");
const path = require("path");

const BACKTEST_SCRIPT = path.join(__dirname, "backtest-pit-v2.js");
const DEFAULT_SYMBOL = "EURUSD";
const DEFAULT_DAYS = 1;

async function main() {
  const symbol = process.argv.find((a) => a.startsWith("--symbol="))?.slice("--symbol=".length) ?? DEFAULT_SYMBOL;
  const days = parseInt(process.argv.find((a) => a.startsWith("--days="))?.slice("--days=".length) ?? String(DEFAULT_DAYS), 10);
  const preflightOnly = process.argv.includes("--preflight-only");

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

    // 1. Preflight — check data quality before running the backtest
    console.log(`[backtest-smoke] 🔍 Preflight ${label} on ${symbol} ${days}d...`);
    try {
      execSync(
        `node "${BACKTEST_SCRIPT}" ${symbol} ${days} ${variant.id} --preflight --mode=fast`,
        {
          stdio: "pipe",
          timeout: 120_000,
          cwd: path.join(__dirname, ".."),
        }
      );
      console.log(`[backtest-smoke] ✓ Preflight passed for ${label}`);
    } catch (err) {
      const stderr = err.stderr?.toString() ?? "";
      const stdout = err.stdout?.toString() ?? "";
      // Preflight warnings (DEGRADED) are OK; hard blocks are not.
      if (stderr.includes("BLOCKED") || stdout.includes("BLOCKED") ||
          stderr.includes("blocked") || stdout.includes("blocked") ||
          err.status !== 0 && (stderr.includes("BLOCKED_SYSTEM_QUALITY") || stdout.includes("BLOCKED_SYSTEM_QUALITY"))) {
        console.error(`[backtest-smoke] ❌ Preflight FAILED for ${label} (${symbol} ${days}d)`);
        console.error(`  exit code: ${err.status}, signal: ${err.signal}`);
        const lines = (stderr || stdout).split("\n").filter(Boolean).slice(-5);
        lines.forEach((l) => console.error(`  ${l}`));
        failed++;
        failures.push({ id: variant.id, reason: "preflight", detail: lines.join("; ") });
        continue;
      }
      // Non-blocking issues (DEGRADED, warnings, empty preflight) — proceed to actual backtest
      console.log(`[backtest-smoke] ⚠ Preflight warnings for ${label} — proceeding to smoke test`);
    }

    // 2. Actual backtest (--mode=fast, 1 day)
    console.log(`[backtest-smoke] 🏃 Running ${label} on ${symbol} ${days}d (mode=fast)...`);
    try {
      execSync(
        `node "${BACKTEST_SCRIPT}" ${symbol} ${days} ${variant.id} --mode=fast`,
        {
          stdio: "pipe",
          timeout: 300_000, // 5 min per variant
          cwd: path.join(__dirname, ".."),
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
