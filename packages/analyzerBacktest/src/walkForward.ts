import type { Pool, TimeFrame } from "@tm/shared";
import { runBacktest, type BacktestOptions, type BacktestRunResult } from "./runBacktest";
import { generateReport, type BacktestReport } from "./reportGenerator";

export interface WalkForwardWindow {
  trainStart: Date;
  trainEnd: Date;
  testStart: Date;
  testEnd: Date;
}

export interface WalkForwardOptions {
  symbol: string;
  tf: TimeFrame;
  startTs: Date;
  endTs: Date;
  trainDays: number;
  testDays: number;
  stepDays: number;
  baseBacktestOptions?: Partial<BacktestOptions>;
}

export interface WalkForwardResult {
  windows: {
    window: WalkForwardWindow;
    train: BacktestRunResult & { report: BacktestReport };
    test: BacktestRunResult & { report: BacktestReport };
  }[];
  aggregatedTest: BacktestReport;
}

function generateWindows(
  startTs: Date,
  endTs: Date,
  trainDays: number,
  testDays: number,
  stepDays: number
): WalkForwardWindow[] {
  const msPerDay = 24 * 60 * 60 * 1000;
  const windows: WalkForwardWindow[] = [];

  let trainStart = new Date(startTs.getTime());
  while (true) {
    const trainEnd = new Date(trainStart.getTime() + trainDays * msPerDay);
    const testStart = new Date(trainEnd.getTime());
    const testEnd = new Date(testStart.getTime() + testDays * msPerDay);

    if (testEnd > endTs) break;

    windows.push({ trainStart, trainEnd, testStart, testEnd });
    trainStart = new Date(trainStart.getTime() + stepDays * msPerDay);
  }

  return windows;
}

/**
 * Run a true walk-forward analysis: train (optimize/calibrate) on an in-sample
 * window, then test on the immediately following out-of-sample window.
 *
 * Note: this implementation re-runs the same setup-evaluation logic on both
 * windows. To make it a real optimizer, pass a `baseBacktestOptions` that
 * includes calibrated thresholds learned from the train window, or call an
 * external calibration routine between windows.
 */
export async function runWalkForward(
  pool: Pool,
  options: WalkForwardOptions
): Promise<WalkForwardResult> {
  const {
    symbol,
    tf,
    startTs,
    endTs,
    trainDays,
    testDays,
    stepDays,
    baseBacktestOptions = {},
  } = options;

  const windows = generateWindows(startTs, endTs, trainDays, testDays, stepDays);
  const results: WalkForwardResult["windows"] = [];

  for (const window of windows) {
    const trainResult = await runBacktest(pool, {
      symbol,
      tf,
      startTs: window.trainStart,
      endTs: window.trainEnd,
      ...baseBacktestOptions,
      recordResults: false,
    });
    const trainReport = generateReport(trainResult.trades);

    const testResult = await runBacktest(pool, {
      symbol,
      tf,
      startTs: window.testStart,
      endTs: window.testEnd,
      ...baseBacktestOptions,
      recordResults: false,
    });
    const testReport = generateReport(testResult.trades);

    results.push({
      window,
      train: { ...trainResult, report: trainReport },
      test: { ...testResult, report: testReport },
    });
  }

  const allTestTrades = results.flatMap((r) => r.test.trades);
  const aggregatedTest = generateReport(allTestTrades);

  return { windows: results, aggregatedTest };
}

export function formatWalkForwardSummary(result: WalkForwardResult): string {
  const lines = [
    `Walk-forward windows: ${result.windows.length}`,
    `Aggregated OOS trades: ${result.aggregatedTest.totalTrades}`,
    `Aggregated OOS win rate: ${(result.aggregatedTest.winRate * 100).toFixed(1)}%`,
    `Aggregated OOS avg R: ${result.aggregatedTest.avgR.toFixed(2)}`,
    `Aggregated OOS total R: ${result.aggregatedTest.totalR.toFixed(2)}`,
    `Aggregated OOS profit factor: ${result.aggregatedTest.riskReturn.profitFactor.toFixed(2)}`,
  ];

  for (const r of result.windows) {
    const w = r.window;
    lines.push(
      `  ${w.trainStart.toISOString().slice(0, 10)} → ${w.testEnd.toISOString().slice(0, 10)} | ` +
        `train ${r.train.report.totalTrades}t ${(r.train.report.winRate * 100).toFixed(1)}% | ` +
        `test ${r.test.report.totalTrades}t ${(r.test.report.winRate * 100).toFixed(1)}%`
    );
  }

  return lines.join("\n");
}
