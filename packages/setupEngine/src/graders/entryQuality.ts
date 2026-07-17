import type { EvaluationContext, GraderResult, EntryZone } from "../types";

function zoneOverlapsOte(
  zone: EntryZone,
  pricing: EvaluationContext["pricing"]
): boolean {
  if (!pricing) return false;
  const oteLow = pricing.oteLow;
  const oteHigh = pricing.oteHigh;
  if (oteLow == null || oteHigh == null) return false;
  const low = Math.min(oteLow, oteHigh);
  const high = Math.max(oteLow, oteHigh);
  return zone.bottom <= high && zone.top >= low;
}

export function gradeEntryQuality(ctx: EvaluationContext): GraderResult {
  const reasons: string[] = [];

  const price = ctx.latestCandle?.c;
  const zones = ctx.zones;
  const pricing = ctx.pricing;

  if (!price) {
    return { score: 0, reasons: ["No latest price"], entryZone: null };
  }

  if (zones.length === 0) {
    return { score: 0, reasons: ["No active zones for entry"], entryZone: null };
  }

  // Pick nearest active zone aligned with direction.
  //
  // Retest zones (already tapped once but not invalidated) are valid ICT/SMC
  // entry candidates — they often produce the highest-quality setups because
  // the market has already confirmed the level by reacting to it. We rank
  // them below fresh zones but above invalidated ones.
  const relevantZones = zones
    .filter((z) => !z.invalidatedAt)
    .filter((z) => {
      if (ctx.direction === "long") return price >= z.bottom;
      if (ctx.direction === "short") return price <= z.top;
      return false;
    })
    .map((z) => {
      // Distance to nearest edge in price units.
      const dist =
        ctx.direction === "long" ? price - z.bottom : z.top - price;
      // Retest zones get a small distance penalty so fresh zones still win
      // when both are equally close.
      const isRetest = !!z.tapped;
      const adjustedDist = isRetest ? dist * 1.15 : dist;
      return { zone: z, dist: adjustedDist, isRetest };
    })
    .sort((a, b) => a.dist - b.dist);

  const picked = relevantZones[0];
  if (!picked) {
    return { score: 0, reasons: ["No zone aligned with current price/direction"], entryZone: null };
  }
  const zone = picked.zone;
  const isRetestZone = picked.isRetest;

  const entryZone: EntryZone = {
    top: zone.top,
    bottom: zone.bottom,
    zoneId: zone.id,
    zoneType: zone.type,
  };

  // For longs the zone is below price; for shorts it is above. Price is
  // considered "inside" the zone when it lies between top and bottom.
  const insideZone = price >= zone.bottom && price <= zone.top;

  // Distance to the nearest zone edge when price is outside the zone.
  const distanceToZone = insideZone
    ? 0
    : ctx.direction === "long"
    ? price - zone.top
    : zone.bottom - price;

  let score = 0;
  if (insideZone) {
    score += 40;
    reasons.push(`Price is inside ${zone.type} zone`);
  } else if (distanceToZone <= ctx.atr * 0.25) {
    score += 25;
    reasons.push("Price is within 0.25 ATR of zone");
  } else if (distanceToZone <= ctx.atr * 0.5) {
    score += 12;
    reasons.push("Price is within 0.5 ATR of zone");
  } else {
    reasons.push("Price is far from active zone");
  }

  const inOte = pricing?.inOte ?? false;
  const overlapsOte = zoneOverlapsOte(entryZone, pricing);

  if (inOte && overlapsOte) {
    score += 25;
    reasons.push("Price in OTE with zone confluence");
  } else if (inOte) {
    score += 10;
    reasons.push("Price in OTE but zone does not overlap OTE band");
  } else {
    reasons.push("Price outside OTE — consider waiting");
  }

  // Freshness scoring: fresh zones get full credit, retest zones get partial
  // credit (still a valid setup, but lower priority than first-touch).
  if (!zone.tapped) {
    score += 15;
    reasons.push("Zone is fresh (untapped)");
  } else {
    score += 8;
    reasons.push("Zone is a retest candidate (already tapped once)");
  }

  score = Math.min(100, Math.max(0, score));
  return { score, reasons, entryZone };
}
