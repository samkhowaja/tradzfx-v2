import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { generateReport, runMonteCarlo } from "@tm/analyzer-backtest";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const { variantId } = await params;
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol")?.toUpperCase();
  const tf = searchParams.get("tf");
  const days = parseInt(searchParams.get("days") ?? "90", 10);
  const source = searchParams.get("source") ?? "analyzer";
  const withMonteCarlo = searchParams.get("monteCarlo") === "true";
  const mcIterations = parseInt(searchParams.get("mcIterations") ?? "5000", 10);

  const pool = getWebReadPool();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  try {
    let sql = `
      SELECT
        bt.ts, bt.symbol, bt.tf, bt.grade, bt.direction, bt.confidence,
        bt.entry_zone, bt.stop_loss, bt.take_profit, bt.risk_reward,
        bt.outcome, bt.outcome_r, bt.exit_price, bt.exit_ts, bt.bars_held,
        bt.htf_state, bt.session_name, bt.effective_entry, bt.max_adverse_r, bt.max_favorable_r
      FROM backtest_results bt
      INNER JOIN (
        SELECT id AS latest_run_id
        FROM backtest_runs
        WHERE variant_id = $1
        ORDER BY end_ts DESC, id DESC
        LIMIT 1
      ) latest ON bt.run_id = latest.latest_run_id
      WHERE bt.variant_id = $1 AND bt.ts >= $2
        AND bt.heat_dropped = false`;
    const paramsArr: (string | Date)[] = [variantId, since];
    let idx = 3;
    if (symbol) {
      sql += ` AND symbol = $${idx++}`;
      paramsArr.push(symbol);
    }
    if (tf) {
      sql += ` AND tf = $${idx++}`;
      paramsArr.push(tf);
    }
    if (source && source !== "all") {
      sql += ` AND source = $${idx++}`;
      paramsArr.push(source);
    }
    sql += ` ORDER BY ts`;

    const { rows } = await pool.query(sql, paramsArr);

    const trades = rows.map((r: any) => ({
      ts: r.ts.toISOString(),
      symbol: r.symbol,
      tf: r.tf,
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
      variantId,
      symbol: symbol ?? "ALL",
      tf: tf ?? "ALL",
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
    console.error("[strategies/variants/backtest] failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
