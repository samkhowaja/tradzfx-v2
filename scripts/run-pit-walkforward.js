/**
 * Walk-forward PIT backtest for the top Phase 2 specs.
 *
 * Runs sliding windows over the available history and reports Net R / WR per window.
 *
 * Usage:
 *   node run-pit-walkforward.js [windowDays] [stepDays] [outputDir]
 *   node run-pit-walkforward.js 30 15 reports/walkforward-30d-15d-step
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");
const yaml = require("js-yaml");

const RUNNER = path.join(__dirname, "backtest-pit-v2.js");
const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const activeOnly = process.argv.includes("--active-only");
const SPECS = fs
  .readdirSync(SPECS_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => f.replace(/\.yaml$/, ""))
  .filter((id) => {
    if (!activeOnly) return true;
    const spec = loadSpec(id);
    return spec.active !== false;
  });
const CONCURRENCY = 4;

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: (process.env.TM_DB_NAME || "tradzfx_v2"),
  user: "postgres",
  password: process.env.TM_DB_PASSWORD,
  max: 2,
});

function loadSpec(specId) {
  const file = path.join(__dirname, "..", "packages", "strategies", "src", "specs", `${specId}.yaml`);
  return yaml.load(fs.readFileSync(file, "utf8"));
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function runTask(symbol, days, specId, endDate) {
  return new Promise((resolve) => {
    const args = [RUNNER, symbol, String(days), specId, `--end=${endDate.toISOString()}`, "--json"];
    const proc = spawn("node", args, { cwd: path.join(__dirname, "..") });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      let result = null;
      const endIso = endDate.toISOString();
      if (code !== 0) {
        result = { spec: specId, symbol, days, end: endIso, error: `exit code ${code}`, stderr: stderr.slice(-500) };
      } else {
        const lines = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("{"));
        if (lines.length === 0) {
          result = { spec: specId, symbol, days, end: endIso, error: "no JSON output", stdout: stdout.slice(-500) };
        } else {
          try {
            const parsed = JSON.parse(lines[lines.length - 1]);
            result = { ...parsed, end: endIso };
          } catch (e) {
            result = { spec: specId, symbol, days, end: endIso, error: `JSON parse error: ${e.message}`, stdout: stdout.slice(-500) };
          }
        }
      }
      resolve(result);
    });
  });
}

async function withConcurrency(tasks, limit) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      const task = tasks[i];
      const started = Date.now();
      const result = await task();
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      results[i] = result;
      const status = result.error ? `ERROR (${result.error})` : `done (${elapsed}s)`;
      console.log(`[walkforward] ${result.spec} / ${result.symbol} / ${formatDate(new Date(result.end))}: ${status}`);
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const windowDays = parseInt(args[0] || "30", 10);
  const stepDays = parseInt(args[1] || "15", 10);
  const outputDir = args[2] || path.join(__dirname, "..", "reports", `walkforward-${windowDays}d-${stepDays}d-step-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outputDir, { recursive: true });

  const { rows } = await pool.query(`SELECT MAX(ts) AS max_ts FROM market.candles_1m_canonical`);
  const latestTs = rows[0].max_ts ? new Date(rows[0].max_ts) : new Date();

  // Build end dates stepping back from latest, while a full window fits.
  const endDates = [];
  let end = new Date(latestTs);
  const earliestAllowed = new Date("2026-03-12T00:00:00Z"); // keep within our 90-day DXY coverage
  while (new Date(end.getTime() - windowDays * 24 * 60 * 60 * 1000) >= earliestAllowed) {
    endDates.push(new Date(end));
    end = new Date(end.getTime() - stepDays * 24 * 60 * 60 * 1000);
  }

  console.log(`[walkforward] window=${windowDays}d step=${stepDays}d windows=${endDates.length} latest=${latestTs.toISOString()}`);

  const tasks = [];
  for (const specId of SPECS) {
    const spec = loadSpec(specId);
    const symbols = spec.filters?.symbols || [];
    for (const symbol of symbols) {
      for (const d of endDates) {
        tasks.push(() => runTask(symbol, windowDays, specId, d));
      }
    }
  }

  console.log(`[walkforward] ${tasks.length} spec/symbol/window combinations to run\n`);

  const started = Date.now();
  const results = await withConcurrency(tasks, CONCURRENCY);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  fs.writeFileSync(path.join(outputDir, "raw-results.json"), JSON.stringify(results, null, 2), "utf8");

  // Aggregate per spec per window
  const agg = {};
  for (const r of results) {
    if (r.error) continue;
    const key = `${r.spec}|${r.end}`;
    if (!agg[key]) agg[key] = { spec: r.spec, end: r.end, symbols: 0, raw: 0, executed: 0, wins: 0, losses: 0, timeouts: 0, netR: 0 };
    agg[key].symbols++;
    agg[key].raw += r.rawSignals;
    agg[key].executed += r.executed;
    agg[key].wins += r.wins;
    agg[key].losses += r.losses;
    agg[key].timeouts += r.timeouts;
    agg[key].netR += r.netR;
  }

  const aggRows = Object.values(agg).sort((a, b) => {
    if (a.spec !== b.spec) return a.spec.localeCompare(b.spec);
    return new Date(a.end) - new Date(b.end);
  });

  // Per-spec summary across all windows
  const specSummary = {};
  for (const r of aggRows) {
    if (!specSummary[r.spec]) specSummary[r.spec] = { windows: 0, totalNetR: 0, totalExec: 0, wins: 0, losses: 0 };
    specSummary[r.spec].windows++;
    specSummary[r.spec].totalNetR += r.netR;
    specSummary[r.spec].totalExec += r.executed;
    specSummary[r.spec].wins += r.wins;
    specSummary[r.spec].losses += r.losses;
  }

  // Markdown report
  const lines = [];
  lines.push(`# Walk-Forward PIT Backtest`);
  lines.push("");
  lines.push(`**Window size:** ${windowDays} days`);
  lines.push(`**Step size:** ${stepDays} days`);
  lines.push(`**Latest data:** ${latestTs.toISOString()}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Per-spec summary across windows");
  lines.push("");
  lines.push("| Spec | Windows | Executed | Wins | Losses | WR% | Total Net R | Avg Net R / window |");
  lines.push("|------|---------|----------|------|--------|-----|-------------|--------------------|");
  for (const [spec, s] of Object.entries(specSummary)) {
    const wr = s.wins + s.losses > 0 ? ((s.wins / (s.wins + s.losses)) * 100).toFixed(1) : "0.0";
    const avg = s.windows > 0 ? (s.totalNetR / s.windows).toFixed(2) : "0.00";
    lines.push(`| ${spec} | ${s.windows} | ${s.totalExec} | ${s.wins} | ${s.losses} | ${wr} | ${s.totalNetR.toFixed(2)} | ${avg} |`);
  }
  lines.push("");

  lines.push("## Per-window aggregate");
  lines.push("");
  lines.push("| Spec | Window end | Symbols | Raw | Executed | Wins | Losses | Timeouts | WR% | Net R |");
  lines.push("|------|------------|---------|-----|----------|------|--------|----------|-----|-------|");
  for (const r of aggRows) {
    const wr = r.wins + r.losses > 0 ? ((r.wins / (r.wins + r.losses)) * 100).toFixed(1) : "0.0";
    lines.push(`| ${r.spec} | ${formatDate(new Date(r.end))} | ${r.symbols} | ${r.raw} | ${r.executed} | ${r.wins} | ${r.losses} | ${r.timeouts} | ${wr} | ${r.netR.toFixed(2)} |`);
  }
  lines.push("");

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors.slice(0, 20)) {
      lines.push(`- ${e.spec} / ${e.symbol} / ${e.end}: ${e.error}`);
    }
    lines.push("");
  }

  fs.writeFileSync(path.join(outputDir, "summary.md"), lines.join("\n"), "utf8");

  console.log(`\n[walkforward] Completed in ${elapsed}s`);
  console.log(`[walkforward] Raw results: ${path.join(outputDir, "raw-results.json")}`);
  console.log(`[walkforward] Summary:     ${path.join(outputDir, "summary.md")}`);

  await pool.end();
}

main().catch((e) => {
  console.error("[walkforward] Fatal:", e);
  process.exit(1);
});
