import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();

  const { rows: summary } = await pool.query(`
    SELECT 
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE outcome = 'TP_HIT') as wins,
      COUNT(*) FILTER (WHERE outcome = 'SL_HIT') as losses,
      COUNT(*) FILTER (WHERE outcome = 'MANUAL') as manuals,
      ROUND(AVG(outcome_r)::numeric, 3) as avg_r,
      ROUND(SUM(outcome_r)::numeric, 3) as net_r,
      ROUND(
        COUNT(*) FILTER (WHERE outcome = 'TP_HIT')::numeric / 
        NULLIF(COUNT(*) FILTER (WHERE outcome IN ('TP_HIT', 'SL_HIT')), 0)::numeric, 
      3) as win_rate,
      ROUND(MIN(outcome_r)::numeric, 3) as max_drawdown,
      ROUND(
        SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl ELSE 0 END)::numeric /
        NULLIF(SUM(CASE WHEN realized_pnl < 0 THEN ABS(realized_pnl) ELSE 0 END), 0)::numeric,
      3) as profit_factor
    FROM orders
    WHERE status = 'closed'
  `);

  const { rows: equity } = await pool.query(`
    SELECT 
      DATE(closed_at) as date,
      ROUND(SUM(realized_pnl)::numeric, 2) as pnl,
      ROUND(SUM(outcome_r)::numeric, 3) as r
    FROM orders
    WHERE status = 'closed' AND closed_at >= NOW() - INTERVAL '30 days'
    GROUP BY DATE(closed_at)
    ORDER BY date ASC
  `);

  const { rows: byPair } = await pool.query(`
    SELECT 
      symbol,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE outcome = 'TP_HIT') as wins,
      COUNT(*) FILTER (WHERE outcome = 'SL_HIT') as losses,
      ROUND(SUM(outcome_r)::numeric, 3) as net_r,
      ROUND(AVG(outcome_r)::numeric, 3) as avg_r
    FROM orders
    WHERE status = 'closed'
    GROUP BY symbol
    ORDER BY net_r DESC
  `);

  return NextResponse.json({
    summary: summary[0] ?? null,
    equity,
    byPair,
  });
}
