import { getPool, closePool, type TimeFrame } from "@tm/shared";

const MIN_TRADES_FOR_TUNE = Number(process.env.MIN_TRADES_FOR_TUNE ?? "10");
const BACKTEST_DAYS = Number(process.env.BACKTEST_DAYS ?? "30");

interface GradeMetrics {
  symbol: string;
  tf: TimeFrame;
  grade: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  expectancy: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function recommendDeltas(metrics: GradeMetrics): {
  weightDelta: number;
  thresholdDelta: number;
  recommendation: string;
} {
  const { avgR, winRate, trades } = metrics;

  if (trades < MIN_TRADES_FOR_TUNE) {
    return {
      weightDelta: 0,
      thresholdDelta: 0,
      recommendation: `Insufficient samples (${trades}); no change.`,
    };
  }

  if (avgR < 0) {
    // Grade is losing money → make it harder to achieve.
    const delta = clamp(Math.ceil(Math.abs(avgR) * 50), 2, 20);
    return {
      weightDelta: -clamp(Math.ceil(Math.abs(avgR) * 10), 1, 10),
      thresholdDelta: delta,
      recommendation: `Losing grade (avgR ${avgR.toFixed(2)}); raise threshold by ${delta} points.`,
    };
  }

  if (avgR > 0.5 && winRate > 0.5) {
    // Grade is strong → make it slightly easier to capture more edge.
    const delta = clamp(Math.floor(avgR * 5), 2, 10);
    return {
      weightDelta: clamp(Math.floor(avgR * 3), 1, 5),
      thresholdDelta: -delta,
      recommendation: `Strong grade (avgR ${avgR.toFixed(2)}, WR ${(winRate * 100).toFixed(1)}%); lower threshold by ${delta} points.`,
    };
  }

  return {
    weightDelta: 0,
    thresholdDelta: 0,
    recommendation: `Marginal grade (avgR ${avgR.toFixed(2)}, WR ${(winRate * 100).toFixed(1)}%); leave unchanged.`,
  };
}

async function aggregateLatestBacktest(pool: any): Promise<GradeMetrics[]> {
  const since = new Date(Date.now() - BACKTEST_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `SELECT symbol, tf, grade,
            COUNT(*) AS trades,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
            AVG(outcome_r) AS avg_r
       FROM backtest_results
      WHERE ts >= $1
      GROUP BY symbol, tf, grade`,
    [since]
  );

  return rows.map((r: any) => {
    const trades = Number(r.trades ?? 0);
    const wins = Number(r.wins ?? 0);
    const losses = Number(r.losses ?? 0);
    const avgR = Number(r.avg_r ?? 0);
    const winRate = trades > 0 ? wins / trades : 0;
    const expectancy = winRate * avgR - (1 - winRate) * Math.abs(avgR);
    return {
      symbol: r.symbol,
      tf: r.tf,
      grade: r.grade,
      trades,
      wins,
      losses,
      winRate,
      avgR,
      expectancy,
    };
  });
}

async function persistTuning(pool: any, metrics: GradeMetrics[]): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const m of metrics) {
      const rec = recommendDeltas(m);
      await client.query(
        `INSERT INTO calibration_tuning (
          symbol, tf, grade, avg_r, sample_count, recommendation,
          weight_delta, threshold_delta, win_rate, expectancy, min_trades, tuned_at, applied_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NULL)
        ON CONFLICT (symbol, tf, grade) DO UPDATE SET
          avg_r = EXCLUDED.avg_r,
          sample_count = EXCLUDED.sample_count,
          recommendation = EXCLUDED.recommendation,
          weight_delta = EXCLUDED.weight_delta,
          threshold_delta = EXCLUDED.threshold_delta,
          win_rate = EXCLUDED.win_rate,
          expectancy = EXCLUDED.expectancy,
          min_trades = EXCLUDED.min_trades,
          tuned_at = NOW(),
          applied_at = NULL`,
        [
          m.symbol,
          m.tf,
          m.grade,
          m.avgR,
          m.trades,
          rec.recommendation,
          rec.weightDelta,
          rec.thresholdDelta,
          m.winRate,
          m.expectancy,
          m.trades,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const pool = getPool();
  console.log(`[tuneFromCalibration] Aggregating backtest_results last ${BACKTEST_DAYS} days...`);
  const metrics = await aggregateLatestBacktest(pool);
  console.log(`[tuneFromCalibration] Found ${metrics.length} symbol/tf/grade buckets.`);

  if (metrics.length > 0) {
    await persistTuning(pool, metrics);
    for (const m of metrics) {
      const rec = recommendDeltas(m);
      console.log(
        `[tuneFromCalibration] ${m.symbol} ${m.tf} ${m.grade}: trades=${m.trades} winRate=${(m.winRate * 100).toFixed(1)}% avgR=${m.avgR.toFixed(2)} → thresholdDelta=${rec.thresholdDelta} weightDelta=${rec.weightDelta}`
      );
    }
  }

  await closePool();
}

main().catch((err) => {
  console.error("[tuneFromCalibration] fatal:", err);
  process.exit(1);
});
