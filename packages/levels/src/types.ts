import type { Queryable, TimeFrame } from "@tm/shared";

export type LevelType =
  | "zone"
  | "order_block"
  | "liquidity_pool"
  | "pivot"
  | "fvg"
  | "eq_liquidity";

export type LevelKind =
  | "demand"
  | "supply"
  | "high"
  | "low"
  | "buyside"
  | "sellside"
  | "bullish"
  | "bearish";

export interface MarketLevel {
  id: string;
  symbol: string;
  tf: TimeFrame;
  level_type: LevelType;
  kind: LevelKind;
  top: number;
  bottom: number;
  strength: number | null;
  invalidated_at: Date | null;
  tapped_at: Date | null;
  touch_count: number;
  source_id: string | null;
  source_json: Record<string, unknown> | null;
  ts: Date;
  created_at: Date;
  updated_at: Date;
}

export interface LevelContext {
  pool: Queryable;
  symbol: string;
  tf: TimeFrame;
  direction: "long" | "short";
  entryPrice: number;
  /** Maximum allowed SL distance in price units. If null, no cap. */
  maxSlDistance?: number;
  /** Minimum required risk:reward for a structural target. */
  minRR?: number;
  /** Timestamp as-of which levels are evaluated (defaults to NOW()). */
  asOf?: Date;
}

export interface StopLossResult {
  price: number;
  sourceLevel: MarketLevel | null;
  distance: number;
}

export interface TargetResult {
  price: number;
  sourceLevel: MarketLevel | null;
  rr: number;
  /** True if the target was computed from a structural level; false if it fell back to fixed RR. */
  isStructural: boolean;
}

export interface EntryZoneResult {
  top: number;
  bottom: number;
  sourceLevel: MarketLevel | null;
}
