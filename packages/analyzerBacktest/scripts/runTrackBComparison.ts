/**
 * Track B Backtest Comparison Script
 *
 * Compares current code against baseline reports to measure the impact
 * of Track B changes:
 *   - D013: Retest zones (entryQuality.ts)
 *   - HTF bias reweighting (htfBias.ts v3.2.0)
 *   - TF-dependent pivot lookback (pivot.ts v1.2.0)
 *   - TF-dependent FVG/iFVG max_age (ifvg.ts v1.4.0, fvg.ts v1.1.0)
 *   - Zone lifecycle touch/retest counts (zone.ts v2.2.0)
 *   - Balance-based dynamic lot sizing (orderExecutor.ts)
 *
 * Usage: pnpm tsx scripts/runTrackBComparison.ts [symbol] [days]
 *   symbol  - single symbol (default: all key symbols)
 *   days    - lookback days (default: 60)
 *
 * Baseline reports are loaded from reports/*.json
 */

import { getPool, closePool, type TimeFrame } from "@tm/shared";
import { runBacktest, generateReport } from "../src";
import * as fs from "fs";
import * as path from "path";

const REPORTS_DIR = path.resolve(__dirname, "../../../reports");

interface BaselineReport {
  spec: string;
  symbol: string;
  days: number;
  rawSignals: number;
  executed: number;
  wins: number;
  losses: number;
  winRate: number;
  netR: number;
  avgWinR: number;
  avgR: number;
  profitFactor: number;
  expectancy: number;
}

interface ComparisonResult {
  symbol: string;
  tf: TimeFrame;
  days: number;
  baseline: BaselineReport | null;
  current: {
    samplesEvaluated: number;
    executed: number;
    wins: number;
    losses: number;
    winRate: number;
    netR: number;
    avgWinR: number;
    avgR: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdownR: number;
  } | null;
  delta: {
    winRate: number;
    netR: number;
    avgR: number;
    profitFactor: number;
    expectancy: number;
  } | null;
}

function loadBaseline(symbol: string, days: number): BaselineReport | null {
  // Try to find a matching baseline report
  const files = fs.readdirSync(REPORTS_DIR).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(REPORTS_DIR, file), "utf-8");
      const report: BaselineReport = JSON.parse(content);
      if (
        report.symbol?.toUpperCase() === symbol.toUpperCase() &&
        report.days === days
      ) {
        return report;
      }
    } catch {
      // skip invalid files
    }
  }
  return null;
}

async function runComparison(
  pool: ReturnType<typeof getPool>,
  symbol: string,
  tf: TimeFrame,
  days: number
): Promise<ComparisonResult> {
  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - days * 24 * 60 * 60 * 1000);

  const baseline = loadBaseline(symbol, days);

  const result = await runBacktest(pool, {
    symbol,
    tf,
    startTs,
    endTs,
    backtestSpreadPips: 0.5,
    backtestSlippagePips: 0.2,
    concurrency: 1,
    recordResults: false,
    includeEquityCurve: false,
  });

  const report = generateReport(result.trades);
  const rr = report.riskReturn;
  const completed = result.trades.filter(
    (t) => t.outcome === "win" || t.outcome === "loss"
  );
  const wins = completed.filter((t) => t.outcome === "win").length;
  const losses = completed.filter((t) => t.outcome === "loss").length;

  const current = {
    samplesEvaluated: result.samplesEvaluated,
    executed: report.totalTrades,
    wins,
    losses,
    winRate: report.winRate,
    netR: report.totalR,
    avgWinR: rr.avgWinR,
    avgR: report.avgR,
    profitFactor: rr.profitFactor,
    expectancy: rr.expectancy,
    maxDrawdownR: rr.maxDrawdownR,
  };

  const delta = baseline
    ? {
        winRate: report.winRate - baseline.winRate,
        netR: report.totalR - baseline.netR,
        avgR: report.avgR - (baseline.avgR ?? 0),
        profitFactor: rr.profitFactor - (baseline.profitFactor ?? 0),
        expectancy: rr.expectancy - (baseline.expectancy ?? 0),
      }
    : null;

  return { symbol, tf, days, baseline, current, delta };
}

function formatDelta(val: number, suffix = ""): string {
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(3)}${suffix}`;
}

function printResult(r: ComparisonResult): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${r.symbol} ${r.tf}  ${r.days}d backtest`);
  console.log(`${"=".repeat(70)}`);

  if (!r.current) {
    console.log("  [ERROR] No results returned");
    return;
  }

  console.log(
    `  Samples evaluated : ${r.current.samplesEvaluated.toLocaleString()}`
  );
  console.log(`  Trades executed   : ${r.current.executed}`);
  console.log(`  Wins / Losses     : ${r.current.wins} / ${r.current.losses}`);
  console.log(
    `  Win rate          : ${(r.current.winRate * 100).toFixed(1)}%`
  );
  if (r.delta && r.baseline) {
    console.log(
      `  Win rate Δ        : ${formatDelta(r.delta.winRate * 100, "%")}  (baseline: ${(r.baseline.winRate * 100).toFixed(1)}%)`
    );
  }
  console.log(`  Avg R             : ${r.current.avgR.toFixed(3)}`);
  if (r.delta && r.baseline) {
    console.log(
      `  Avg R Δ           : ${formatDelta(r.delta.avgR)}  (baseline: ${r.baseline.avgR.toFixed(3)})`
    );
  }
  console.log(`  Net R             : ${r.current.netR.toFixed(3)}`);
  if (r.delta && r.baseline) {
    console.log(
      `  Net R Δ           : ${formatDelta(r.delta.netR)}  (baseline: ${r.baseline.netR.toFixed(3)})`
    );
  }
  console.log(`  Profit factor     : ${r.current.profitFactor.toFixed(3)}`);
  if (r.delta && r.baseline) {
    console.log(
      `  PF Δ              : ${formatDelta(r.delta.profitFactor)}  (baseline: ${r.baseline.profitFactor.toFixed(3)})`
    );
  }
  console.log(`  Expectancy        : ${r.current.expectancy.toFixed(3)}`);
  if (r.delta && r.baseline) {
    console.log(
      `  Expectancy Δ      : ${formatDelta(r.delta.expectancy)}  (baseline: ${r.baseline.expectancy.toFixed(3)})`
    );
  }
  console.log(
    `  Max drawdown       : ${r.current.maxDrawdownR.toFixed(3)}R`
  );
}

async function main() {
  const symbolArg = process.argv[2]?.toUpperCase();
  const days = Number(process.argv[3] ?? "60");
  const tf: TimeFrame = "15m";

  // Key symbols for comparison
  const symbols = symbolArg
    ? [symbolArg]
    : ["EURUSD", "XAUUSD", "GBPUSD", "USDJPY", "AUDUSD"];

  console.log(`\nTrack B Backtest Comparison`);
  console.log(`==========================`);
  console.log(`Date: ${new Date().toISOString().split("T")[0]}`);
  console.log(`Days: ${days}d`);
  console.log(`Symbols: ${symbols.join(", ")}`);
  console.log(`\nBaseline: reports/*.json (pre-Track-B reports)`);

  const results: ComparisonResult[] = [];

  const pool = getPool();
  for (const sym of symbols) {
    try {
      const result = await runComparison(pool, sym, tf, days);
      results.push(result);
      printResult(result);
    } catch (err) {
      console.error(`\n[ERROR] ${sym}: ${err}`);
    }
  }

  // Summary table
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  SUMMARY TABLE`);
  console.log(`${"=".repeat(70)}`);
  console.log(
    `  ${"Symbol".padEnd(10)} ${"Exec".padStart(4)} ${"WR%".padStart(6)} ${"ΔWR%".padStart(6)} ${"NetR".padStart(7)} ${"ΔNetR".padStart(7)} ${"AvgR".padStart(6)} ${"ΔAvgR".padStart(6)}`
  );
  console.log(`  ${"".padEnd(10)} ${"".padStart(4)} ${"".padStart(6)} ${"".padStart(6)} ${"".padStart(7)} ${"".padStart(7)} ${"".padStart(6)} ${"".padStart(6)}`);

  for (const r of results) {
    if (!r.current) continue;
    const wr = (r.current.winRate * 100).toFixed(1);
    const deltaWr = r.delta ? formatDelta(r.delta.winRate * 100, "%") : "  n/a";
    const netR = r.current.netR.toFixed(1);
    const deltaNetR = r.delta ? formatDelta(r.delta.netR) : "   n/a";
    const avgR = r.current.avgR.toFixed(2);
    const deltaAvgR = r.delta ? formatDelta(r.delta.avgR) : "  n/a";
    console.log(
      `  ${r.symbol.padEnd(10)} ${String(r.current.executed).padStart(4)} ${wr.padStart(6)} ${deltaWr.padStart(6)} ${netR.padStart(7)} ${deltaNetR.padStart(7)} ${avgR.padStart(6)} ${deltaAvgR.padStart(6)}`
    );
  }

  console.log(`\n  Note: Δ = current - baseline (positive = improvement)`);
  console.log(`  Baseline = reports/*.json generated before Track B changes\n`);

  await closePool();
}

main().catch(console.error);