import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { generateReport, runMonteCarlo } from "@tm/analyzer-backtest";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ familyId: string }> }
) {
  const { familyId } = await params;
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase() ?? null;
  const tf = searchParams.get("tf") ?? null;
  const days = parseInt(searchParams.get("days") ?? "90", 10);
  const source = searchParams.get("source") ?? "analyzer";
  const withMonteCarlo = searchParams.get("monteCarlo") === "true";
  const mcIterations = parseInt(searchParams.get("mcIterations") ?? "5000", 10);

  const pool = getPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    let sql = `
      SELECT
        ts, grade, direction, confidence,
        entry_zone, stop_loss, take_profit, risk_reward,
        outcome, outcome_r, exit_price, exit_ts, bars_held,
        htf_state, session_name, effective_entry, max_adverse_r, max_favorable_r
      FROM backtest_results
      WHERE ts >= $1
        AND variant_id IN (SELECT id FROM strategy_variants WHERE family_id = $2)`;
    const paramsList: (string | Date | null)[] = [since, familyId];

    if (symbol) {
      paramsList.push(symbol);
      sql += ` AND symbol = $${paramsList.length}`;
    }
    if (tf) {
      paramsList.push(tf);
      sql += ` AND tf = $${paramsList.length}`;
    }
    if (source && source !== "all") {
      paramsList.push(source);
      sql += ` AND source = $${paramsList.length}`;
    }

    sql += ` ORDER BY ts`;

    const { rows } = await pool.query(sql, paramsList);

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
      familyId,
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
      trades,
    };

    if (withMonteCarlo) {
      response.monteCarlo = runMonteCarlo(trades, {
        iterations: Math.min(50_000, Math.max(1000, mcIterations)),
        confidence: 0.95,
      });
    }

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[strategies/backtest] failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
