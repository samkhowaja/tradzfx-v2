import type { Pool } from "@tm/shared";
import type { LevelContext, MarketLevel, StopLossResult } from "./types.js";

interface Row {
  id: string;
  top: number;
  bottom: number;
  level_type: string;
  kind: string;
  strength: number | null;
  ts: Date;
  source_id: string | null;
  source_json: Record<string, unknown> | null;
}

function rowToMarketLevel(row: Row, symbol: string, tf: string): MarketLevel {
  return {
    id: row.id,
    symbol,
    tf: tf as any,
    level_type: row.level_type as any,
    kind: row.kind as any,
    top: Number(row.top),
    bottom: Number(row.bottom),
    strength: row.strength == null ? null : Number(row.strength),
    invalidated_at: null,
    tapped_at: null,
    touch_count: 0,
    source_id: row.source_id,
    source_json: row.source_json,
    ts: row.ts,
    created_at: row.ts,
    updated_at: row.ts,
  };
}

/**
 * Compute a structural stop-loss for a setup.
 *
 * For longs, searches for the nearest active demand-zone bottom, swing low,
 * or bullish order-block bottom below the entry price.
 * For shorts, searches for the nearest active supply-zone top, swing high,
 * or bearish order-block top above the entry price.
 *
 * Falls back to a fixed ATR-style stop if no structural invalidation level
 * exists within the allowed maxSlDistance.
 */
export async function computeStopLoss(
  ctx: LevelContext,
  fallbackDistance: number
): Promise<StopLossResult> {
  const { pool, symbol, direction, entryPrice, maxSlDistance, asOf, tf } = ctx;

  const asOfLiteral = asOf ? asOf.toISOString() : null;

  // Kinds that invalidate a setup.
  const longKinds = ["demand", "low", "bullish"];
  const shortKinds = ["supply", "high", "bearish"];
  const kinds = direction === "long" ? longKinds : shortKinds;

  const { rows } = await pool.query<Row>(
    `SELECT id, top, bottom, level_type, kind, strength, ts, source_id, source_json
     FROM market_levels_view
     WHERE symbol = $1
       AND tf = $2
       AND kind = ANY($3)
       AND invalidated_at IS NULL
       AND ts <= COALESCE($4, NOW())
       AND ${direction === "long" ? "bottom < $5" : "top > $5"}
     ORDER BY ${direction === "long" ? "bottom DESC" : "top ASC"}
     LIMIT 1`,
    [symbol, tf, kinds, asOfLiteral, entryPrice]
  );

  let slPrice: number;
  let sourceLevel: MarketLevel | null = null;

  if (rows.length > 0) {
    const row = rows[0];
    // Use the far edge of the level as the invalidation point.
    slPrice = direction === "long" ? Number(row.bottom) : Number(row.top);
    sourceLevel = rowToMarketLevel(row, symbol, tf);
  } else {
    slPrice =
      direction === "long"
        ? entryPrice - fallbackDistance
        : entryPrice + fallbackDistance;
  }

  const distance = Math.abs(entryPrice - slPrice);

  if (maxSlDistance != null && distance > maxSlDistance) {
    // Structural level too far away; clamp to max allowed distance.
    slPrice =
      direction === "long"
        ? entryPrice - maxSlDistance
        : entryPrice + maxSlDistance;
    sourceLevel = null;
  }

  return { price: slPrice, sourceLevel, distance: Math.abs(entryPrice - slPrice) };
}
