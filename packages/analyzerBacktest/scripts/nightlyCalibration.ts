import { getPool } from "@tm/shared";
import type { TimeFrame } from "@tm/shared";
import { runBacktest } from "../src/runBacktest";
import { generateReport } from "../src/reportGenerator";

const DEFAULT_TFS: TimeFrame[] = ["15m", "1h", "4h"];
const DAYS = Number(process.env.BACKTEST_DAYS ?? "90");
const SYMBOLS = process.env.BACKTEST_SYMBOLS?.split(",").map((s) => s.trim().toUpperCase()) ?? [];
const TFS = (process.env.BACKTEST_TFS?.split(",").map((s) => s.trim()) as TimeFrame[]) ?? DEFAULT_TFS;

async function fetchSymbols(pool: any): Promise<string[]> {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT symbol FROM candles_1m WHERE ts > NOW() - INTERVAL '7 days' ORDER BY symbol`
    );
    return rows.map((r: any) => r.symbol);
  } catch (err: any) {
    console.warn("[nightlyCalibration] failed to fetch symbols:", err.message);
    return [];
  }
}

async function main() {
  const pool = getPool();
  const symbols = SYMBOLS.length > 0 ? SYMBOLS : await fetchSymbols(pool);
  const endTs = new Date();
  const startTs = new Date(endTs.getTime() - DAYS * 24 * 60 * 60 * 1000);

  console.log(`[nightlyCalibration] Running ${symbols.length} symbols x ${TFS.length} TFs from ${startTs.toISOString()}`);

  for (const symbol of symbols) {
    for (const tf of TFS) {
      try {
        const result = await runBacktest(pool, {
          symbol,
          tf,
          startTs,
          endTs,
          activePositionCount: 0,
          backtestSpreadPips: 0.5,
          recordResults: true,
        });
        const report = generateReport(result.trades);
        console.log(
          `[nightlyCalibration] ${symbol} ${tf}: samples=${result.samplesEvaluated} trades=${report.totalTrades} winRate=${(report.winRate * 100).toFixed(1)}% avgR=${report.avgR.toFixed(2)}`
        );
      } catch (err: any) {
        console.error(`[nightlyCalibration] ${symbol} ${tf} failed:`, err.message);
      }
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("[nightlyCalibration] fatal:", err);
  process.exit(1);
});
