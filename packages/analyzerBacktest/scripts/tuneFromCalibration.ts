import { getPool, closePool, type TimeFrame } from "@tm/shared";

const MIN_TRADES_FOR_TUNE = Number(process.env.MIN_TRADES_FOR_TUNE ?? "30");
const BACKTEST_DAYS = Number(process.env.BACKTEST_DAYS ?? "30");
const OOS_DAYS = Number(process.env.OOS_DAYS ?? "0");
const MIN_WIN_RATE_Z = Number(process.env.MIN_WIN_RATE_Z ?? "1.0");
const MAX_DRAWDOWN_R = Number(process.env.MAX_DRAWDOWN_R ?? "0");

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
  maxDrawdownR: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function normalCdf(x: number): number {
  const b1 = 0.31938153;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;
  const c = 0.39894228;
  if (x >= 0) {
    const t = 1 / (1 + p * x);
    return (
      1 -
      c * Math.exp(-x * x / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1)
    );
  }
  return 1 - normalCdf(-x);
}

/**
 * Z-score for the one-tailed test that true win rate > 0.5.
 */
function winRateZScore(wins: number, losses: number): number {
  const n = wins + losses;
  if (n === 0) return 0;
  const p = wins / n;
  const p0 = 0.5;
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  return se > 0 ? (p - p0) / se : 0;
}

function recommendDeltas(metrics: GradeMetrics): {
  weightDelta: number;
  thresholdDelta: number;
  recommendation: string;
  significant: boolean;
  oosValid: boolean;
} {
  const { avgR, winRate, trades, maxDrawdownR } = metrics;

  const significant = winRateZScore(metrics.wins, metrics.losses) >= MIN_WIN_RATE_Z;
  const drawdownOk = MAX_DRAWDOWN_R <= 0 || maxDrawdownR >= -MAX_DRAWDOWN_R;
  const oosValid = drawdownOk;

  if (trades < MIN_TRADES_FOR_TUNE) {
    return {
      weightDelta: 0,
      thresholdDelta: 0,
      recommendation: `Insufficient samples (${trades} < ${MIN_TRADES_FOR_TUNE}); no change.`,
      significant: false,
      oosValid: true,
    };
  }

  if (!significant) {
    return {
      weightDelta: 0,
      thresholdDelta: 0,
      recommendation: `Win rate not statistically significant (z < ${MIN_WIN_RATE_Z}); no change.`,
      significant: false,
      oosValid: true,
    };
  }

  if (!drawdownOk) {
    return {
      weightDelta: 0,
      thresholdDelta: 0,
      recommendation: `Drawdown ${maxDrawdownR.toFixed(2)}R exceeds limit -${MAX_DRAWDOWN_R}R; no change.`,
      significant,
      oosValid: false,
    };
  }

  if (avgR < 0) {
    const delta = clamp(Math.ceil(Math.abs(avgR) * 25), 2, 15);
    return {
      weightDelta: -clamp(Math.ceil(Math.abs(avgR) * 5), 1, 5),
      thresholdDelta: delta,
      recommendation: `Losing grade (avgR ${avgR.toFixed(2)}); raise threshold by ${delta} points.`,
      significant,
      oosValid,
    };
  }

  if (avgR > 0.5 && winRate > 0.5) {
    const delta = clamp(Math.floor(avgR * 4), 2, 8);
    return {
      weightDelta: clamp(Math.floor(avgR * 2), 1, 4),
      thresholdDelta: -delta,
      recommendation: `Strong grade (avgR ${avgR.toFixed(2)}, WR ${(winRate * 100).toFixed(1)}%); lower threshold by ${delta} points.`,
      significant,
      oosValid,
    };
  }

  return {
    weightDelta: 0,
    thresholdDelta: 0,
    recommendation: `Marginal grade (avgR ${avgR.toFixed(2)}, WR ${(winRate * 100).toFixed(1)}%); leave unchanged.`,
    significant,
    oosValid,
  };
}

async function aggregateBacktest(
  pool: any,
  start: Date,
  end: Date
): Promise<GradeMetrics[]> {
  const { rows } = await pool.query(
    `WITH running AS (
       SELECT symbol, tf, grade, ts, outcome, outcome_r,
              SUM(outcome_r) OVER (PARTITION BY symbol, tf, grade ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_pnl
         FROM backtest_results
        WHERE ts >= $1 AND ts <= $2 AND outcome IN ('win', 'loss')
     ),
     peaks AS (
       SELECT symbol, tf, grade, ts, outcome, outcome_r, running_pnl,
              MAX(running_pnl) OVER (PARTITION BY symbol, tf, grade ORDER BY ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS peak_pnl
         FROM running
     )
     SELECT symbol, tf, grade,
            COUNT(*) AS trades,
            SUM(CASE WHEN outcome = 'win' THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
            AVG(outcome_r) AS avg_r,
            MIN(running_pnl - peak_pnl) AS max_drawdown_r
       FROM peaks
      GROUP BY symbol, tf, grade`,
    [start, end]
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
      maxDrawdownR: Number(r.max_drawdown_r ?? 0),
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
          applied_at = CASE
            WHEN EXCLUDED.threshold_delta = 0 AND calibration_tuning.threshold_delta = 0
            THEN calibration_tuning.applied_at
            ELSE NULL
          END`,
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
          MIN_TRADES_FOR_TUNE,
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
  const now = new Date();
  const inSampleStart = new Date(now.getTime() - BACKTEST_DAYS * 24 * 60 * 60 * 1000);
  const inSampleEnd = now;

  let oosNote = "";
  if (OOS_DAYS > 0) {
    oosNote = ` (in-sample only; OOS validation not yet wired)`;
  }

  console.log(
    `[tuneFromCalibration] Aggregating backtest_results from ${inSampleStart.toISOString()} to ${inSampleEnd.toISOString()}${oosNote}`
  );

  const metrics = await aggregateBacktest(pool, inSampleStart, inSampleEnd);
  console.log(`[tuneFromCalibration] Found ${metrics.length} symbol/tf/grade buckets.`);

  if (metrics.length > 0) {
    await persistTuning(pool, metrics);
    for (const m of metrics) {
      const rec = recommendDeltas(m);
      const sig = rec.significant ? "sig" : "not-sig";
      const valid = rec.oosValid ? "valid" : "drawdown-fail";
      console.log(
        `[tuneFromCalibration] ${m.symbol} ${m.tf} ${m.grade}: trades=${m.trades} winRate=${(
          m.winRate * 100
        ).toFixed(1)}% avgR=${m.avgR.toFixed(2)} z=${winRateZScore(m.wins, m.losses).toFixed(
          2
        )} [${sig}/${valid}] → thresholdDelta=${rec.thresholdDelta} weightDelta=${rec.weightDelta}`
      );
    }
  }

  await closePool();
}

main().catch((err) => {
  console.error("[tuneFromCalibration] fatal:", err);
  process.exit(1);
});
