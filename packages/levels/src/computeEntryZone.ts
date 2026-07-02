import type { LevelContext, EntryZoneResult, MarketLevel } from "./types.js";

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
 * Select the best active entry zone for a setup.
 *
 * For longs, returns the highest-strength active demand zone below the
 * current price. For shorts, returns the highest-strength active supply zone
 * above the current price.
 *
 * This is a building block for the unified Decision Kernel; in production it
 * will be combined with OTE overlap and structure freshness checks.
 */
export async function computeEntryZone(
  ctx: LevelContext
): Promise<EntryZoneResult | null> {
  const { pool, symbol, direction, entryPrice, asOf, tf } = ctx;

  const asOfLiteral = asOf ? asOf.toISOString() : null;
  const kind = direction === "long" ? "demand" : "supply";

  const { rows } = await pool.query<Row>(
    `SELECT id, top, bottom, level_type, kind, strength, ts, source_id, source_json
     FROM market_levels
     WHERE symbol = $1
       AND tf = $2
       AND kind = $3
       AND level_type = 'zone'
       AND invalidated_at IS NULL
       AND ts <= COALESCE($4, NOW())
       AND ${direction === "long" ? "top < $5" : "bottom > $5"}
     ORDER BY COALESCE(strength, 0) DESC, ts DESC
     LIMIT 1`,
    [symbol, tf, kind, asOfLiteral, entryPrice]
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    top: Number(row.top),
    bottom: Number(row.bottom),
    sourceLevel: rowToMarketLevel(row, symbol, tf),
  };
}
