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

  // Pick nearest active zone aligned with direction
  const relevantZones = zones
    .filter((z) => !z.tapped)
    .filter((z) => {
      if (ctx.direction === "long") return price >= z.bottom;
      if (ctx.direction === "short") return price <= z.top;
      return false;
    })
    .sort((a, b) => {
      const distA = ctx.direction === "long" ? price - a.bottom : a.top - price;
      const distB = ctx.direction === "long" ? price - b.bottom : b.top - price;
      return distA - distB;
    });

  const zone = relevantZones[0];
  if (!zone) {
    return { score: 0, reasons: ["No zone aligned with current price/direction"], entryZone: null };
  }

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

  const fresh = !zone.tapped;
  if (fresh) {
    score += 15;
    reasons.push("Zone is untapped");
  }

  score = Math.min(100, Math.max(0, score));
  return { score, reasons, entryZone };
}
