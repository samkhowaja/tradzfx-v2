import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const isActive = body.isActive;

  const pool = getPool();
  await pool.query(
    `UPDATE strategy_specs SET is_active = $1, updated_at = NOW() WHERE id = $2`,
    [isActive, id]
  );

  return NextResponse.json({ id, isActive });
}
