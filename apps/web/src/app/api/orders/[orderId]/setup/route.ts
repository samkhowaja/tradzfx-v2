import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const pool = getPool();
  const { orderId } = await params;

  const { rows } = await pool.query(
    `
    SELECT
      symbol,
      tf,
      ts,
      grade,
      direction,
      confidence,
      entry_zone,
      stop_loss,
      take_profit,
      risk_reward,
      evidence,
      warnings,
      block_reasons,
      outcome,
      outcome_r
    FROM setup_evaluations
    WHERE order_id = $1
    ORDER BY ts DESC
    LIMIT 1
    `,
    [orderId]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Setup snapshot not found" }, { status: 404 });
  }

  return NextResponse.json({ setup: rows[0] });
}
