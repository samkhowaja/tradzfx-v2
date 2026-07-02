import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET() {
  const pool = getPool();
  const { rows } = await pool.query(
    `
    SELECT
      f.id,
      f.name,
      f.description,
      f.category,
      f.is_archived,
      BOOL_OR(v.is_active) AS is_active,
      COUNT(o.id) FILTER (WHERE o.status = 'closed') AS total_trades,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r > 0) AS wins,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r < 0) AS losses,
      COALESCE(SUM(o.outcome_r) FILTER (WHERE o.status = 'closed'), 0) AS net_r
    FROM strategy_families f
    LEFT JOIN strategy_variants v ON v.family_id = f.id
    LEFT JOIN orders o ON o.variant_id = v.id
    WHERE f.is_archived = false
    GROUP BY f.id
    ORDER BY f.name
    `
  );

  const families = rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    category: r.category,
    isArchived: r.is_archived,
    isActive: r.is_active ?? false,
    totalTrades: parseInt(r.total_trades ?? "0", 10),
    wins: parseInt(r.wins ?? "0", 10),
    losses: parseInt(r.losses ?? "0", 10),
    netR: parseFloat(r.net_r ?? "0"),
    winRate: (parseInt(r.wins ?? "0", 10) + parseInt(r.losses ?? "0", 10)) > 0
      ? parseInt(r.wins ?? "0", 10) / (parseInt(r.wins ?? "0", 10) + parseInt(r.losses ?? "0", 10))
      : 0,
  }));

  return NextResponse.json({ families });
}
