import type { Pool } from "./db";
import type { TimeFrame } from "../types/feature";

export interface SetupEvaluationSnapshot {
  symbol: string;
  tf: TimeFrame;
  ts: Date;
  grade: string;
  direction: string;
  confidence: number;
  entryZone?: { top: number; bottom: number; zoneId?: string; zoneType?: string } | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskReward?: number | null;
  evidence?: Array<{
    type: string;
    weight: number;
    description: string;
    data?: Record<string, unknown>;
  }>;
  warnings?: string[];
  blockReasons?: string[];
}

export interface GradeCalibrationRow {
  grade: string;
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  totalR: number;
}

/**
 * Persist a setup evaluation snapshot. Typically called when a setup becomes a
 * live order so the outcome can be correlated with the predicted grade.
 */
export async function recordSetupEvaluation(
  pool: Pool,
  snapshot: SetupEvaluationSnapshot,
  orderId?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO setup_evaluations (
      symbol, tf, ts, grade, direction, confidence,
      entry_zone, stop_loss, take_profit, risk_reward,
      evidence, warnings, block_reasons, order_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    ON CONFLICT (symbol, tf, ts, direction, order_id)
    WHERE order_id IS NOT NULL
    DO NOTHING`,
    [
      snapshot.symbol,
      snapshot.tf,
      snapshot.ts,
      snapshot.grade,
      snapshot.direction,
      snapshot.confidence,
      snapshot.entryZone ? JSON.stringify(snapshot.entryZone) : null,
      snapshot.stopLoss ?? null,
      snapshot.takeProfit ?? null,
      snapshot.riskReward ?? null,
      snapshot.evidence ? JSON.stringify(snapshot.evidence) : null,
      snapshot.warnings ?? [],
      snapshot.blockReasons ?? [],
      orderId ?? null,
    ]
  );
}

/**
 * Update the outcome of a previously recorded setup snapshot once the order
 * closes.
 */
export async function updateSetupEvaluationOutcome(
  pool: Pool,
  orderId: string,
  outcome: string,
  outcomeR: number
): Promise<void> {
  await pool.query(
    `UPDATE setup_evaluations
     SET outcome = $2, outcome_r = $3
     WHERE order_id = $1`,
    [orderId, outcome, outcomeR]
  );
}

/**
 * Aggregate grade calibration statistics from completed setup evaluations.
 */
export async function getGradeCalibration(
  pool: Pool,
  symbol?: string,
  tf?: string
): Promise<GradeCalibrationRow[]> {
  const conditions: string[] = [];
  const params: (string | undefined)[] = [];
  if (symbol) {
    params.push(symbol);
    conditions.push(`symbol = $${params.length}`);
  }
  if (tf) {
    params.push(tf);
    conditions.push(`tf = $${params.length}`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const query = `
    WITH live AS (
      SELECT grade, outcome_r, symbol, tf
      FROM setup_evaluations
      WHERE outcome IS NOT NULL AND outcome_r IS NOT NULL
    ),
    sim AS (
      SELECT grade, outcome_r, symbol, tf
      FROM backtest_results
      WHERE outcome IN ('win', 'loss') AND outcome_r IS NOT NULL AND source = 'analyzer'
    ),
    combined AS (SELECT * FROM live UNION ALL SELECT * FROM sim)
    SELECT
      grade,
      COUNT(*)::int AS count,
      COUNT(*) FILTER (WHERE outcome_r > 0)::int AS wins,
      COUNT(*) FILTER (WHERE outcome_r < 0)::int AS losses,
      COALESCE(AVG(outcome_r), 0) AS avg_r,
      COALESCE(SUM(outcome_r), 0) AS total_r
    FROM combined
    ${whereClause}
    GROUP BY grade
    ORDER BY grade
  `;

  try {
    const { rows }: { rows: any[] } = await pool.query(query, params);
    return rows.map((r) => ({
      grade: r.grade,
      count: r.count,
      wins: r.wins,
      losses: r.losses,
      winRate: r.count > 0 ? r.wins / r.count : 0,
      avgR: Number(r.avg_r),
      totalR: Number(r.total_r),
    }));
  } catch (err: any) {
    // If the backtest_results table does not exist yet (migration not applied),
    // fall back to live-only calibration.
    if (err?.code === "42P01") {
      const { rows }: { rows: any[] } = await pool.query(
        `SELECT
           grade,
           COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE outcome_r > 0)::int AS wins,
           COUNT(*) FILTER (WHERE outcome_r < 0)::int AS losses,
           COALESCE(AVG(outcome_r), 0) AS avg_r,
           COALESCE(SUM(outcome_r), 0) AS total_r
         FROM setup_evaluations
         WHERE outcome IS NOT NULL ${conditions.length > 0 ? "AND " + conditions.join(" AND ") : ""}
         GROUP BY grade
         ORDER BY grade`,
        params
      );
      return rows.map((r) => ({
        grade: r.grade,
        count: r.count,
        wins: r.wins,
        losses: r.losses,
        winRate: r.count > 0 ? r.wins / r.count : 0,
        avgR: Number(r.avg_r),
        totalR: Number(r.total_r),
      }));
    }
    throw err;
  }
}
