import type { Candle, Direction } from "./types/feature";

export interface EventLifecycle {
  mitigatedAt?: Date;
  invalidatedAt?: Date;
}

function isDirection(d: Direction): d is "bullish" | "bearish" {
  return d === "bullish" || d === "bearish";
}

/**
 * Find the first candle after `fromIndex` whose range intersects a price band.
 */
export function findBandMitigation(
  candles: Candle[],
  fromIndex: number,
  top: number,
  bottom: number
): Date | undefined {
  for (let i = fromIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    if (c.h >= bottom && c.l <= top) {
      return c.ts;
    }
  }
  return undefined;
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
 * Mitigation = first touch. Invalidation = close beyond the far side.
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
  // Determine direction for invalidation.
  let direction: "bullish" | "bearish" | undefined;
  if (zone.direction && isDirection(zone.direction)) {
    direction = zone.direction;
  } else if (zone.zoneKind === "demand") {
    direction = "bullish";
  } else if (zone.zoneKind === "supply") {
    direction = "bearish";
  } else {
    // FVG / breaker / ifvg: default to bullish. Caller can override via direction.
    direction = "bullish";
  }

  const mitigatedAt = findBandMitigation(candles, fromIndex, zone.top, zone.bottom);
  const invalidatedAt = findBandInvalidation(
    candles,
    fromIndex,
    zone.top,
    zone.bottom,
    direction
  );

  // If invalidated before any mitigation, the zone was never tested.
  if (invalidatedAt && mitigatedAt && invalidatedAt < mitigatedAt) {
    return { invalidatedAt };
  }

  return { mitigatedAt, invalidatedAt };
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
    return { invalidatedAt };
  }

  return { mitigatedAt, invalidatedAt };
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
): { mitigatedAt?: Date } {
  if (!isDirection(sweep.direction)) return {};
  const mitigatedAt = findCloseCross(
    candles,
    fromIndex,
    sweep.level,
    sweep.direction
  );
  return { mitigatedAt };
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
