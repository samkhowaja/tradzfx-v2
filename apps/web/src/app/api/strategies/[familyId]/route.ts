import { NextResponse } from "next/server";
import { getPool } from "@tm/shared";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ familyId: string }> }
) {
  const pool = getPool();
  const { familyId } = await params;

  const familyRes = await pool.query(
    `
    SELECT
      f.id,
      f.name,
      f.description,
      f.category,
      f.base_spec,
      f.is_archived,
      BOOL_OR(v.is_active) AS is_active,
      COUNT(o.id) FILTER (WHERE o.status = 'closed') AS total_trades,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r > 0) AS wins,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r < 0) AS losses,
      COALESCE(SUM(o.outcome_r) FILTER (WHERE o.status = 'closed'), 0) AS net_r,
      COALESCE(AVG(o.outcome_r) FILTER (WHERE o.status = 'closed' AND o.outcome_r > 0), 0) AS avg_win_r,
      COALESCE(AVG(o.outcome_r) FILTER (WHERE o.status = 'closed' AND o.outcome_r < 0), 0) AS avg_loss_r
    FROM strategy_families f
    LEFT JOIN strategy_variants v ON v.family_id = f.id
    LEFT JOIN orders o ON o.variant_id = v.id
    WHERE f.id = $1
    GROUP BY f.id
    `,
    [familyId]
  );

  if (familyRes.rows.length === 0) {
    return NextResponse.json({ error: "Family not found" }, { status: 404 });
  }

  const family = familyRes.rows[0];

  const variantsRes = await pool.query(
    `
    SELECT
      v.id,
      v.name,
      v.description,
      v.symbols,
      v.timeframes,
      v.overrides,
      v.is_active,
      COUNT(o.id) FILTER (WHERE o.status = 'closed') AS total_trades,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r > 0) AS wins,
      COUNT(o.id) FILTER (WHERE o.status = 'closed' AND o.outcome_r < 0) AS losses,
      COALESCE(SUM(o.outcome_r) FILTER (WHERE o.status = 'closed'), 0) AS net_r
    FROM strategy_variants v
    LEFT JOIN orders o ON o.variant_id = v.id
    WHERE v.family_id = $1
    GROUP BY v.id
    ORDER BY v.created_at
    `,
    [familyId]
  );

  const totalClosed = parseInt(family.wins ?? "0", 10) + parseInt(family.losses ?? "0", 10);

  return NextResponse.json({
    family: {
      id: family.id,
      name: family.name,
      description: family.description,
      category: family.category,
      baseSpec: family.base_spec,
      isArchived: family.is_archived,
      isActive: family.is_active ?? false,
      totalTrades: parseInt(family.total_trades ?? "0", 10),
      wins: parseInt(family.wins ?? "0", 10),
      losses: parseInt(family.losses ?? "0", 10),
      netR: parseFloat(family.net_r ?? "0"),
      winRate: totalClosed > 0 ? parseInt(family.wins ?? "0", 10) / totalClosed : 0,
      avgWinR: parseFloat(family.avg_win_r ?? "0"),
      avgLossR: parseFloat(family.avg_loss_r ?? "0"),
    },
    variants: variantsRes.rows.map((v: any) => {
      const vTotal = parseInt(v.wins ?? "0", 10) + parseInt(v.losses ?? "0", 10);
      return {
        id: v.id,
        name: v.name,
        description: v.description,
        symbols: v.symbols,
        timeframes: v.timeframes,
        overrides: v.overrides,
        isActive: v.is_active,
        totalTrades: parseInt(v.total_trades ?? "0", 10),
        wins: parseInt(v.wins ?? "0", 10),
        losses: parseInt(v.losses ?? "0", 10),
        netR: parseFloat(v.net_r ?? "0"),
        winRate: vTotal > 0 ? parseInt(v.wins ?? "0", 10) / vTotal : 0,
      };
    }),
  });
}
