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
 * Returns both the timestamp and the deepest fill percentage reached up to that
 * point. Fill percentage is normalized to [0, 1] relative to the band height.
 */
export function findBandFirstTouch(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number,
  direction: "bullish" | "bearish"
): { ts?: Date; fillPct: number } {
  let firstTouchAt: Date | undefined;
  let deepest = 0;
  const height = top - bottom;
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h >= bottom && c.l <= top) {
      if (!firstTouchAt) firstTouchAt = c.ts;
      if (height > 0) {
        const penetration =
          direction === "bullish"
            ? Math.max(0, Math.min(top, c.h) - bottom) // price entering from top down
            : Math.max(0, top - Math.max(bottom, c.l)); // price entering from bottom up
        deepest = Math.max(deepest, penetration);
      }
    }
  }
  const fillPct = height > 0 ? Math.min(1, deepest / height) : 0;
  return { ts: firstTouchAt, fillPct };
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
 * Compute lifecycle for a supply/demand/FVG zone.
 *
 * Semantics:
 * - firstTouchAt: first wick/body intersection (informational; used for retest logic).
 * - mitigatedAt: first wick/body intersection (kept for backward compatibility).
 * - invalidatedAt: close beyond the far side.
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

  const { ts: firstTouchAt, fillPct } = findBandFirstTouch(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction
  );
  const invalidatedAt = findBandInvalidation(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction
  );

  return { firstTouchAt, mitigatedAt: firstTouchAt, invalidatedAt, fillPct };
}

/**
 * Compute lifecycle for an inverse FVG.
 * Mitigation = price closes beyond the iFVG in the iFVG direction (it fails as S/R).
 * Invalidation = price closes beyond the far side (it holds and is confirmed).
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

  const mitigatedAt = findBandInvalidation(
    candles,
    fromIndex,
    ifvg.top,
    ifvg.bottom,
    ifvg.direction
  );

  const invalidDirection: "bullish" | "bearish" =
    ifvg.direction === "bullish" ? "bearish" : "bullish";
  const invalidatedAt = findBandInvalidation(
    candles,
    fromIndex,
    ifvg.top,
    ifvg.bottom,
    invalidDirection
  );

  if (invalidatedAt && mitigatedAt && invalidatedAt < mitigatedAt) {
    return { firstTouchAt, invalidatedAt, fillPct };
  }

  return { firstTouchAt, mitigatedAt, invalidatedAt, fillPct };
}

/**
 * Compute lifecycle for a liquidity sweep.
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
  const firstTouchAt = findCloseCross(
    candles,
    fromIndex,
    sweep.level,
    sweep.direction
  );
  return { firstTouchAt, mitigatedAt: firstTouchAt };
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
