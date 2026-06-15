/**
 * Cross-spec portfolio overlap simulation for the top 3 PIT specs.
 *
 * Re-runs the 90-day PIT backtest for doyle_sd / orb_classic / watukushay_no1,
 * collects individual trades, then merges them chronologically and applies
 * combined portfolio-heat limits.
 *
 * Usage:
 *   node run-pit-portfolio.js [days] [outputDir]
 *   node run-pit-portfolio.js 90 reports/portfolio-overlap
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const yaml = require("js-yaml");

const RUNNER = path.join(__dirname, "backtest-pit-v2.js");
const SPECS = ["doyle_sd", "orb_classic", "watukushay_no1"];
const CONCURRENCY = 4;

const MAX_PER_SYMBOL = 2;
const MAX_TOTAL = 6;

function loadSpec(specId) {
  const file = path.join(__dirname, "..", "packages", "strategies", "src", "specs", `${specId}.yaml`);
  return yaml.load(fs.readFileSync(file, "utf8"));
}

function runTask(symbol, days, specId) {
  return new Promise((resolve) => {
    const args = [RUNNER, symbol, String(days), specId, "--json", "--trades"];
    const proc = spawn("node", args, { cwd: path.join(__dirname, "..") });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ spec: specId, symbol, error: `exit code ${code}`, stderr: stderr.slice(-500) });
        return;
      }
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("{"));
      if (lines.length === 0) {
        resolve({ spec: specId, symbol, error: "no JSON output", stdout: stdout.slice(-500) });
        return;
      }
      try {
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch (e) {
        resolve({ spec: specId, symbol, error: `JSON parse error: ${e.message}`, stdout: stdout.slice(-500) });
      }
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
      console.log(`[portfolio] ${result.spec || "?"} / ${result.symbol || "?"}: ${status}`);
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return results;
}

function simulatePortfolio(trades) {
  const sorted = trades
    .map((t) => ({
      ...t,
      ts: new Date(t.ts).getTime(),
      closeTs: new Date(t.closeTs).getTime(),
    }))
    .sort((a, b) => a.ts - b.ts);

  const accepted = [];
  const dropped = [];
  let maxConcurrent = 0;

  for (const t of sorted) {
    // Count active trades at t.ts
    const active = accepted.filter((a) => a.closeTs > t.ts);
    const activeSymbol = active.filter((a) => a.symbol === t.symbol);

    if (activeSymbol.length >= MAX_PER_SYMBOL || active.length >= MAX_TOTAL) {
      dropped.push(t);
      continue;
    }

    accepted.push(t);
    const currentConcurrent = active.length + 1;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
  }

  const wins = accepted.filter((t) => t.outcome === "win").length;
  const losses = accepted.filter((t) => t.outcome === "loss").length;
  const timeouts = accepted.filter((t) => t.outcome === "timeout").length;
  const decisive = wins + losses;

  return {
    accepted: accepted.length,
    dropped: dropped.length,
    wins,
    losses,
    timeouts,
    winRate: decisive > 0 ? wins / decisive : 0,
    netR: accepted.reduce((s, t) => s + t.r, 0),
    maxConcurrent,
    droppedBySpec: dropped.reduce((acc, t) => {
      acc[t.spec] = (acc[t.spec] || 0) + 1;
      return acc;
    }, {}),
    acceptedBySpec: accepted.reduce((acc, t) => {
      acc[t.spec] = (acc[t.spec] || 0) + 1;
      return acc;
    }, {}),
  };
}

async function main() {
  const days = parseInt(process.argv[2] || "90", 10);
  const outputDir = process.argv[3] || path.join(__dirname, "..", "reports", `portfolio-overlap-${days}d-${new Date().toISOString().slice(0, 10)}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`[portfolio] days=${days} output=${outputDir}`);

  const tasks = [];
  for (const specId of SPECS) {
    const spec = loadSpec(specId);
    const symbols = spec.filters?.symbols || [];
    for (const symbol of symbols) {
      tasks.push(() => runTask(symbol, days, specId));
    }
  }

  console.log(`[portfolio] ${tasks.length} spec/symbol combinations to run\n`);

  const started = Date.now();
  const results = await withConcurrency(tasks, CONCURRENCY);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    console.error("[portfolio] Errors encountered:");
    for (const e of errors) console.error(`  ${e.spec} / ${e.symbol}: ${e.error}`);
  }

  // Flatten trades and tag with spec
  const allTrades = [];
  for (const r of results) {
    if (!r.error && Array.isArray(r.trades)) {
      for (const t of r.trades) {
        allTrades.push({ ...t, spec: r.spec });
      }
    }
  }

  const simulation = simulatePortfolio(allTrades);

  // Per-spec standalone totals (without overlap)
  const standalone = {};
  for (const r of results) {
    if (r.error) continue;
    if (!standalone[r.spec]) {
      standalone[r.spec] = { raw: 0, executed: 0, wins: 0, losses: 0, netR: 0 };
    }
    standalone[r.spec].raw += r.rawSignals;
    standalone[r.spec].executed += r.executed;
    standalone[r.spec].wins += r.wins;
    standalone[r.spec].losses += r.losses;
    standalone[r.spec].netR += r.netR;
  }

  const lines = [];
  lines.push(`# Cross-Spec Portfolio Overlap Simulation`);
  lines.push("");
  lines.push(`**Window:** last ${days} days`);
  lines.push(`**Specs:** ${SPECS.join(", ")}`);
  lines.push(`**Portfolio limits:** max ${MAX_PER_SYMBOL} concurrent per symbol, max ${MAX_TOTAL} total`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Standalone totals (before overlap)");
  lines.push("");
  lines.push("| Spec | Raw | Executed | Wins | Losses | WR% | Net R |");
  lines.push("|------|-----|----------|------|--------|-----|-------|");
  for (const [spec, s] of Object.entries(standalone)) {
    const wr = s.wins + s.losses > 0 ? ((s.wins / (s.wins + s.losses)) * 100).toFixed(1) : "0.0";
    lines.push(`| ${spec} | ${s.raw} | ${s.executed} | ${s.wins} | ${s.losses} | ${wr} | ${s.netR.toFixed(2)} |`);
  }
  lines.push("");

  lines.push("## Portfolio overlap result");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|--------|-------|");
  lines.push(`| Total trades (standalone) | ${allTrades.length} |`);
  lines.push(`| Accepted trades | ${simulation.accepted} |`);
  lines.push(`| Dropped trades | ${simulation.dropped} |`);
  lines.push(`| Max concurrent positions | ${simulation.maxConcurrent} |`);
  lines.push(`| Wins | ${simulation.wins} |`);
  lines.push(`| Losses | ${simulation.losses} |`);
  lines.push(`| Timeouts | ${simulation.timeouts} |`);
  lines.push(`| WR% | ${(simulation.winRate * 100).toFixed(1)} |`);
  lines.push(`| Net R | ${simulation.netR.toFixed(2)} |`);
  lines.push("");

  lines.push("## Accepted / dropped by spec");
  lines.push("");
  lines.push("| Spec | Accepted | Dropped |");
  lines.push("|------|----------|---------|");
  for (const spec of SPECS) {
    lines.push(`| ${spec} | ${simulation.acceptedBySpec[spec] || 0} | ${simulation.droppedBySpec[spec] || 0} |`);
  }
  lines.push("");

  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors) {
      lines.push(`- ${e.spec} / ${e.symbol}: ${e.error}`);
    }
    lines.push("");
  }

  fs.writeFileSync(path.join(outputDir, "summary.md"), lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(outputDir, "raw-trades.json"), JSON.stringify(allTrades, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "simulation.json"), JSON.stringify(simulation, null, 2), "utf8");

  console.log(`\n[portfolio] Completed in ${elapsed}s`);
  console.log(`[portfolio] Accepted: ${simulation.accepted} | Dropped: ${simulation.dropped} | Net R: ${simulation.netR.toFixed(2)}`);
  console.log(`[portfolio] Summary: ${path.join(outputDir, "summary.md")}`);
}

main().catch((e) => {
  console.error("[portfolio] Fatal:", e);
  process.exit(1);
});
