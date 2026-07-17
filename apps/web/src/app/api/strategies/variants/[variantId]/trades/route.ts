import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const pool = getWebReadPool();
  const { variantId } = await params;

  const { rows } = await pool.query(
    `
    SELECT
      o.id,
      o.symbol,
      o.side,
      o.status,
      o.entry_price,
      o.stop_loss,
      o.take_profit,
      o.fill_price,
      o.close_price,
      o.outcome,
      o.outcome_r,
      o.created_at,
      o.filled_at,
      o.closed_at
    FROM orders o
    WHERE o.variant_id = $1
    ORDER BY o.created_at DESC
    LIMIT 500
    `,
    [variantId]
  );

  return NextResponse.json({ trades: rows });
}
