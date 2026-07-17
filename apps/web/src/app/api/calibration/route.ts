import { NextRequest, NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? null;
  const tf = searchParams.get("tf") ?? null;

  const pool = getWebReadPool();
  const conditions: string[] = [];
  const params: (string | null)[] = [];

  if (symbol) {
    params.push(symbol);
    conditions.push(`symbol = $${params.length}`);
  }
  if (tf) {
    params.push(tf);
    conditions.push(`tf = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const { rows } = await pool.query(
      `SELECT symbol, tf, grade, avg_r, sample_count, recommendation,
              weight_delta, threshold_delta, win_rate, expectancy, min_trades,
              tuned_at, applied_at
         FROM public.calibration_tuning
         ${whereClause}
         ORDER BY symbol, tf, grade
         LIMIT 500`,
      params
    );

    return NextResponse.json({
      symbol,
      tf,
      rows: rows.map((r: any) => ({
        symbol: r.symbol,
        tf: r.tf,
        grade: r.grade,
        avgR: Number(r.avg_r ?? 0),
        sampleCount: Number(r.sample_count ?? 0),
        recommendation: r.recommendation ?? null,
        weightDelta: Number(r.weight_delta ?? 0),
        thresholdDelta: Number(r.threshold_delta ?? 0),
        winRate: r.win_rate == null ? null : Number(r.win_rate),
        expectancy: r.expectancy == null ? null : Number(r.expectancy),
        minTrades: Number(r.min_trades ?? 0),
        tunedAt: r.tuned_at?.toISOString() ?? null,
        appliedAt: r.applied_at?.toISOString() ?? null,
      })),
    });
  } catch (err: any) {
    console.error("[calibration] GET failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
