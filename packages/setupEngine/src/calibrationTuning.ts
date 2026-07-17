import type { Queryable, TimeFrame } from "@tm/shared";
import type { SetupGrade } from "./types";

export interface TuningRow {
  symbol: string;
  tf: TimeFrame;
  grade: SetupGrade;
  weightDelta: number;
  thresholdDelta: number;
  winRate: number | null;
  avgR: number | null;
  expectancy: number | null;
  minTrades: number;
  tunedAt: Date;
  appliedAt: Date | null;
}

interface CacheEntry {
  rows: TuningRow[];
  fetchedAt: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function cacheKey(symbol: string, tf: TimeFrame): string {
  return `${symbol}:${tf}`;
}

export async function getCalibrationTuning(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame
): Promise<TuningRow[]> {
  const key = cacheKey(symbol, tf);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    return cached.rows;
  }

  const result = await pool.query(
    `SELECT symbol, tf, grade, weight_delta, threshold_delta,
            win_rate, avg_r, expectancy, min_trades, tuned_at, applied_at
       FROM calibration_tuning
      WHERE symbol = $1 AND tf = $2
      ORDER BY grade`,
    [symbol, tf]
  );

  const rows: TuningRow[] = result.rows.map((r) => ({
    symbol: r.symbol,
    tf: r.tf,
    grade: r.grade,
    weightDelta: Number(r.weight_delta ?? 0),
    thresholdDelta: Number(r.threshold_delta ?? 0),
    winRate: r.win_rate == null ? null : Number(r.win_rate),
    avgR: r.avg_r == null ? null : Number(r.avg_r),
    expectancy: r.expectancy == null ? null : Number(r.expectancy),
    minTrades: Number(r.min_trades ?? 0),
    tunedAt: r.tuned_at,
    appliedAt: r.applied_at,
  }));

  cache.set(key, { rows, fetchedAt: now });
  return rows;
}

export function clearTuningCache(): void {
  cache.clear();
}
