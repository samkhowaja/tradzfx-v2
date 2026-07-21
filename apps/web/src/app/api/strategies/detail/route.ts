import { NextRequest, NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { loadHistoricalPIT, loadWalkforward, loadPortfolioOverlap } from "@/lib/backtestSeed";
import { loadVariantById } from "@/lib/strategyVariantLoader";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const pool = getWebReadPool();

  // Read merged spec from the canonical store (family base_spec + variant overrides)
  // instead of the legacy strategy_specs table. (Audit #7)
  const variant = await loadVariantById(pool, id);
  if (!variant) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const statsRes = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
       COUNT(*) FILTER (WHERE outcome IN ('win', 'partial_win')) as wins,
       COUNT(*) FILTER (WHERE outcome IN ('loss', 'partial_loss')) as losses,
       COUNT(*) FILTER (WHERE status = 'filled' AND closed_at IS NULL) as open_positions
     FROM orders WHERE strategy_id = $1`,
    [id]
  );

  const spec = variant.spec;
  const stats = statsRes.rows[0];
  const totalTrades = parseInt(stats.total_trades, 10);
  const wins = parseInt(stats.wins, 10);
  const losses = parseInt(stats.losses, 10);

  const live = {
    isActive: true,
    mode: spec?.live?.mode ?? "paper",
    totalTrades,
    wins,
    losses,
    openPositions: parseInt(stats.open_positions, 10),
    winRate: totalTrades > 0 ? wins / totalTrades : 0,
  };

  const historicalPIT = loadHistoricalPIT(id);
  const walkforward = loadWalkforward(id);
  const portfolioOverlap = loadPortfolioOverlap(id);

  return NextResponse.json({
    spec: {
      ...spec,
      id: variant.variantId,
      name: variant.name,
      version: spec.version ?? "1.0.0",
      description: spec.description ?? null,
      family: variant.familyId,
    },
    live,
    historicalPIT,
    walkforward,
    portfolioOverlap,
  });
}
