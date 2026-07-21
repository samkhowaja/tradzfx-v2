#!/usr/bin/env node
/** Frozen dual-policy replay over research-mode simulated candidates. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function pct(n, d) { return d ? `${(100 * n / d).toFixed(2)}%` : "0.00%"; }
function stats(rows) {
  const decisive = rows.filter(r => r.outcome === "win" || r.outcome === "loss");
  const wins = decisive.filter(r => r.outcome === "win").length;
  const netR = decisive.reduce((sum, r) => sum + Number(r.r || 0), 0);
  return { n: rows.length, decisive: decisive.length, wins, winRate: decisive.length ? wins / decisive.length : 0, netR };
}
function mdRow(name, value) { return `| ${name} | ${value.n} | ${value.decisive} | ${value.wins} | ${pct(value.wins,value.decisive)} | ${value.netR.toFixed(2)} |`; }

async function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const days = Number(process.argv[3] || 90);
  const strategy = process.argv[4] || "watukushay_no1";
  const tf = process.argv[5] || "5m";
  const period = Number(process.argv[6] || 5);
  const setupProfile = process.argv[7] || "strict";
  if (!new Set(["strict", "lenient", "skip"]).has(setupProfile)) throw new Error(`Invalid setup profile: ${setupProfile}`);
  const outputPath = process.argv[8] || path.resolve("reports", `VOLATILITY_SHADOW_REPLAY_FULL_${strategy}_${symbol}_${days}d_2026-07-19.md`);
  const run = spawnSync(process.execPath, [path.resolve(__dirname, "backtest-pit-v2.js"), symbol, String(days), strategy, "--mode=shadow", `--setup-profile=${setupProfile}`, "--json", "--trades"], {
    cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`backtest failed (${run.status}): ${run.stderr.slice(-4000)}`);
  const jsonLines = run.stdout.trim().split(/\r?\n/).filter(line => line.trimStart().startsWith("{"));
  const result = jsonLines.map(line => JSON.parse(line)).find(row => row.symbol === symbol);
  if (!result) throw new Error(`No JSON result for ${symbol}`);

  const pool = new Pool({ host: process.env.TM_DB_HOST || "localhost", port: Number(process.env.TM_DB_PORT || 5432), database: process.env.TM_DB_NAME || "tradzfx_v2", user: process.env.TM_DB_USER || "postgres", password: process.env.TM_DB_PASSWORD, max: 2 });
  const trades = result.trades || [];
  const timestamps = trades.map(t => t.ts);
  const { rows: features } = timestamps.length ? await pool.query(
    `WITH profile AS (
       SELECT DISTINCT ON (session) session, p95 FROM market_volatility_profile
       WHERE symbol=$1 AND tf=$2 AND period=$3 ORDER BY session, lookback_days DESC
     )
     SELECT v.ts, v.session, v.atr_pips, v.percentile_rank, v.is_valid, p.p95
       FROM features_volatility_normalized v LEFT JOIN profile p USING(session)
      WHERE v.symbol=$1 AND v.tf=$2 AND v.period=$3 AND v.ts = ANY($4::timestamptz[])`,
    [symbol, tf, period, timestamps]
  ) : { rows: [] };
  await pool.end();
  const byTs = new Map(features.map(row => [new Date(row.ts).toISOString(), row]));
  const joined = trades.map(trade => ({ ...trade, feature: byTs.get(new Date(trade.ts).toISOString()) })).filter(row => row.feature?.is_valid && row.feature.p95 != null && row.feature.percentile_rank != null);
  for (const row of joined) {
    row.controlPass = Number(row.feature.atr_pips) <= Number(row.feature.p95);
    row.shadowPass = Number(row.feature.percentile_rank) <= 0.95;
  }
  const cohorts = {
    all: stats(joined), bothPass: stats(joined.filter(r => r.controlPass && r.shadowPass)),
    controlOnly: stats(joined.filter(r => r.controlPass && !r.shadowPass)), shadowOnly: stats(joined.filter(r => !r.controlPass && r.shadowPass)),
    bothBlock: stats(joined.filter(r => !r.controlPass && !r.shadowPass)), controlPolicy: stats(joined.filter(r => r.controlPass)), shadowPolicy: stats(joined.filter(r => r.shadowPass)),
  };
  const ordered = joined.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const foldSize = Math.ceil(ordered.length / 3);
  const folds = [0, 1, 2].map(index => {
    const rows = ordered.slice(index * foldSize, Math.min((index + 1) * foldSize, ordered.length));
    return {
      index: index + 1,
      start: rows[0]?.ts,
      end: rows[rows.length - 1]?.ts,
      control: stats(rows.filter(row => row.controlPass)),
      shadow: stats(rows.filter(row => row.shadowPass)),
    };
  }).filter(fold => fold.control.n || fold.shadow.n);
  const lines = [
    `# Frozen Volatility Shadow Replay — ${strategy} / ${symbol}`, "", `**Generated:** ${new Date().toISOString()}`, `**Window:** trailing ${days} days`,
    `**Backtest mode:** shadow`, `**Intrabar:** ${result.intrabarMode}`, `**Setup profile:** ${result.setupProfile}`, "",
    "## Contract", "", "Shadow mode simulates candidates with normal spread, slippage, and commission but does not enforce gate rejection. Same simulated outcome is then classified under frozen control and shadow volatility decisions. No live behavior changed and no counterfactual result or setup evaluation is persisted.", "",
    setupProfile === "strict"
      ? "Setup-engine grading remains active. BLOCK candidates are removed before dual-policy classification, matching full setup filtering while isolating volatility policy. Unresolved timeouts are absent from decisive trade cohorts."
      : `Setup-engine profile is ${setupProfile}; evidence does not represent strict full-pipeline filtering. Unresolved timeouts are absent from decisive trade cohorts.`, "",
    "## Coverage", "", `Raw signals: ${result.rawSignals}. Shadow trades returned: ${trades.length}. Exact normalized-feature joins: ${joined.length}.`, "",
    "## Cohort economics", "", "| Cohort | Candidates | Decisive | Wins | Win rate | Net R |", "|---|---:|---:|---:|---:|---:|",
    mdRow("All joined", cohorts.all), mdRow("Both pass", cohorts.bothPass), mdRow("Control only", cohorts.controlOnly), mdRow("Shadow only", cohorts.shadowOnly), mdRow("Both block", cohorts.bothBlock),
    mdRow("Control policy", cohorts.controlPolicy), mdRow("Shadow policy", cohorts.shadowPolicy), "",
    "## Chronological test folds", "",
    "Threshold and 1,000-observation causal window remain frozen across three equal-count chronological folds. No fold-specific tuning occurs.", "",
    "| Fold | Start | End | Control N | Control Net R | Shadow N | Shadow Net R | Shadow minus control |",
    "|---:|---|---|---:|---:|---:|---:|---:|",
    ...folds.map(fold => `| ${fold.index} | ${fold.start} | ${fold.end} | ${fold.control.n} | ${fold.control.netR.toFixed(2)} | ${fold.shadow.n} | ${fold.shadow.netR.toFixed(2)} | ${(fold.shadow.netR - fold.control.netR).toFixed(2)} |`), "",
    "## Promotion status", "", setupProfile === "strict"
      ? "**NOT READY.** Chronological folds use frozen policy, normal modeled costs, and strict setup grading, but evidence covers one strategy/symbol. Require multi-strategy and multi-symbol evidence before promotion."
      : "**NOT READY.** Setup grading is not strict and evidence covers one strategy/symbol. Require strict full-pipeline OOS replay and broader evidence before promotion.", "",
  ];
  fs.mkdirSync(path.dirname(outputPath), { recursive: true }); fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(JSON.stringify({ outputPath, setupProfile: result.setupProfile, rawSignals: result.rawSignals, returnedTrades: trades.length, joined: joined.length, cohorts, folds }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error); process.exit(1); });
module.exports = { stats };
