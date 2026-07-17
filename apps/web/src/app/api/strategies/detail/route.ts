import { NextRequest, NextResponse } from "next/server";
import { getWebReadPool } from "@tm/shared";
import { loadHistoricalPIT, loadWalkforward, loadPortfolioOverlap } from "@/lib/backtestSeed";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const pool = getWebReadPool();

  const [specRes, statsRes] = await Promise.all([
    pool.query(
      `SELECT id, name, version, description, spec_json, is_active, created_at, updated_at
       FROM strategy_specs WHERE id = $1 LIMIT 1`,
      [id]
    ),
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'closed') as total_trades,
        COUNT(*) FILTER (WHERE outcome IN ('win', 'partial_win')) as wins,
        COUNT(*) FILTER (WHERE outcome IN ('loss', 'partial_loss')) as losses,
        COUNT(*) FILTER (WHERE status = 'filled' AND closed_at IS NULL) as open_positions
       FROM orders WHERE strategy_id = $1`,
      [id]
    ),
  ]);

  if (specRes.rows.length === 0) {
    return NextResponse.json({ error: "Strategy not found" }, { status: 404 });
  }

  const row = specRes.rows[0];
  const spec = row.spec_json;
  const stats = statsRes.rows[0];
  const totalTrades = parseInt(stats.total_trades, 10);
  const wins = parseInt(stats.wins, 10);
  const losses = parseInt(stats.losses, 10);

  const live = {
    isActive: row.is_active,
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
      id: row.id,
      name: row.name,
      version: row.version,
      description: row.description,
      family: row.id.replace(/(_v\d+.*|_\d+m)$/, ""),
      ...spec,
    },
    live,
    historicalPIT,
    walkforward,
    portfolioOverlap,
  });
}
