import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function POST(req: NextRequest) {
  const pool = getPool();
  const { id, spec } = await req.json();

  if (!id || !spec) {
    return NextResponse.json({ error: "Missing id or spec" }, { status: 400 });
  }

  await pool.query(
    `UPDATE strategy_specs SET spec_json = $1, updated_at = NOW() WHERE id = $2`,
    [JSON.stringify(spec), id]
  );

  return NextResponse.json({ ok: true, id });
}
