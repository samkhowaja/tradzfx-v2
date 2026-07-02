import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ familyId: string }> }
) {
  const pool = getPool();
  const { familyId } = await params;
  const body = await request.json().catch(() => ({}));

  const id = `${familyId}_${Date.now()}`;
  const name = body.name ?? "New variant";
  const description = body.description ?? "";
  const symbols = Array.isArray(body.symbols) ? body.symbols : [];
  const timeframes = Array.isArray(body.timeframes) ? body.timeframes : [];
  const overrides = body.overrides ?? {};

  const { rows } = await pool.query(
    `
    INSERT INTO strategy_variants (id, family_id, name, description, symbols, timeframes, overrides, is_active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, false)
    RETURNING *
    `,
    [id, familyId, name, description, symbols, timeframes, JSON.stringify(overrides)]
  );

  return NextResponse.json({ variant: rows[0] }, { status: 201 });
}
