/**
 * Batch 90-day PIT backtest across all Phase 2 V2 specs and their allowed symbols.
 *
 * Usage:
 *   node run-pit-historical.js [days] [outputDir]
 *   node run-pit-historical.js 90 reports/historical-pit-90d-2026-06-14
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const yaml = require("js-yaml");

const SPECS_DIR = path.join(__dirname, "..", "packages", "strategies", "src", "specs");
const RUNNER = path.join(__dirname, "backtest-pit-v2.js");
const SPECS = [
  "doyle_sd",
  "orb_classic",
  "watukushay_no1",
  "watukushay_fe",
  "forex_strategy_orb",
  "scarface_5m_orb",
];

const CONCURRENCY = 4;

function loadSpec(specId) {
  const file = path.join(SPECS_DIR, `${specId}.yaml`);
  const text = fs.readFileSync(file, "utf8");
  return yaml.load(text);
}

function nowIso() {
  return new Date().toISOString().slice(0, 19).replace(/:/g, "-");
}

function runTask(specId, symbol, days) {
  return new Promise((resolve) => {
    const args = [RUNNER, symbol, String(days), specId, "--json"];
    const proc = spawn("node", args, { cwd: path.join(__dirname, "..") });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));

    proc.on("close", (code) => {
      let result = null;
      if (code !== 0) {
        result = {
          spec: specId,
          symbol,
          days,
          error: `exit code ${code}`,
          stderr: stderr.slice(-500),
        };
      } else {
        const lines = stdout
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("{"));
        if (lines.length === 0) {
          result = {
            spec: specId,
            symbol,
            days,
            error: "no JSON output",
            stdout: stdout.slice(-500),
          };
        } else {
          try {
            result = JSON.parse(lines[lines.length - 1]);
          } catch (e) {
            result = {
              spec: specId,
              symbol,
              days,
              error: `JSON parse error: ${e.message}`,
              stdout: stdout.slice(-500),
            };
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
      console.log(`[batch] ${result.spec} / ${result.symbol}: ${status}`);
    }
  }

  const workers = Array(Math.min(limit, tasks.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
  return results;
}

function computeAggregate(rows) {
  const valid = rows.filter((r) => !r.error);
  const decisive = valid.reduce((s, r) => s + r.wins + r.losses, 0);
  const wins = valid.reduce((s, r) => s + r.wins, 0);
  return {
    rawSignals: valid.reduce((s, r) => s + r.rawSignals, 0),
    executed: valid.reduce((s, r) => s + r.executed, 0),
    skipped: valid.reduce((s, r) => s + r.skipped, 0),
    gateSkips: mergeGateSkips(valid.map((r) => r.gateSkips)),
    wins,
    losses: valid.reduce((s, r) => s + r.losses, 0),
    timeouts: valid.reduce((s, r) => s + r.timeouts, 0),
    noFills: valid.reduce((s, r) => s + r.noFills, 0),
    winRate: decisive > 0 ? wins / decisive : 0,
    netR: valid.reduce((s, r) => s + r.netR, 0),
    avgWinR: wins > 0 ? valid.reduce((s, r) => s + r.avgWinR * r.wins, 0) / wins : 0,
    avgLossR: valid.reduce((s, r) => s + r.losses, 0) > 0
      ? valid.reduce((s, r) => s + r.avgLossR * r.losses, 0) / valid.reduce((s, r) => s + r.losses, 0)
      : 0,
    longCount: valid.reduce((s, r) => s + r.longCount, 0),
    shortCount: valid.reduce((s, r) => s + r.shortCount, 0),
    avgHoldBars: valid.length > 0
      ? valid.reduce((s, r) => s + r.avgHoldBars * r.executed, 0) / valid.reduce((s, r) => s + r.executed, 0) || 0
      : 0,
    symbols: valid.length,
    errors: rows.length - valid.length,
  };
}

function mergeGateSkips(skipsArray) {
  const out = {};
  for (const skips of skipsArray) {
    for (const [k, v] of Object.entries(skips || {})) {
      out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

function formatSkip(reasons) {
  const entries = Object.entries(reasons || {});
  if (entries.length === 0) return "";
  return entries.map(([k, v]) => `${k}=${v}`).join("; ");
}

function writeCsv(outputDir, perSymbolRows, specAggregates) {
  const header = [
    "spec", "symbol", "rawSignals", "executed", "skipped", "gateSkips",
    "wins", "losses", "timeouts", "noFills", "winRate", "netR",
    "avgWinR", "avgLossR", "longCount", "shortCount", "avgHoldBars", "queryMs",
  ].join(",");

  const lines = [header];
  for (const r of perSymbolRows) {
    if (r.error) {
      lines.push([r.spec, r.symbol, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", `error:${r.error}`].join(","));
    } else {
      lines.push([
        r.spec, r.symbol, r.rawSignals, r.executed, r.skipped, formatSkip(r.gateSkips),
        r.wins, r.losses, r.timeouts, r.noFills, r.winRate.toFixed(4), r.netR.toFixed(4),
        r.avgWinR.toFixed(4), r.avgLossR.toFixed(4), r.longCount, r.shortCount, r.avgHoldBars.toFixed(2), r.queryMs,
      ].join(","));
    }
  }

  lines.push("");
  lines.push([
    "spec", "symbols", "rawSignals", "executed", "skipped", "gateSkips",
    "wins", "losses", "timeouts", "noFills", "winRate", "netR",
    "avgWinR", "avgLossR", "longCount", "shortCount", "avgHoldBars", "errors",
  ].join(","));
  for (const [specId, agg] of Object.entries(specAggregates)) {
    lines.push([
      specId, agg.symbols, agg.rawSignals, agg.executed, agg.skipped, formatSkip(agg.gateSkips),
      agg.wins, agg.losses, agg.timeouts, agg.noFills, agg.winRate.toFixed(4), agg.netR.toFixed(4),
      agg.avgWinR.toFixed(4), agg.avgLossR.toFixed(4), agg.longCount, agg.shortCount, agg.avgHoldBars.toFixed(2), agg.errors,
    ].join(","));
  }

  fs.writeFileSync(path.join(outputDir, "summary.csv"), lines.join("\n"), "utf8");
}

function writeMarkdown(outputDir, days, perSymbolRows, specAggregates) {
  const lines = [];
  lines.push(`# 90-Day Historical PIT Backtest Summary`);
  lines.push("");
  lines.push(`**Window:** last ${days} days of available data`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Per-spec aggregate");
  lines.push("");
  lines.push("| Spec | Symbols | Raw | Executed | Skipped | Wins | Losses | Timeouts | WR% | Net R | Avg Win R | Avg Loss R |");
  lines.push("|------|---------|-----|----------|---------|------|--------|----------|-----|-------|-----------|------------|");
  for (const [specId, agg] of Object.entries(specAggregates)) {
    lines.push(
      `| ${specId} | ${agg.symbols} | ${agg.rawSignals} | ${agg.executed} | ${agg.skipped} | ${agg.wins} | ${agg.losses} | ${agg.timeouts} | ${(agg.winRate * 100).toFixed(1)} | ${agg.netR.toFixed(2)} | ${agg.avgWinR.toFixed(2)} | ${agg.avgLossR.toFixed(2)} |`
    );
  }
  lines.push("");

  lines.push("## Per-spec/per-symbol results");
  lines.push("");
  lines.push("| Spec | Symbol | Raw | Executed | Skipped | Wins | Losses | Timeouts | WR% | Net R |");
  lines.push("|------|--------|-----|----------|---------|------|--------|----------|-----|-------|");
  for (const r of perSymbolRows) {
    if (r.error) {
      lines.push(`| ${r.spec} | ${r.symbol} | — | — | — | — | — | — | — | error: ${r.error} |`);
    } else {
      lines.push(
        `| ${r.spec} | ${r.symbol} | ${r.rawSignals} | ${r.executed} | ${r.skipped} | ${r.wins} | ${r.losses} | ${r.timeouts} | ${(r.winRate * 100).toFixed(1)} | ${r.netR.toFixed(2)} |`
      );
    }
  }
  lines.push("");

  const errors = perSymbolRows.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push("## Errors");
    lines.push("");
    for (const e of errors) {
      lines.push(`- ${e.spec} / ${e.symbol}: ${e.error}`);
    }
    lines.push("");
  }

  fs.writeFileSync(path.join(outputDir, "summary.md"), lines.join("\n"), "utf8");
}

async function main() {
  const days = parseInt(process.argv[2] || "90", 10);
  const outputDir = process.argv[3] || path.join(__dirname, "..", "reports", `historical-pit-${days}d-${nowIso()}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`[run-pit-historical] days=${days} output=${outputDir}`);
  console.log(`[run-pit-historical] concurrency=${CONCURRENCY}\n`);

  const tasks = [];
  const taskMeta = [];
  for (const specId of SPECS) {
    const spec = loadSpec(specId);
    const symbols = spec.filters?.symbols || [];
    for (const symbol of symbols) {
      tasks.push(() => runTask(specId, symbol, days));
      taskMeta.push({ specId, symbol });
    }
  }

  console.log(`[run-pit-historical] ${tasks.length} spec/symbol combinations to run\n`);

  const started = Date.now();
  const results = await withConcurrency(tasks, CONCURRENCY);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  fs.writeFileSync(path.join(outputDir, "raw-results.json"), JSON.stringify(results, null, 2), "utf8");

  const perSymbolRows = results;
  const specAggregates = {};
  for (const specId of SPECS) {
    const specRows = perSymbolRows.filter((r) => r.spec === specId);
    specAggregates[specId] = computeAggregate(specRows);
  }

  writeCsv(outputDir, perSymbolRows, specAggregates);
  writeMarkdown(outputDir, days, perSymbolRows, specAggregates);

  console.log(`\n[run-pit-historical] Completed in ${elapsed}s`);
  console.log(`[run-pit-historical] Raw results: ${path.join(outputDir, "raw-results.json")}`);
  console.log(`[run-pit-historical] CSV summary: ${path.join(outputDir, "summary.csv")}`);
  console.log(`[run-pit-historical] MD summary:  ${path.join(outputDir, "summary.md")}`);
}

main().catch((e) => {
  console.error("[run-pit-historical] Fatal:", e);
  process.exit(1);
});
