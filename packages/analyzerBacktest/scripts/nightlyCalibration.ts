import { getPool } from "@tm/shared";
import type { TimeFrame } from "@tm/shared";
import { runBacktest } from "../src/runBacktest";
import { generateReport } from "../src/reportGenerator";

const DEFAULT_TFS: TimeFrame[] = ["15m", "1h", "4h"];
const DAYS = Number(process.env.BACKTEST_DAYS ?? "90");
const SYMBOLS = process.env.BACKTEST_SYMBOLS?.split(",").map((s) => s.trim().toUpperCase()) ?? [];
const TFS = (process.env.BACKTEST_TFS?.split(",").map((s) => s.trim()) as TimeFrame[]) ?? DEFAULT_TFS;
const CONCURRENCY = Number(process.env.BACKTEST_CONCURRENCY ?? "4");
const OOS_DAYS = Number(process.env.OOS_DAYS ?? "0");

interface Task {
  symbol: string;
  tf: TimeFrame;
}

async function fetchSymbols(pool: any): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT symbol FROM market.candles_1m_canonical WHERE ts > NOW() - INTERVAL '7 days' ORDER BY symbol`
    );
    return rows.map((r: any) => r.symbol);
  } catch (err: any) {
    console.warn("[nightlyCalibration] failed to fetch symbols:", err.message);
    return [];
  }
}

async function runWithConcurrency<T>(tasks: Task[], fn: (task: Task) => Promise<T>, concurrency: number): Promise<T[]> {
  const semaphore = new Semaphore(concurrency);
  return Promise.all(tasks.map((task) => semaphore.run(() => fn(task))));
}

class Semaphore {
  private running = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

async function main() {
  const pool = getPool();
  const symbols = SYMBOLS.length > 0 ? SYMBOLS : await fetchSymbols(pool);
  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - DAYS * 24 * 60 * 60 * 1000);

  // Optional out-of-sample window for validation.
  let oosStartTs: Date | undefined;
  let oosEndTs: Date | undefined;
  if (OOS_DAYS > 0) {
    oosStartTs = new Date(endTs.getTime() - OOS_DAYS * 24 * 60 * 60 * 1000);
    oosEndTs = endTs;
  }

  const tasks: Task[] = [];
  for (const symbol of symbols) {
    for (const tf of TFS) {
      tasks.push({ symbol, tf });
    }
  }

  console.log(
    `[nightlyCalibration] Running ${tasks.length} tasks (${symbols.length} symbols x ${TFS.length} TFs) with concurrency ${CONCURRENCY} from ${startTs.toISOString()}`
  );

  const results = await runWithConcurrency(tasks, async ({ symbol, tf }) => {
    try {
      const result = await runBacktest(pool, {
        symbol,
        tf,
        startTs,
        endTs: oosStartTs ?? endTs,
        activePositionCount: 0,
        backtestSpreadPips: 0.5,
        concurrency: 1,
        recordResults: true,
      });
      const report = generateReport(result.trades);
      const rr = report.riskReturn;

      const line = `[nightlyCalibration] ${symbol} ${tf}: samples=${result.samplesEvaluated} trades=${report.totalTrades} winRate=${(
        report.winRate * 100
      ).toFixed(1)}% avgR=${report.avgR.toFixed(2)} totalR=${report.totalR.toFixed(2)} pf=${rr.profitFactor.toFixed(
        2
      )} sharpe=${rr.sharpeRatio.toFixed(2)} maxDD=${rr.maxDrawdownR.toFixed(2)}R`;
      console.log(line);
      return { symbol, tf, success: true, report };
    } catch (err: any) {
      console.error(`[nightlyCalibration] ${symbol} ${tf} failed:`, err.message);
      return { symbol, tf, success: false, error: err.message };
    }
  }, CONCURRENCY);

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const totalTrades = successful.reduce((sum, r) => sum + (r.report?.totalTrades ?? 0), 0);
    const avgWinRate =
      successful.reduce((sum, r) => sum + (r.report?.winRate ?? 0), 0) / successful.length;
    const avgAvgR =
      successful.reduce((sum, r) => sum + (r.report?.avgR ?? 0), 0) / successful.length;
    const totalR = successful.reduce((sum, r) => sum + (r.report?.totalR ?? 0), 0);
    console.log(
      `[nightlyCalibration] Summary: ${successful.length} successful, ${failed.length} failed, totalTrades=${totalTrades}, avgWinRate=${(
        avgWinRate * 100
      ).toFixed(1)}%, avgAvgR=${avgAvgR.toFixed(2)}, totalR=${totalR.toFixed(2)}`
    );
  }

  if (OOS_DAYS > 0 && oosStartTs && oosEndTs) {
    console.log(
      `[nightlyCalibration] OOS window ${oosStartTs.toISOString()} to ${oosEndTs.toISOString()} reserved for validation. Run tuneFromCalibration with OOS_DAYS=${OOS_DAYS} after this completes.`
    );
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[nightlyCalibration] fatal:", err);
  process.exit(1);
});
