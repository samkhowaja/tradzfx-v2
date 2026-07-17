import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { generateReport, runMonteCarlo } from "@tm/analyzer-backtest";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? "EURUSD";
  const tf = searchParams.get("tf") ?? "15m";
  const days = parseInt(searchParams.get("days") ?? "90", 10);
  const variantId = searchParams.get("variantId");
  const source = searchParams.get("source") ?? "analyzer";
  const withMonteCarlo = searchParams.get("monteCarlo") === "true";
  const mcIterations = parseInt(searchParams.get("mcIterations") ?? "5000", 10);

  const pool = getWebReadPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    let sql = `
      SELECT
        ts, grade, direction, confidence,
        entry_zone, stop_loss, take_profit, risk_reward,
        outcome, outcome_r, exit_price, exit_ts, bars_held,
        htf_state, session_name, effective_entry, max_adverse_r, max_favorable_r
      FROM public.backtest_results
      WHERE symbol = $1 AND tf = $2 AND ts >= $3`;
    const params: (string | Date)[] = [symbol, tf, since];
    if (variantId) {
      sql += ` AND variant_id = $4`;
      params.push(variantId);
    }
    if (source && source !== "all") {
      sql += ` AND source = $${params.length + 1}`;
      params.push(source);
    }
    sql += ` ORDER BY ts`;

    const { rows } = await pool.query(sql, params);

    const trades = rows.map((r: any) => ({
      ts: r.ts.toISOString(),
      grade: r.grade,
      direction: r.direction,
      confidence: Number(r.confidence),
      entryZone: r.entry_zone,
      stopLoss: r.stop_loss == null ? null : Number(r.stop_loss),
      takeProfit: r.take_profit == null ? null : Number(r.take_profit),
      riskReward: r.risk_reward == null ? null : Number(r.risk_reward),
      outcome: r.outcome,
      outcomeR: Number(r.outcome_r ?? 0),
      exitPrice: r.exit_price == null ? null : Number(r.exit_price),
      exitTs: r.exit_ts?.toISOString() ?? null,
      barsHeld: Number(r.bars_held ?? 0),
      htfState: r.htf_state,
      sessionName: r.session_name,
      effectiveEntry: r.effective_entry == null ? null : Number(r.effective_entry),
      maxAdverseR: Number(r.max_adverse_r ?? 0),
      maxFavorableR: Number(r.max_favorable_r ?? 0),
    }));

    const report = generateReport(trades);

    const response: Record<string, unknown> = {
      symbol,
      tf,
      since: since.toISOString(),
      summary: {
        totalTrades: report.totalTrades,
        winRate: report.winRate,
        avgR: report.avgR,
        totalR: report.totalR,
      },
      riskReturn: report.riskReturn,
      byGrade: report.byGrade,
      bySession: report.bySession,
      byHtfState: report.byHtfState,
      byDirection: report.byDirection,
    };

    if (withMonteCarlo) {
      response.monteCarlo = runMonteCarlo(trades, {
        iterations: Math.min(50_000, Math.max(1000, mcIterations)),
        confidence: 0.95,
      });
    }

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[backtest/report] failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
