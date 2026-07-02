import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
  const tf = searchParams.get("tf") ?? "15m";
  const days = parseInt(searchParams.get("days") ?? "90", 10);

  const pool = getPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    const { rows: gradeRows } = await pool.query(
      `SELECT
         grade,
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
         COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
         COALESCE(AVG(outcome_r), 0) AS avg_r,
         COALESCE(SUM(outcome_r), 0) AS total_r
       FROM backtest_results
       WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND outcome IN ('win', 'loss')
       GROUP BY grade
       ORDER BY grade`,
      [symbol, tf, since]
    );

    const { rows: sessionRows } = await pool.query(
      `SELECT
         COALESCE(session_name, 'unknown') AS session,
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
         COALESCE(AVG(outcome_r), 0) AS avg_r
       FROM backtest_results
       WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND outcome IN ('win', 'loss')
       GROUP BY session_name
       ORDER BY count DESC`,
      [symbol, tf, since]
    );

    const { rows: htfRows } = await pool.query(
      `SELECT
         COALESCE(htf_state, 'unknown') AS htf_state,
         COUNT(*)::int AS count,
         COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
         COALESCE(AVG(outcome_r), 0) AS avg_r
       FROM backtest_results
       WHERE symbol = $1 AND tf = $2 AND ts >= $3 AND outcome IN ('win', 'loss')
       GROUP BY htf_state
       ORDER BY count DESC`,
      [symbol, tf, since]
    );

    const totalTrades = gradeRows.reduce((sum, r) => sum + Number(r.count), 0);
    const wins = gradeRows.reduce((sum, r) => sum + Number(r.wins), 0);
    const totalR = gradeRows.reduce((sum, r) => sum + Number(r.total_r), 0);

    return NextResponse.json({
      symbol,
      tf,
      since: since.toISOString(),
      summary: {
        totalTrades,
        winRate: totalTrades > 0 ? wins / totalTrades : 0,
        avgR: totalTrades > 0 ? totalR / totalTrades : 0,
        totalR,
      },
      byGrade: gradeRows.map((r) => ({
        grade: r.grade,
        count: Number(r.count),
        wins: Number(r.wins),
        losses: Number(r.losses),
        winRate: Number(r.count) > 0 ? Number(r.wins) / Number(r.count) : 0,
        avgR: Number(r.avg_r),
        totalR: Number(r.total_r),
      })),
      bySession: sessionRows.map((r) => ({
        session: r.session,
        count: Number(r.count),
        winRate: Number(r.count) > 0 ? Number(r.wins) / Number(r.count) : 0,
        avgR: Number(r.avg_r),
      })),
      byHtfState: htfRows.map((r) => ({
        htfState: r.htf_state,
        count: Number(r.count),
        winRate: Number(r.count) > 0 ? Number(r.wins) / Number(r.count) : 0,
        avgR: Number(r.avg_r),
      })),
    });
  } catch (err: any) {
    console.error("[backtest/report] failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
