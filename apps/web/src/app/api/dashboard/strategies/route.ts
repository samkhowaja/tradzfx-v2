import { NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { deepMerge } from "@/lib/strategyVariantLoader";

export async function GET() {
  const pool = getWebReadPool();

  // Read from canonical store: join variants + families, merge base_spec + overrides
  const { rows: variantRows } = await pool.query(`
    SELECT
      v.id,
      v.name,
      v.description,
      v.is_active,
      v.overrides,
      v.symbols,
      v.timeframes,
      v.created_at,
      v.updated_at,
      f.id AS family_id,
      f.base_spec
    FROM strategy_variants v
    JOIN strategy_families f ON f.id = v.family_id
    ORDER BY v.is_active DESC, v.name ASC
  `);

  // Fetch aggregate stats per strategy from orders
  const { rows: orderStats } = await pool.query(`
    SELECT
      strategy_id,
      COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
      COUNT(*) FILTER (WHERE outcome IN ('win', 'partial_win')) as wins,
      COUNT(*) FILTER (WHERE status = 'filled' AND closed_at IS NULL) as open_positions
    FROM orders
    GROUP BY strategy_id
  `);

  const statsMap = new Map(
    orderStats.map((r: any) => [
      r.strategy_id,
      {
        totalTrades: parseInt(r.total_trades, 10),
        wins: parseInt(r.wins, 10),
        openPositions: parseInt(r.open_positions, 10),
        winRate:
          parseInt(r.total_trades, 10) > 0
            ? Math.round(
                (parseInt(r.wins, 10) / parseInt(r.total_trades, 10)) * 100
              )
            : null,
      },
    ])
  );

  // Build flat strategy list with merged specs
  const strategies = variantRows.map((r: any) => {
    const baseSpec = r.base_spec ?? {};
    const overrides = r.overrides ?? {};
    const merged = deepMerge(baseSpec, overrides);
    const mode = merged?.live?.mode ?? "paper";
    const stats = statsMap.get(r.id) ?? {
      totalTrades: 0,
      wins: 0,
      openPositions: 0,
      winRate: null,
    };

    return {
      id: r.id,
      name: r.name,
      version: merged.version ?? "1.0.0",
      description: r.description,
      isActive: r.is_active,
      mode,
      family: r.family_id,
      spec: merged,
      stats,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  });

  // Group by family
  const familyMap = new Map<string, any[]>();
  for (const s of strategies) {
    const list = familyMap.get(s.family) ?? [];
    list.push(s);
    familyMap.set(s.family, list);
  }

  const families = Array.from(familyMap.entries()).map(
    ([familyId, familyStrategies]) => {
      const activeCount = familyStrategies.filter((s) => s.isActive).length;
      const totalTrades = familyStrategies.reduce(
        (sum, s) => sum + s.stats.totalTrades,
        0
      );
      const totalWins = familyStrategies.reduce(
        (sum, s) => sum + s.stats.wins,
        0
      );
      const totalOpen = familyStrategies.reduce(
        (sum, s) => sum + s.stats.openPositions,
        0
      );

      return {
        id: familyId,
        name: formatFamilyName(familyId),
        strategies: familyStrategies,
        activeCount,
        totalTrades,
        totalWins,
        totalOpen,
        winRate:
          totalTrades > 0
            ? Math.round((totalWins / totalTrades) * 100)
            : null,
      };
    }
  );

  // Sort families by total trades desc, then alphabetically
  families.sort((a, b) => {
    if (b.totalTrades !== a.totalTrades) return b.totalTrades - a.totalTrades;
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ families, strategies });
}

function formatFamilyName(id: string): string {
  // waqar → Waqar
  // ict_liq_sweep → ICT Liquidity Sweep
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
