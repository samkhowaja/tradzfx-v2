import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function PATCH(request: NextRequest) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { symbol, tf, grade } = body ?? {};
  if (!symbol || !tf || !grade) {
    return NextResponse.json(
      { error: "Missing symbol, tf, or grade" },
      { status: 400 }
    );
  }

  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `UPDATE calibration_tuning
          SET applied_at = NOW()
        WHERE symbol = $1 AND tf = $2 AND grade = $3
        RETURNING applied_at`,
      [symbol.toUpperCase(), tf, grade]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Tuning row not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      symbol: symbol.toUpperCase(),
      tf,
      grade,
      appliedAt: rows[0].applied_at.toISOString(),
    });
  } catch (err: any) {
    console.error("[calibration/apply] PATCH failed:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
