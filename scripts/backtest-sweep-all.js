/**
 * Full strategy × symbol baseline sweep (#14D).
 *
 * Backtests every active variant on every symbol it supports, using the pinned
 * historical window approach. Outputs a CSV summary of key metrics.
 *
 * Usage:
 *   node scripts/backtest-sweep-all.js [--end=2026-07-21] [--min-days=7] [--max-warmup-hours=500]
 *
 * Output:  stdout (CSV)  plus  data/backtest-seed/sweep-baseline-<end>.csv
 *          per-variant logs go to reports/sweep-logs/
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });

const { Pool } = require("pg");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const BACKTEST_SCRIPT = path.join(__dirname, "backtest-pit-v2.js");
const {
  computeWarmupMs,
} = require(BACKTEST_SCRIPT);
const {
  loadStrategyFromDB,
} = require(path.join(__dirname, "..", "packages", "strategies", "dist", "index.js"));

// CLI
const endDate = process.argv.find((a) => a.startsWith("--end="))?.slice("--end=".length) ?? "2026-07-20";
const maxWarmupHours = parseInt(
  process.argv.find((a) => a.startsWith("--max-warmup-hours="))?.slice("--max-warmup-hours=".length) ?? "500",
  10
);
const minDays = parseInt(
  process.argv.find((a) => a.startsWith("--min-days="))?.slice("--min-days=".length) ?? "7",
  10
);

function computeMinDays(spec) {
  const warmupMs = computeWarmupMs(spec);
  return Math.ceil((2 * warmupMs + 3600000) / 86400000);
}

/**
 * Parse the last few lines of backtest output to extract summary metrics.
 * Returns null on failure.
 */
function parseBacktestOutput(stdout) {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  const result = {
    executed: null,
    wins: null,
    losses: null,
    timeouts: null,
    wr: null,
    netR: null,
    avgWin: null,
    avgLoss: null,
    invalid: null,
    driftRejected: null,
    skipped: null,
    signals: null,
    error: null,
  };

  // Look for metrics lines
  for (const line of lines) {
    // "Executed: 11 | Drift rejected: 0 | Invalid outcomes: 0 | Timeouts: 3 | Skipped: 0 | Heat dropped: 0"
    const execMatch = line.match(/Executed:\s*(\d+)/);
    if (execMatch) result.executed = parseInt(execMatch[1], 10);

    const driftMatch = line.match(/Drift rejected:\s*(\d+)/);
    if (driftMatch) result.driftRejected = parseInt(driftMatch[1], 10);

    const invalidMatch = line.match(/Invalid outcomes:\s*(\d+)/);
    if (invalidMatch) result.invalid = parseInt(invalidMatch[1], 10);

    const timeoutMatch = line.match(/Timeouts:\s*(\d+)/);
    if (timeoutMatch) result.timeouts = parseInt(timeoutMatch[1], 10);

    const skipMatch = line.match(/Skipped:\s*(\d+)/);
    if (skipMatch) result.skipped = parseInt(skipMatch[1], 10);

    // "Wins: 9 | Losses: 2 | Timeouts: 3"
    const wrMatch = line.match(/Wins:\s*(\d+)\s*\|\s*Losses:\s*(\d+)/);
    if (wrMatch) {
      result.wins = parseInt(wrMatch[1], 10);
      result.losses = parseInt(wrMatch[2], 10);
    }

    // "WR: 81.8% | Net R: 8.53 | Avg Win: 1.17R | Avg Loss: -1.00R"
    const perfMatch = line.match(/WR:\s*([\d.]+)%\s*\|\s*Net R:\s*([-\d.]+)\s*\|\s*Avg Win:\s*([\d.]+)R\s*\|\s*Avg Loss:\s*([-\d.]+)R/);
    if (perfMatch) {
      result.wr = parseFloat(perfMatch[1]);
      result.netR = parseFloat(perfMatch[2]);
      result.avgWin = parseFloat(perfMatch[3]);
      result.avgLoss = parseFloat(perfMatch[4]);
    }

    // "XAUUSD: 19 raw signals"
    const sigMatch = line.match(/(\d+)\s*raw signals/);
    if (sigMatch) result.signals = parseInt(sigMatch[1], 10);

    // "BLOCKED_SYSTEM_QUALITY"
    if (line.includes("BLOCKED_SYSTEM_QUALITY")) {
      result.error = "BLOCKED";
    }
    // "FATAL"
    if (line.includes("FATAL")) {
      result.error = result.error || "FATAL";
    }
  }
  return result;
}

function classifySuccessfulRun(stdout, metrics) {
  if (metrics.error === "BLOCKED") return "BLOCKED";
  if (/no signals/i.test(stdout)) return "NO_SIGNALS";
  if (metrics.executed != null && metrics.executed === 0) return "NO_EXECUTIONS";
  if (metrics.executed != null) return "OK";
  return "UNKNOWN";
}

function classifyFailedRun(output) {
  if (/not in allowed list/i.test(output)) return "INCOMPATIBLE_SYMBOL";
  if (/BLOCKED_SYSTEM_QUALITY/i.test(output)) return "BLOCKED";
  if (/\bFatal:/i.test(output) || /\bFATAL\b/.test(output)) return "FATAL";
  return "CRASH";
}

async function main() {
  const pool = new Pool({
    host: process.env.TM_DB_HOST || "localhost",
    port: parseInt(process.env.TM_DB_PORT || "5432", 10),
    database: process.env.TM_DB_NAME || "tradzfx_v2",
    user: process.env.TM_DB_USER || "postgres",
    password: process.env.TM_DB_PASSWORD,
  });

  // Fetch all active variants with their symbol filters
  const { rows: variants } = await pool.query(
    "SELECT id, name, symbols, family_id FROM strategy_variants WHERE is_active = true ORDER BY id"
  );
  console.error(`[sweep] Loaded ${variants.length} active variants`);

  // Available DB symbols
  const { rows: symRows } = await pool.query(
    "SELECT DISTINCT symbol FROM market.candles_1m_canonical ORDER BY symbol"
  );
  const availableSymbols = new Set(symRows.map((r) => r.symbol));
  console.error(`[sweep] Available symbols: ${[...availableSymbols].join(", ")}`);

  // Build run queue: for each variant, find compatible symbols
  const queue = [];
  let skippedVariants = 0;

  for (const v of variants) {
    // Determine allowed symbols from variant definition
    // Load spec to compute window
    let spec;
    try {
      spec = await loadStrategyFromDB(pool, v.id);
      if (!spec) {
        console.error(`[sweep] ⚠ Skipping ${v.id}: cannot load spec from DB`);
        skippedVariants++;
        continue;
      }
    } catch (err) {
      console.error(`[sweep] ⚠ Skipping ${v.id}: spec load error — ${err.message}`);
      skippedVariants++;
      continue;
    }

    // Symbol filters may live in variant DB column or merged strategy spec.
    // Prefer explicit variant column, then spec symbols. Never run an
    // unrestricted sweep for a symbol-scoped strategy.
    const configuredSymbols = Array.isArray(v.symbols) && v.symbols.length > 0
      ? v.symbols
      : Array.isArray(spec.symbols) && spec.symbols.length > 0
        ? spec.symbols
        : null;
    const allowed = (configuredSymbols ?? [...availableSymbols])
      .filter((s) => availableSymbols.has(s));

    if (allowed.length === 0) {
      console.error(`[sweep] ⚠ Skipping ${v.id}: no compatible symbols`);
      skippedVariants++;
      continue;
    }

    const warmupMs = computeWarmupMs(spec);
    const warmupDays = computeMinDays(spec);
    const variantDays = Math.max(minDays, warmupDays);
    const warmupHrs = Math.round(warmupMs / 3600000);

    // Skip absurdly long windows
    if (warmupHrs > maxWarmupHours) {
      console.error(`[sweep] ⚠ Skipping ${v.id}: warmup ${warmupHrs}h > max ${maxWarmupHours}h`);
      skippedVariants++;
      continue;
    }

    for (const symbol of allowed) {
      queue.push({ variant: v, symbol, variantDays, warmupHrs, spec });
    }
  }

  console.error(`[sweep] Queue: ${queue.length} runs (${skippedVariants} skipped)`);

  // CSV header
  const csvHeader = "variant_id,variant_name,symbol,days,end_date,status,signals,executed,drift_rejected,invalid,timeouts,skipped,wins,losses,wr_pct,net_r,avg_win_r,avg_loss_r,error";

  // Results collection
  const results = [];
  const logDir = path.join(__dirname, "..", "reports", "sweep-logs");
  fs.mkdirSync(logDir, { recursive: true });

  // Run each combination
  for (let i = 0; i < queue.length; i++) {
    const { variant, symbol, variantDays } = queue[i];
    const label = `${variant.id}@${symbol}`;
    const logFile = path.join(logDir, `${variant.id}_${symbol}.log`);
    const warmupHrs = queue[i].warmupHrs;

    console.error(`[sweep] [${i + 1}/${queue.length}] ${label} (${variantDays}d, ~${warmupHrs}h warmup)`);

    try {
      const stdout = execSync(
        `node "${BACKTEST_SCRIPT}" ${symbol} ${variantDays} ${variant.id} --end=${endDate} --mode=fast`,
        {
          stdio: "pipe",
          timeout: 600_000, // 10 min per variant-symbol
          cwd: path.join(__dirname, ".."),
          env: { ...process.env, BACKTEST_HISTORICAL_STALE_OK: "1" },
          maxBuffer: 10 * 1024 * 1024,
        }
      ).toString();

      // Write log
      fs.writeFileSync(logFile, stdout);

      // Parse metrics
      const metrics = parseBacktestOutput(stdout);
      results.push({
        variantId: variant.id,
        variantName: variant.name,
        symbol,
        days: variantDays,
        endDate,
        status: classifySuccessfulRun(stdout, metrics),
        signals: metrics.signals,
        executed: metrics.executed,
        driftRejected: metrics.driftRejected,
        invalid: metrics.invalid,
        timeouts: metrics.timeouts,
        skipped: metrics.skipped,
        wins: metrics.wins,
        losses: metrics.losses,
        wrPct: metrics.wr,
        netR: metrics.netR,
        avgWinR: metrics.avgWin,
        avgLossR: metrics.avgLoss,
        error: metrics.error,
      });

      const statusChar = metrics.executed != null && metrics.executed > 0 ? "✓" : "~";
      console.error(`[sweep]   ${statusChar} signals=${metrics.signals ?? "?"} executed=${metrics.executed ?? 0} WR=${metrics.wr != null ? metrics.wr + "%" : "?"} NetR=${metrics.netR ?? "?"}`);
    } catch (err) {
      const stderr = err.stderr?.toString() ?? "";
      const stdout = err.stdout?.toString() ?? "";

      // Save what we can
      const combined = stdout + "\n--- STDERR ---\n" + stderr;
      fs.writeFileSync(logFile, combined);

      const reason = classifyFailedRun(combined);

      results.push({
        variantId: variant.id,
        variantName: variant.name,
        symbol,
        days: variantDays,
        endDate,
        status: reason,
        signals: null,
        executed: null,
        driftRejected: null,
        invalid: null,
        timeouts: null,
        skipped: null,
        wins: null,
        losses: null,
        wrPct: null,
        netR: null,
        avgWinR: null,
        avgLossR: null,
        error: reason,
      });

      console.error(`[sweep]   ❌ ${reason}: ${variant.id}@${symbol}`);
      if (reason !== "CRASH" && reason !== "INCOMPATIBLE_SYMBOL") {
        const tail = combined.split("\n").filter(Boolean).slice(-3).join(" | ");
        console.error(`[sweep]     ${tail}`);
      }
    }
  }

  await pool.end();

  // Generate CSV
  const csvRows = results.map((r) => [
    escapeCsv(r.variantId),
    escapeCsv(r.variantName),
    escapeCsv(r.symbol),
    r.days,
    r.endDate,
    r.status,
    r.signals ?? "",
    r.executed ?? "",
    r.driftRejected ?? "",
    r.invalid ?? "",
    r.timeouts ?? "",
    r.skipped ?? "",
    r.wins ?? "",
    r.losses ?? "",
    r.wrPct != null ? r.wrPct.toFixed(1) : "",
    r.netR != null ? r.netR.toFixed(2) : "",
    r.avgWinR != null ? r.avgWinR.toFixed(2) : "",
    r.avgLossR != null ? r.avgLossR.toFixed(2) : "",
    escapeCsv(r.error ?? ""),
  ].join(","));

  const csv = csvHeader + "\n" + csvRows.join("\n");

  // Print to stdout
  console.log(csv);

  // Save to file
  const outFile = path.join(__dirname, "..", "data", "backtest-seed", `sweep-baseline-${endDate}.csv`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, csv);

  // Summary to stderr
  const ok = results.filter((r) => r.status === "OK").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const fatal = results.filter((r) => r.status === "FATAL").length;
  const incompatible = results.filter((r) => r.status === "INCOMPATIBLE_SYMBOL").length;
  const crashed = results.filter((r) => r.status === "CRASH" || r.status === "UNKNOWN").length;
  const withTrades = results.filter((r) => (r.executed ?? 0) > 0).length;
  const zeroTrades = results.filter((r) =>
    r.status === "NO_SIGNALS" || r.status === "NO_EXECUTIONS"
  ).length;

  console.error(`\n[sweep] ═══════════════════════════════════════`);
  console.error(`[sweep] Total runs: ${results.length}`);
  console.error(`[sweep] OK: ${ok} | Blocked: ${blocked} | Fatal: ${fatal} | Incompatible: ${incompatible} | Crash/Unknown: ${crashed}`);
  console.error(`[sweep] With trades: ${withTrades} | Zero trades: ${zeroTrades}`);
  console.error(`[sweep] CSV saved: ${outFile}`);
}

function escapeCsv(v) {
  if (v == null) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

main().catch((e) => {
  console.error("[sweep] ❌ Fatal:", e);
  process.exit(1);
});
