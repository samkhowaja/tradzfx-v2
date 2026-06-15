import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT 
      id, symbol, strategy_id, side, entry_price, stop_loss, take_profit,
      lot_size, status, trade_mode, outcome, outcome_r, realized_pnl,
      created_at, filled_at, closed_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 30
  `);
  return NextResponse.json({ signals: rows });
}
