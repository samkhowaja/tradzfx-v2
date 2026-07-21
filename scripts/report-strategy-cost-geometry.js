#!/usr/bin/env node
/** Cost and payoff-geometry attribution over strict, gate-observed PIT candidates. */
require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env.local") });
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { getPairCharacteristics, getSession } = require("../packages/shared/dist/index.js");

function pct(n, d) { return d ? `${(100 * n / d).toFixed(2)}%` : "0.00%"; }
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function summarize(rows) {
  const decisive = rows.filter(row => row.outcome === "win" || row.outcome === "loss");
  const wins = decisive.filter(row => row.outcome === "win").length;
  const grossR = decisive.reduce((sum, row) => sum + row.grossR, 0);
  const netR = decisive.reduce((sum, row) => sum + row.netR, 0);
  return {
    n: decisive.length,
    wins,
    winRate: decisive.length ? wins / decisive.length : 0,
    grossR,
    netR,
    costDragR: grossR - netR,
    medianStopPips: median(decisive.map(row => row.stopPips)),
    medianPlannedRR: median(decisive.map(row => row.plannedRR)),
    medianCostR: median(decisive.map(row => row.costDragR)),
  };
}
function row(label, value) {
  return `| ${label} | ${value.n} | ${pct(value.wins, value.n)} | ${value.grossR.toFixed(2)} | ${value.costDragR.toFixed(2)} | ${value.netR.toFixed(2)} | ${value.medianStopPips.toFixed(2)} | ${value.medianPlannedRR.toFixed(2)} |`;
}
function grouped(rows, keyFn) {
  const groups = new Map();
  for (const item of rows) {
    const key = keyFn(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return [...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, values]) => [key, summarize(values)]);
}
function stopBucket(stopPips) {
  if (stopPips < 5) return "<5p";
  if (stopPips < 10) return "5–<10p";
  if (stopPips < 20) return "10–<20p";
  if (stopPips < 40) return "20–<40p";
  return "40p+";
}

function main() {
  const symbol = (process.argv[2] || "XAUUSD").toUpperCase();
  const days = Number(process.argv[3] || 90);
  const strategy = process.argv[4] || "watukushay_no1";
  const outputPath = process.argv[5] || path.resolve("reports", `COST_GEOMETRY_${strategy}_${symbol}_${days}d_2026-07-19.md`);
  const run = spawnSync(process.execPath, [path.resolve(__dirname, "backtest-pit-v2.js"), symbol, String(days), strategy, "--mode=shadow", "--setup-profile=strict", "--json", "--trades"], {
    cwd: path.resolve(__dirname, ".."), env: process.env, encoding: "utf8", maxBuffer: 50 * 1024 * 1024,
  });
  if (run.status !== 0) throw new Error(`backtest failed (${run.status}): ${run.stderr.slice(-4000)}`);
  const result = run.stdout.trim().split(/\r?\n/).filter(line => line.trimStart().startsWith("{")).map(line => JSON.parse(line)).find(item => item.symbol === symbol);
  if (!result) throw new Error(`No JSON result for ${symbol}`);

  const pipSize = getPairCharacteristics(symbol).pipSize;
  const trades = (result.trades || []).filter(trade => trade.outcome === "win" || trade.outcome === "loss").map(trade => {
    const entry = Number(trade.entry);
    const stop = Number(trade.stopLoss);
    const target = Number(trade.takeProfit);
    const risk = Math.abs(entry - stop);
    const reward = Math.abs(target - entry);
    const plannedRR = risk > 0 ? reward / risk : 0;
    const grossR = trade.outcome === "win" ? plannedRR : -1;
    const netR = Number(trade.r || 0);
    const ts = new Date(trade.ts);
    return {
      ...trade,
      grossR,
      netR,
      costDragR: grossR - netR,
      stopPips: pipSize > 0 ? risk / pipSize : 0,
      plannedRR,
      session: getSession(ts.getUTCHours()),
      month: ts.toISOString().slice(0, 7),
    };
  });

  const overall = summarize(trades);
  const breakevenWinRate = overall.medianPlannedRR > 0 ? 1 / (1 + overall.medianPlannedRR) : 0;
  const sections = [
    ["Direction", grouped(trades, trade => trade.side)],
    ["Session", grouped(trades, trade => trade.session)],
    ["Month", grouped(trades, trade => trade.month)],
    ["Stop-width bucket", grouped(trades, trade => stopBucket(trade.stopPips))],
  ];
  const lines = [
    `# Cost and Payoff Geometry — ${strategy} / ${symbol}`, "",
    `**Generated:** ${new Date().toISOString()}`,
    `**Window:** trailing ${days} days`,
    `**Mode:** shadow with strict setup grading, normal modeled costs, gate rejection observed but not enforced`, "",
    "## Method", "",
    "Every decisive trade exits at authored TP or SL. Gross R therefore equals planned reward/risk for wins and -1R for losses. Cost drag equals gross R minus simulator net R and includes modeled entry/exit spread, slippage, and commission effects. This is attribution, not a second simulation.", "",
    "## Overall", "",
    "| Trades | Win rate | Gross R | Cost drag | Net R | Median stop | Median planned RR | Median cost drag/trade |",
    "|---:|---:|---:|---:|---:|---:|---:|---:|",
    `| ${overall.n} | ${pct(overall.wins, overall.n)} | ${overall.grossR.toFixed(2)} | ${overall.costDragR.toFixed(2)} | ${overall.netR.toFixed(2)} | ${overall.medianStopPips.toFixed(2)}p | ${overall.medianPlannedRR.toFixed(2)} | ${overall.medianCostR.toFixed(3)}R |`, "",
    `Median-RR gross breakeven win rate: ${pct(breakevenWinRate, 1)}. Observed win rate: ${pct(overall.wins, overall.n)}.`, "",
  ];
  for (const [title, groups] of sections) {
    lines.push(`## ${title}`, "", "| Group | Trades | Win rate | Gross R | Cost drag | Net R | Median stop pips | Median planned RR |", "|---|---:|---:|---:|---:|---:|---:|---:|", ...groups.map(([label, value]) => row(label, value)), "");
  }
  lines.push("## Viability rule", "", overall.netR > 0
    ? "**COST-VIABLE IN THIS WINDOW.** Require chronological and execution-assumption sensitivity before promotion."
    : "**NOT COST-VIABLE IN THIS WINDOW.** Do not add filters first. Validate broker cost assumptions and stop geometry; pause strategy if realistic-cost sensitivity remains negative.", "");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join("\n"));
  console.log(JSON.stringify({ outputPath, overall, groups: Object.fromEntries(sections.map(([title, values]) => [title, Object.fromEntries(values)])) }, null, 2));
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error); process.exit(1); }
}
module.exports = { median, summarize, stopBucket };
