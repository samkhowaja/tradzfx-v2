import type { LevelContext, MarketLevel, TargetResult } from "./types.js";

interface Row {
  id: string;
  top: number;
  bottom: number;
  target_price: number;
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
 * Compute a structural take-profit target for a setup.
 *
 * For longs, searches for the nearest active supply-zone top, swing high,
 * bearish order-block top, or buyside liquidity pool above the entry price.
 * For shorts, searches for the nearest active demand-zone bottom, swing low,
 * bullish order-block bottom, or sellside liquidity pool below the entry price.
 *
 * The target must satisfy the configured minRR. If no structural level meets
 * the minimum RR, falls back to a fixed-R target at `fallbackRR`.
 */
export async function computeTarget(
  ctx: LevelContext,
  slPrice: number,
  fallbackRR: number
): Promise<TargetResult> {
  const { pool, symbol, direction, entryPrice, minRR, asOf, tf } = ctx;

  const asOfLiteral = asOf ? asOf.toISOString() : null;
  const risk = Math.abs(entryPrice - slPrice);
  const requiredMinRR = minRR ?? fallbackRR;

  // Kinds that act as profit targets.
  const longKinds = ["supply", "high", "bearish", "buyside"];
  const shortKinds = ["demand", "low", "bullish", "sellside"];
  const kinds = direction === "long" ? longKinds : shortKinds;

  const { rows } = await pool.query<Row>(
    `SELECT id, top, bottom, level_type, kind, strength, ts, source_id, source_json,
            ${direction === "long" ? "top" : "bottom"} AS target_price
     FROM market_levels
     WHERE symbol = $1
       AND tf = $2
       AND kind = ANY($3)
       AND invalidated_at IS NULL
       AND ts <= COALESCE($4, NOW())
       AND ${direction === "long" ? "top > $5" : "bottom < $5"}
     ORDER BY ${direction === "long" ? "top ASC" : "bottom DESC"}`,
    [symbol, tf, kinds, asOfLiteral, entryPrice]
  );

  for (const row of rows) {
    const targetPrice = Number(row.target_price);
    const reward = Math.abs(targetPrice - entryPrice);
    const rr = risk > 0 ? reward / risk : 0;
    if (rr >= requiredMinRR) {
      return {
        price: targetPrice,
        sourceLevel: rowToMarketLevel(row, symbol, tf),
        rr,
        isStructural: true,
      };
    }
  }

  // Fallback to fixed RR.
  const targetPrice =
    direction === "long"
      ? entryPrice + risk * fallbackRR
      : entryPrice - risk * fallbackRR;

  return {
    price: targetPrice,
    sourceLevel: null,
    rr: fallbackRR,
    isStructural: false,
  };
}
