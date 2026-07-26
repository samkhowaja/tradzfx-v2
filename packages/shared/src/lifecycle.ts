import type { Candle, Direction } from "./types/feature";

export interface EventLifecycle {
  firstTouchAt?: Date;
  mitigatedAt?: Date;
  invalidatedAt?: Date;
  fillPct?: number;
}

function isDirection(d: Direction): d is "bullish" | "bearish" {
  return d === "bullish" || d === "bearish";
}

/**
 * Find the first candle after `fromIndex` whose range intersects a price band.
 * Returns both the timestamp and the fill percentage at that specific candle.
 * Fill percentage is normalized to [0, 1] relative to the band height.
 */
export function findBandFirstTouch(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number,
  direction: "bullish" | "bearish"
): { ts?: Date; fillPct: number } {
  const height = top - bottom;
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h >= bottom && c.l <= top) {
      if (height > 0) {
        const penetration =
          direction === "bullish"
            ? Math.max(0, top - Math.max(bottom, c.l)) // price entering from top down
            : Math.max(0, Math.min(top, c.h) - bottom); // price entering from bottom up
        const fillPct = Math.min(1, penetration / height);
        return { ts: c.ts, fillPct };
      }
      return { ts: c.ts, fillPct: 0 };
    }
  }
  return { ts: undefined, fillPct: 0 };
}

/**
 * Find the first candle after `fromIndex` that achieves at least `minFillPct`
 * penetration of the price band. Returns the timestamp when that threshold
 * is first reached.
 */
export function findBandFillThreshold(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number,
  direction: "bullish" | "bearish",
  minFillPct: number
): Date | undefined {
  const height = top - bottom;
  if (height <= 0) return undefined;
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h >= bottom && c.l <= top) {
      const penetration =
        direction === "bullish"
          ? Math.max(0, top - Math.max(bottom, c.l))
          : Math.max(0, Math.min(top, c.h) - bottom);
      const fillPct = penetration / height;
      if (fillPct >= minFillPct) return c.ts;
    }
  }
  return undefined;
}

/** Return deepest post-formation band penetration available in `candles`. */
export function findBandMaxFill(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number,
  direction: "bullish" | "bearish"
): number {
  const height = top - bottom;
  if (height <= 0) return 0;
  let maxFillPct = 0;
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h < bottom || c.l > top) continue;
    const penetration =
      direction === "bullish"
        ? Math.max(0, top - Math.max(bottom, c.l))
        : Math.max(0, Math.min(top, c.h) - bottom);
    maxFillPct = Math.max(maxFillPct, Math.min(1, penetration / height));
  }
  return maxFillPct;
}

/**
 * Find the first candle after `fromIndex` that closes beyond the band
 * in the invalidating direction.
 * - direction = "bullish": invalidated when close < bottom.
 * - direction = "bearish": invalidated when close > top.
 */
export function findBandInvalidation(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number,
  direction: "bullish" | "bearish"
): Date | undefined {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === "bullish" && c.c < bottom) return c.ts;
    if (direction === "bearish" && c.c > top) return c.ts;
  }
  return undefined;
}

/**
 * Find the first candle after `fromIndex` whose close crosses `level`
 * in the given direction.
 * direction = "bullish" means close > level; "bearish" means close < level.
 */
export function findCloseCross(
  candles: Candle[],
  fromIndex: number,
  level: number,
  direction: "bullish" | "bearish"
): Date | undefined {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === "bullish" && c.c > level) return c.ts;
    if (direction === "bearish" && c.c < level) return c.ts;
  }
  return undefined;
}

/**
 * Count how many candles after `fromIndex` intersect the zone band
 * [bottom, top]. Returns:
 *   - touchCount:  total intersecting candles (wick or body)
 *   - retestCount: intersecting candles that occurred AFTER the first touch
 *                  (i.e. the zone has been re-tested at least once)
 *
 * Used by Track B (D013) to score retest zones vs fresh zones. A zone with
 * touchCount = 1 is a "first touch" candidate; touchCount >= 2 means the
 * market has come back to test the level again — a high-quality ICT/SMC
 * entry signal.
 */
export function countZoneTouches(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number
): { touchCount: number; retestCount: number } {
  let touchCount = 0;
  let firstTouchSeen = false;
  let retestCount = 0;
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h >= bottom && c.l <= top) {
      touchCount++;
      if (firstTouchSeen) retestCount++;
      else firstTouchSeen = true;
    }
  }
  return { touchCount, retestCount };
}

/**
 * Find the first candle after `fromIndex` whose close is inside the band
 * [bottom, top]. Used for classic FVG invalidation: an FVG is no longer fresh
 * as soon as price closes back inside the gap.
 */
function findBandCloseInside(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number
): Date | undefined {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.c >= bottom && c.c <= top) return c.ts;
  }
  return undefined;
}

/**
 * Compute lifecycle for a supply/demand/FVG zone.
 *
 * Semantics:
 * - firstTouchAt: first wick/body intersection (informational; used for retest logic).
 * - mitigatedAt: first wick/body intersection (kept for backward compatibility).
 * - invalidatedAt: close beyond the far side (demand/supply) OR close inside the gap (FVG).
 * - fillPct: deepest penetration into the zone as a ratio of zone height.
 *
 * A zone is considered "fresh" for PIT/live trading as long as it has not been
 * invalidated; first-touch / mitigated rows are still valid retest candidates.
 */
export function computeZoneLifecycle(
  zone: {
    zoneKind: string;
    top: number;
    bottom: number;
    ts: Date;
    direction?: Direction;
  },
  candles: Candle[],
  fromIndex: number
): EventLifecycle {
  let direction: "bullish" | "bearish" | undefined;
  if (zone.direction && isDirection(zone.direction)) {
    direction = zone.direction;
  } else if (zone.zoneKind === "demand") {
    direction = "bullish";
  } else if (zone.zoneKind === "supply") {
    direction = "bearish";
  } else {
    direction = "bullish";
  }

  const { ts: firstTouchAt } = findBandFirstTouch(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction
  );
  const fillPct = findBandMaxFill(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction
  );
  const invalidatedAt =
    zone.zoneKind === "fvg"
      ? findBandCloseInside(candles, fromIndex, zone.top, zone.bottom)
      : findBandInvalidation(candles, fromIndex, zone.top, zone.bottom, direction);

  // Only mark as mitigated if price has penetrated >=50% of zone depth (significant fill)
  // or if invalidated (close beyond far side). First touch alone is NOT mitigation.
  const mitigatedAt = findBandFillThreshold(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction,
    0.5
  ) ?? invalidatedAt;

  return { firstTouchAt, mitigatedAt, invalidatedAt, fillPct };
}

/**
 * Compute lifecycle for an inverse FVG (iFVG).
 *
 * iFVG = a filled FVG that reversed and confirmed outside the far side.
 * The original FVG gap area becomes a static S/R level.
 *
 * - firstTouchAt: first wick/body intersection with the gap area.
 * - mitigatedAt: first time price fills ≥ 50 % into the gap (original FVG filled).
 * - invalidatedAt: the level is breached.
 *   Bullish iFVG (support): close < bottom.
 *   Bearish iFVG (resistance): close > top.
 * - is_fresh: true until invalidated.
 *
 * CRITICAL: Invalidation uses the same direction as the iFVG (not opposite).
 * The old code erroneously used opposite-direction close (= the confirmation
 * candle) as invalidation, which made every iFVG born already "invalidated"
 * (0 / 1,484 fresh at 5m XAUUSD).
 */
export function computeIfvgLifecycle(
  ifvg: {
    direction: Direction;
    top: number;
    bottom: number;
  },
  candles: Candle[],
  fromIndex: number
): EventLifecycle {
  if (!isDirection(ifvg.direction)) return {};

  const { ts: firstTouchAt, fillPct } = findBandFirstTouch(
    candles,
    fromIndex,
    ifvg.top,
    ifvg.bottom,
    ifvg.direction
  );

  // Mitigation = fill ≥ 50 % into the gap (original FVG filled).
  const mitigatedAt = findBandFillThreshold(
    candles,
    fromIndex,
    ifvg.top,
    ifvg.bottom,
    ifvg.direction,
    0.5
  );

  // Invalidation = level breach in iFVG direction (NOT opposite direction).
  // Bullish → close < bottom (support broken).
  // Bearish → close > top (resistance broken).
  const invalidatedAt = findBandInvalidation(
    candles,
    fromIndex,
    ifvg.top,
    ifvg.bottom,
    ifvg.direction
  );

  if (invalidatedAt && mitigatedAt && invalidatedAt < mitigatedAt) {
    // Level broken before 50 % fill — iFVG never properly formed.
    return { firstTouchAt, invalidatedAt, fillPct };
  }

  return { firstTouchAt, mitigatedAt, invalidatedAt, fillPct };
}

/**
 * Find the first candle after `fromIndex` whose wick crosses `level`
 * in the given direction.
 * direction = "bullish" means high > level (wick above); "bearish" means low < level.
 */
function findWickTouch(
  candles: Candle[],
  fromIndex: number,
  level: number,
  direction: "bullish" | "bearish"
): Date | undefined {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (direction === "bullish" && c.h > level) return c.ts;
    if (direction === "bearish" && c.l < level) return c.ts;
  }
  return undefined;
}

/**
 * Compute lifecycle for a liquidity sweep.
 * firstTouchAt = first wick piercing beyond the swept level (not close cross).
 * Mitigation = price later closes beyond the swept level in the sweep direction.
 */
export function computeSweepLifecycle(
  sweep: {
    direction: Direction;
    level: number;
  },
  candles: Candle[],
  fromIndex: number
): { firstTouchAt?: Date; mitigatedAt?: Date } {
  if (!isDirection(sweep.direction)) return {};
  const firstTouchAt = findWickTouch(
    candles,
    fromIndex,
    sweep.level,
    sweep.direction
  );
  const mitigatedAt = findCloseCross(
    candles,
    fromIndex,
    sweep.level,
    sweep.direction
  );
  return { firstTouchAt, mitigatedAt };
}

/**
 * Compute lifecycle for a structure event.
 * Invalidation = price closes beyond the broken level in the opposite direction.
 */
export function computeStructureLifecycle(
  event: {
    direction: Direction;
    level: number;
  },
  candles: Candle[],
  fromIndex: number
): { invalidatedAt?: Date } {
  if (!isDirection(event.direction)) return {};
  const opposite: "bullish" | "bearish" =
    event.direction === "bullish" ? "bearish" : "bullish";
  const invalidatedAt = findCloseCross(
    candles,
    fromIndex,
    event.level,
    opposite
  );
  return { invalidatedAt };
}
