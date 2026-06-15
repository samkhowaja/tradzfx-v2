import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);
  const symbol = searchParams.get("symbol");
  const status = searchParams.get("status");
  const offset = (page - 1) * limit;

  const pool = getPool();

  let whereClause = "";
  const params: any[] = [];
  let paramIdx = 1;
  const conditions: string[] = [];

  if (symbol) {
    conditions.push(`symbol = $${paramIdx++}`);
    params.push(symbol);
  }
  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }

  if (conditions.length > 0) {
    whereClause = "WHERE " + conditions.join(" AND ");
  }

  const { rows: signals } = await pool.query(
    `
    SELECT 
      id, symbol, strategy_id, side, entry_price, stop_loss, take_profit,
      lot_size, status, trade_mode, outcome, outcome_r, realized_pnl,
      created_at, filled_at, closed_at, trace_run_id
    FROM orders
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `,
    [...params, limit, offset]
  );

  const { rows: countResult } = await pool.query(
    `SELECT COUNT(*) as total FROM orders ${whereClause}`,
    params
  );

  return NextResponse.json({
    signals,
    pagination: {
      page,
      limit,
      total: parseInt(countResult[0].total, 10),
      pages: Math.ceil(parseInt(countResult[0].total, 10) / limit),
    },
  });
}
