import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> }
) {
  const pool = getPool();
  const { variantId } = await params;
  const body = await request.json().catch(() => ({}));

  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (body.name !== undefined) { updates.push(`name = $${idx++}`); values.push(body.name); }
  if (body.description !== undefined) { updates.push(`description = $${idx++}`); values.push(body.description); }
  if (body.symbols !== undefined) { updates.push(`symbols = $${idx++}`); values.push(body.symbols); }
  if (body.timeframes !== undefined) { updates.push(`timeframes = $${idx++}`); values.push(body.timeframes); }
  if (body.overrides !== undefined) { updates.push(`overrides = $${idx++}`); values.push(JSON.stringify(body.overrides)); }
  if (body.isActive !== undefined) { updates.push(`is_active = $${idx++}`); values.push(body.isActive); }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No fields provided" }, { status: 400 });
  }

  values.push(variantId);
  const { rows } = await pool.query(
    `UPDATE strategy_variants SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
    values
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }

  return NextResponse.json({ variant: rows[0] });
}
