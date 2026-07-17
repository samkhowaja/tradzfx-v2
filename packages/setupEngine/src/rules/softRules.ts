import type { EvaluationContext } from "../types";

function zoneOverlapsOte(
  zone: { top: number; bottom: number } | null,
  pricing: EvaluationContext["pricing"]
): boolean {
  if (!zone || !pricing) return false;
  const oteLow = pricing.oteLow;
  const oteHigh = pricing.oteHigh;
  if (oteLow == null || oteHigh == null) return false;
  const low = Math.min(oteLow, oteHigh);
  const high = Math.max(oteLow, oteHigh);
  return zone.bottom <= high && zone.top >= low;
}

function isZoneAware(ctx: EvaluationContext): boolean {
  return ctx.setupFamily === "zone_reversal" || ctx.signalSource === "zone";
}

export function runSoftRules(ctx: EvaluationContext): string[] {
  const warnings: string[] = [];
  const zoneAware = isZoneAware(ctx);

  if (ctx.spreadPips > ctx.maxAllowedSpreadPips * 0.7) {
    warnings.push(`Spread ${ctx.spreadPips.toFixed(1)}p approaching limit`);
  }

  if (ctx.bias && ctx.bias.direction !== "neutral" && ctx.bias.direction !== ctx.direction) {
    warnings.push(`LTF bias (${ctx.bias.direction}) differs from setup direction (${ctx.direction})`);
  }

  if (zoneAware && !ctx.pricing?.inOte) {
    warnings.push("Price not in OTE zone - entry may be extended");
  } else if (zoneAware && !zoneOverlapsOte(ctx.entryZone, ctx.pricing)) {
    warnings.push("OTE band does not overlap the selected entry zone");
  }

  const freshZones = ctx.zones.filter((z) => !z.tapped);
  if (zoneAware && freshZones.length === 0) {
    warnings.push("No fresh untapped zones on this timeframe");
  }

  return warnings;
}
