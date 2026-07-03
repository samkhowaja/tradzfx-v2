import { getPool, closePool, type TimeFrame } from "@tm/shared";
import { runBacktest, generateReport, runMonteCarlo, formatMonteCarloResult } from "../src";

const symbol = process.argv[2]?.toUpperCase() ?? "EURUSD";
const tf = (process.argv[3] ?? "15m") as TimeFrame;
const days = Number(process.argv[4] ?? "30");
const spreadPips = Number(process.argv[5] ?? "0.5");

async function main() {
  const pool = getPool();
  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - days * 24 * 60 * 60 * 1000);

  console.log(`[runBacktestWithReport] ${symbol} ${tf} ${days}d spread=${spreadPips}pips`);

  const result = await runBacktest(pool, {
    symbol,
    tf,
    startTs,
    endTs,
    backtestSpreadPips: spreadPips,
    backtestSlippagePips: 0.2,
    concurrency: 1,
    recordResults: true,
    includeEquityCurve: true,
  });

  const report = generateReport(result.trades);
  const rr = report.riskReturn;

  console.log("\n=== Backtest Report ===");
  console.log(`Samples evaluated: ${result.samplesEvaluated}`);
  console.log(`Completed trades:  ${report.totalTrades}`);
  console.log(`Win rate:          ${(report.winRate * 100).toFixed(1)}%`);
  console.log(`Average R:         ${report.avgR.toFixed(2)}`);
  console.log(`Total R:           ${report.totalR.toFixed(2)}`);
  console.log(`Profit factor:     ${rr.profitFactor.toFixed(2)}`);
  console.log(`Expectancy:        ${rr.expectancy.toFixed(2)}`);
  console.log(`Payoff ratio:      ${rr.payoffRatio.toFixed(2)}`);
  console.log(`Max drawdown:      ${rr.maxDrawdownR.toFixed(2)}R`);
  console.log(`Sharpe ratio:      ${rr.sharpeRatio.toFixed(2)}`);
  console.log(`Sortino ratio:     ${rr.sortinoRatio.toFixed(2)}`);
  console.log(`Calmar ratio:      ${rr.calmarRatio.toFixed(2)}`);
  console.log(`Win streak:        ${rr.streaks.maxWinStreak}`);
  console.log(`Loss streak:       ${rr.streaks.maxLossStreak}`);
  console.log(
    `Win-rate 95% CI:   [${(rr.winRateConfidence.lower * 100).toFixed(1)}%, ${(
      rr.winRateConfidence.upper * 100
    ).toFixed(1)}%]`
  );

  if (result.trades.length >= 10) {
    console.log("\n=== Monte Carlo (10k iterations) ===");
    const mc = runMonteCarlo(result.trades, { iterations: 10_000, confidence: 0.95, blockSize: 1 });
    console.log(formatMonteCarloResult(mc));
  }

  await closePool();
}

main().catch((err) => {
  console.error("[runBacktestWithReport] fatal:", err);
  process.exit(1);
});
