import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT 
      id, symbol, strategy_id, side, entry_price, stop_loss, take_profit,
      lot_size, fill_price, risk_reward, trade_mode,
      COALESCE(
        CASE 
          WHEN side = 'buy' THEN (c.close - fill_price) / NULLIF(fill_price - stop_loss, 0)
          WHEN side = 'sell' THEN (fill_price - c.close) / NULLIF(fill_price - stop_loss, 0)
        END, 0
      ) as unrealized_r,
      c.close as current_price,
      filled_at
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT c as close FROM market.candles_1m_canonical
      WHERE symbol = o.symbol
      ORDER BY ts DESC LIMIT 1
    ) c ON true
    WHERE status = 'filled' AND closed_at IS NULL
    ORDER BY filled_at DESC
  `);
  return NextResponse.json({ positions: rows });
}
