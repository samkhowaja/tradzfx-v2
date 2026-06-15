import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const symbol = searchParams.get("symbol");
  const outcome = searchParams.get("outcome");
  const offset = (page - 1) * limit;

  const pool = getPool();

  let whereClause = "WHERE status = 'closed'";
  const params: any[] = [];
  let paramIdx = 1;

  if (symbol) {
    whereClause += ` AND symbol = $${paramIdx++}`;
    params.push(symbol);
  }
  if (outcome) {
    whereClause += ` AND outcome = $${paramIdx++}`;
    params.push(outcome);
  }

  const { rows: trades } = await pool.query(
    `
    SELECT 
      id, symbol, strategy_id, side, entry_price, stop_loss, take_profit,
      lot_size, fill_price, close_price, risk_reward, outcome, outcome_r,
      realized_pnl, trade_mode, created_at, filled_at, closed_at
    FROM orders
    ${whereClause}
    ORDER BY closed_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `,
    [...params, limit, offset]
  );

  const { rows: countResult } = await pool.query(
    `SELECT COUNT(*) as total FROM orders ${whereClause}`,
    params
  );

  return NextResponse.json({
    trades,
    pagination: {
      page,
      limit,
      total: parseInt(countResult[0].total, 10),
      pages: Math.ceil(parseInt(countResult[0].total, 10) / limit),
    },
  });
}
