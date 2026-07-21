import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@tm/shared";
import { computeOverrides } from "@/lib/strategyVariantLoader";

export async function POST(req: NextRequest) {
  const pool = getPool();
  const { id, spec } = await req.json();

  if (!id || !spec) {
    return NextResponse.json({ error: "Missing id or spec" }, { status: 400 });
  }

  // Determine if `id` is a variant or a family. Try variant first.
  const varRes = await pool.query(
    `SELECT v.id AS variant_id, v.family_id, f.base_spec
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.id = $1`,
    [id]
  );

  if (varRes.rows.length > 0) {
    // Writing to a variant — compute override delta from base spec.
    const row = varRes.rows[0];
    const baseSpec = row.base_spec ?? {};
    const overrides = computeOverrides(baseSpec, spec) ?? {};

    // Also extract top-level variant metadata from the incoming spec
    const symbols: string[] = spec.filters?.symbols ?? [];
    const timeframes: string[] = spec.timeframes ?? [];
    const name: string = spec.name ?? row.variant_id.replace(/_/g, " ");

    await pool.query(
      `UPDATE strategy_variants
       SET overrides = $1,
           name = $2,
           symbols = CASE WHEN $3::text[] != '{}' THEN $3::text[] ELSE symbols END,
           timeframes = CASE WHEN $4::text[] != '{}' THEN $4::text[] ELSE timeframes END,
           updated_at = NOW()
       WHERE id = $5`,
      [JSON.stringify(overrides), name, symbols, timeframes, id]
    );

    return NextResponse.json({ ok: true, id, store: "variant" });
  }

  // Not a variant — try as a family.
  const famRes = await pool.query(
    `SELECT id FROM strategy_families WHERE id = $1`,
    [id]
  );

  if (famRes.rows.length > 0) {
    await pool.query(
      `UPDATE strategy_families
       SET base_spec = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(spec), id]
    );

    return NextResponse.json({ ok: true, id, store: "family" });
  }

  return NextResponse.json({ error: "Strategy variant/family not found" }, { status: 404 });
}
