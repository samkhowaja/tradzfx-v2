/**
 * Zone Quality Model (Zone Detection v2).
 *
 * Detects supply/demand zones and FVGs with stricter formation rules, then
 * scores them with a blend of:
 *   - learned historical outcome quality (reversal rate * R:R)
 *   - freshness
 *   - proximity to current price
 *   - HTF alignment
 *
 * Completed zone outcomes are recorded to `zone_outcomes` for continuous learning.
 */

import type {
  Candle,
  FeatureDefinition,
  ZoneOutput,
  Direction,
  PivotOutput,
  AtrOutput,
  HtfBiasOutput,
  StructureOutput,
  ZoneOutcomeStats,
  CanonicalMarketLevel,
} from "@tm/shared";
import { sha256, computeZoneLifecycle } from "@tm/shared";
import { recordZoneOutcome } from "@tm/shared";

export interface ZoneInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_htf_bias: HtfBiasOutput;
  features_structure: StructureOutput;
  /** Optional learned outcome stats (keyed by zone kind). When present and ZONE_USE_LEARNED_QUALITY is true they replace the heuristic quality score. */
  zoneOutcomeStats?: Record<string, ZoneOutcomeStats>;
}

const MIN_BODY_PCT = 0.6;
const MIN_VOLUME_RATIO = 1.2;
const MAX_AGE_BARS = 10; // pivot must be within this many bars
const USE_LEARNED_QUALITY = process.env.ZONE_USE_LEARNED_QUALITY === "true";

function getAtr14(atr: AtrOutput): number {
  return atr.values.find((v) => v.period === 14)?.value ?? 0;
}

function candleBody(c: Candle): { top: number; bottom: number } {
  return {
    top: Math.max(c.o, c.c),
    bottom: Math.min(c.o, c.c),
  };
}

function zoneBuffer(atr14: number): number {
  if (atr14 > 0) return atr14 * 0.1;
  return 0;
}

function averageVolume(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + (c.v ?? 0), 0) / candles.length;
}

function barMs(candles: Candle[]): number {
  if (candles.length < 2) return 60_000;
  return candles[1].ts.getTime() - candles[0].ts.getTime();
}

function findNearestPivot(
  pivots: PivotOutput["pivots"],
  kind: "high" | "low",
  ts: Date,
  maxBars: number,
  barDurationMs: number
): PivotOutput["pivots"][number] | undefined {
  let best: PivotOutput["pivots"][number] | undefined;
  let bestDist = Infinity;
  const maxMs = maxBars * barDurationMs;
  for (const p of pivots) {
    if (p.kind !== kind) continue;
    const dist = Math.abs(p.ts.getTime() - ts.getTime());
    if (dist <= maxMs && dist < bestDist) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

function classifyFormation(
  zoneKind: ZoneOutput["zones"][number]["zoneKind"],
  candle: Candle,
  prev: Candle | undefined
): ZoneOutput["zones"][number]["formation"] {
  if (zoneKind === "fvg") return "fvg";
  if (zoneKind === "breaker") return "breaker";

  const range = candle.h - candle.l;
  const bodyPct = range > 0 ? Math.abs(candle.c - candle.o) / range : 0;
  const engulfing =
    !!prev &&
    bodyPct > 0.5 &&
    ((candle.c > candle.o && candle.h > prev.h && candle.l < prev.l) ||
      (candle.c < candle.o && candle.h > prev.h && candle.l < prev.l));

  if (zoneKind === "demand") {
    if (engulfing) return "rbr";
    if (prev && candle.c > candle.o && candle.l > prev.l) return "rbr";
    if (prev && candle.c > candle.o && candle.l <= prev.l) return "dbu";
    return "other";
  }

  if (zoneKind === "supply") {
    if (engulfing) return "dbd";
    if (prev && candle.c < candle.o && candle.h < prev.h) return "dbd";
    if (prev && candle.c < candle.o && candle.h >= prev.h) return "rbd";
    return "other";
  }

  return "other";
}

function latestStructureDirection(events: StructureOutput["events"]): Direction | null {
  if (events.length === 0) return null;
  return events[events.length - 1].direction;
}

function isHtfAligned(zoneDirection: Direction | undefined, htf: HtfBiasOutput): boolean {
  if (!zoneDirection || htf.direction === "neutral") return false;
  return htf.direction === zoneDirection;
}

function computeZoneQuality(
  zone: ZoneOutput["zones"][number],
  candles: Candle[],
  zoneIndex: number,
  formingCandle: Candle,
  currentPrice: number,
  atr14: number,
  htf: HtfBiasOutput,
  structureEvents: StructureOutput["events"],
  outcomeStats?: ZoneOutcomeStats
): void {
  // Age: bars since zone formation
  zone.ageBars = candles.length - zoneIndex;

  // Freshness: not invalidated (tapped zones are still valid retest candidates)
  zone.isFresh = !zone.invalidatedAt;

  // Departure candles: strong impulse candles after zone
  let departures = 0;
  for (let i = zoneIndex + 1; i < candles.length; i++) {
    const c = candles[i];
    const body = Math.abs(c.c - c.o);
    const range = c.h - c.l;
    if (range > 0 && body / range > 0.6) departures++;
  }
  zone.departureCandles = departures;

  // Heuristic quality (0-1)
  const ageFactor = Math.max(0, 1 - (zone.ageBars ?? 0) / 50);
  const freshFactor = zone.isFresh ? 1 : 0.3;
  const departureFactor = Math.min(1, departures / 3);
  const widthFactor = zone.zoneKind === "fvg" ? 0.8 : 1.0;
  let baseQuality =
    ageFactor * 0.3 + freshFactor * 0.4 + departureFactor * 0.2 + widthFactor * 0.1;

  // Penalize FVGs that have neither structure nor HTF alignment.
  if (zone.zoneKind === "fvg" && !(zone as any).fvgAligned) {
    baseQuality *= 0.5;
  }

  // Penalize wide demand/supply zones that extend beyond the impulse body.
  if ((zone.zoneKind === "demand" || zone.zoneKind === "supply") && atr14 > 0) {
    const zoneHeight = zone.top - zone.bottom;
    if (zoneHeight > atr14 * 0.8) {
      baseQuality *= 0.7;
    }
  }

  // Learned quality from historical zone outcomes (only when explicitly enabled).
  let learnedQuality: number | null = null;
  if (USE_LEARNED_QUALITY && outcomeStats) {
    learnedQuality = Math.max(0, Math.min(1, (outcomeStats.expectancy + 1) / 2));
  }

  zone.qualityScore = learnedQuality ?? baseQuality;

  // Strength score: emphasizes the forming candle and departure follow-through
  const range = formingCandle.h - formingCandle.l;
  const bodyStrength = range > 0 ? Math.abs(formingCandle.c - formingCandle.o) / range : 0.5;
  zone.strengthScore = Math.min(
    1,
    bodyStrength * 0.3 + departureFactor * 0.25 + freshFactor * 0.25 + ageFactor * 0.1 + widthFactor * 0.1
  );

  // Proximity to current price (0-1, 1 = price is inside the zone)
  const zoneCenter = (zone.top + zone.bottom) / 2;
  const distance = Math.abs(currentPrice - zoneCenter);
  const proximity = atr14 > 0 ? Math.max(0, 1 - distance / (atr14 * 2)) : 0.5;

  // HTF alignment bonus
  const htfAlignment = isHtfAligned(zone.direction, htf) ? 1 : 0;

  // Final ranking score
  zone.rankScore =
    (zone.qualityScore ?? 0) * 0.4 +
    freshFactor * 0.25 +
    proximity * 0.2 +
    htfAlignment * 0.15;
}

function detectZones(input: ZoneInput): ZoneOutput["zones"] {
  const { candles, features_pivot, features_atr, features_htf_bias, features_structure } = input;
  const zones: ZoneOutput["zones"] = [];
  if (candles.length < 2) return zones;

  const atr14 = getAtr14(features_atr);
  const currentPrice = candles[candles.length - 1].c;
  const barDuration = barMs(candles);
  const structureDir = latestStructureDirection(features_structure.events);

  // Detect FVGs: 3-candle pattern where candle 1 and 3 don't overlap
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    const bullishFvg = c1.h < c3.l;
    const bearishFvg = c1.l > c3.h;

    if (bullishFvg) {
      const direction: Direction = "bullish";
      // Accept FVGs when either recent structure or HTF bias aligns. When
      // neither aligns we still keep the FVG but the quality score is reduced
      // in computeZoneQuality so the zone is ranked lower.
      const htfAligned = features_htf_bias.direction === direction;
      const structureAligned = structureDir === direction;
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "fvg",
        direction,
        top: c3.l,
        bottom: c1.h,
        fillPct: 0,
        tapped: false,
        ts: c3.ts,
        // Internal flag used by computeZoneQuality; not serialized by name.
        fvgAligned: htfAligned || structureAligned,
      } as any;
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "fvg", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      zone.formation = "fvg";
      zones.push(zone);
    }

    if (bearishFvg) {
      const direction: Direction = "bearish";
      const htfAligned = features_htf_bias.direction === direction;
      const structureAligned = structureDir === direction;
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "fvg",
        direction,
        top: c1.l,
        bottom: c3.h,
        fillPct: 0,
        tapped: false,
        ts: c3.ts,
        fvgAligned: htfAligned || structureAligned,
      } as any;
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "fvg", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      zone.formation = "fvg";
      zones.push(zone);
    }
  }

  // Detect supply/demand zones from strong impulse candles after pivots
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const prev = candles[i - 1];

    const body = Math.abs(candle.c - candle.o);
    const range = candle.h - candle.l;
    const bodyPct = range > 0 ? body / range : 0;

    if (bodyPct < MIN_BODY_PCT) continue;

    const avgVol = averageVolume(candles.slice(Math.max(0, i - 20), i));
    if (avgVol > 0 && (candle.v ?? 0) < avgVol * MIN_VOLUME_RATIO) continue;

    // Strong bullish candle after a low pivot = demand zone
    if (candle.c > candle.o) {
      const nearbyLow = findNearestPivot(features_pivot.pivots, "low", candle.ts, MAX_AGE_BARS, barDuration);
      if (!nearbyLow) continue; // require a nearby low pivot

      // Bound the zone by the impulse-candle body plus a small ATR buffer
      // instead of the full range / nearest pivot, which produced zones that
      // were far too wide.
      const body = candleBody(candle);
      const buffer = zoneBuffer(atr14);
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "demand",
        direction: "bullish",
        top: body.top + buffer,
        bottom: body.bottom - buffer,
        fillPct: 0,
        tapped: false,
        ts: candle.ts,
      };
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "demand", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction: "bullish" },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      zone.formation = classifyFormation("demand", candle, prev);
      zones.push(zone);
    }

    // Strong bearish candle after a high pivot = supply zone
    if (candle.c < candle.o) {
      const nearbyHigh = findNearestPivot(features_pivot.pivots, "high", candle.ts, MAX_AGE_BARS, barDuration);
      if (!nearbyHigh) continue;

      const body = candleBody(candle);
      const buffer = zoneBuffer(atr14);
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "supply",
        direction: "bearish",
        top: body.top + buffer,
        bottom: body.bottom - buffer,
        fillPct: 0,
        tapped: false,
        ts: candle.ts,
      };
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "supply", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction: "bearish" },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      zone.formation = classifyFormation("supply", candle, prev);
      zones.push(zone);
    }
  }

  return zones;
}

/**
 * Record completed zone outcomes to `zone_outcomes` for continuous learning.
 * Intended to be called by the DAG runner after the zone feature has been
 * persisted, so that `compute` stays pure and side-effect free.
 */
export async function recordZoneOutcomes(
  pool: import("@tm/shared").Pool,
  symbol: string,
  tf: string,
  zones: ZoneOutput["zones"],
  candles: Candle[]
): Promise<void> {
  if (process.env.ZONE_BACKFILL_SKIP_OUTCOMES === "1") return;
  for (const zone of zones) {
    if (!zone.mitigatedAt && !zone.invalidatedAt) continue;
    await recordZoneOutcome(pool, {
      symbol,
      tf,
      zoneKind: zone.zoneKind,
      top: zone.top,
      bottom: zone.bottom,
      formationTs: zone.ts,
      candles,
      mitigatedAt: zone.mitigatedAt,
      invalidatedAt: zone.invalidatedAt,
    });
  }
}

export const zoneFeature: FeatureDefinition<ZoneInput, ZoneOutput> = {
  name: "features_zone",
  version: "2.1.0",
  dependencies: ["features_pivot", "features_atr", "features_htf_bias", "features_structure"],

  compute(input): ZoneOutput {
    const zones = detectZones(input);
    const currentPrice = input.candles[input.candles.length - 1]?.c ?? 0;
    const atr14 = getAtr14(input.features_atr);
    const statsByKind = input.zoneOutcomeStats ?? {};

    for (const zone of zones) {
      const zoneIndex = input.candles.findIndex((c) => c.ts.getTime() === zone.ts.getTime());
      const formingCandle = input.candles[zoneIndex] ?? input.candles[input.candles.length - 1];
      computeZoneQuality(
        zone,
        input.candles,
        zoneIndex,
        formingCandle,
        currentPrice,
        atr14,
        input.features_htf_bias,
        input.features_structure.events,
        statsByKind[zone.zoneKind]
      );
    }

    zones.sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
    return { zones };
  },

  hashInput(input): string {
    let statsHash = "";
    if (USE_LEARNED_QUALITY && input.zoneOutcomeStats) {
      statsHash =
        "|stats=" +
        Object.entries(input.zoneOutcomeStats)
          .map(
            ([kind, s]) =>
              `${kind}:${s.sampleCount}:${s.expectancy.toFixed(4)}:${s.reversalRate.toFixed(4)}`
          )
          .join(",");
    }
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|") +
        "|" +
        input.features_atr.values.map((v) => `${v.period}=${v.value.toFixed(6)}`).join("|") +
        "|" +
        `${input.features_htf_bias.direction}:${input.features_htf_bias.confidence}:${input.features_htf_bias.score}` +
        "|" +
        input.features_structure.events
          .map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}`)
          .join("|") +
        statsHash
    );
  },

  hashOutput(output): string {
    return sha256(
      output.zones
        .map(
          (z) =>
            `${z.ts.toISOString()}:${z.zoneKind}:${z.top}:${z.bottom}:` +
            `${z.rankScore ?? 0}:${z.qualityScore ?? 0}:${z.outcome ?? ""}:` +
            `${z.mitigatedAt?.toISOString() ?? ""}:${z.invalidatedAt?.toISOString() ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.zones.map((z) => ({
      zone_kind: z.zoneKind,
      direction: z.direction ?? null,
      top: z.top,
      bottom: z.bottom,
      fill_pct: z.fillPct,
      tapped: z.tapped,
      ts: z.ts,
      age_bars: z.ageBars ?? null,
      departure_candles: z.departureCandles ?? null,
      is_fresh: z.isFresh ?? null,
      quality_score: z.qualityScore ?? null,
      formation: z.formation ?? null,
      strength_score: z.strengthScore ?? null,
      rank_score: z.rankScore ?? null,
      outcome: z.outcome ?? null,
      first_touch_at: z.firstTouchAt ?? null,
      mitigated_at: z.mitigatedAt ?? null,
      invalidated_at: z.invalidatedAt ?? null,
    }));
  },

  deserialize(rows): ZoneOutput {
    return {
      zones: rows.map((r) => ({
        zoneKind: r.zone_kind as "demand" | "supply" | "fvg" | "breaker" | "ifvg",
        top: r.top as number,
        bottom: r.bottom as number,
        fillPct: r.fill_pct as number,
        tapped: r.tapped as boolean,
        ts: new Date(r.ts as string),
        direction: r.direction as Direction | undefined,
        ageBars: r.age_bars as number | undefined,
        departureCandles: r.departure_candles as number | undefined,
        isFresh: r.is_fresh as boolean | undefined,
        qualityScore: r.quality_score as number | undefined,
        formation: r.formation as ZoneOutput["zones"][number]["formation"] | undefined,
        strengthScore: r.strength_score as number | undefined,
        rankScore: r.rank_score as number | undefined,
        outcome: r.outcome as ZoneOutput["zones"][number]["outcome"] | undefined,
        firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },

  publishLevels(output, context): CanonicalMarketLevel[] {
    const symbol = context?.symbol;
    const tf = context?.tf;
    if (!symbol || !tf) return [];
    return output.zones.map((z) => {
      let kind: CanonicalMarketLevel["kind"];
      if (z.zoneKind === "demand") kind = "demand";
      else if (z.zoneKind === "supply") kind = "supply";
      else if (z.direction === "bullish") kind = "bullish";
      else if (z.direction === "bearish") kind = "bearish";
      else kind = "demand";
      return {
        symbol,
        tf,
        level_type: "zone",
        kind,
        top: z.top,
        bottom: z.bottom,
        strength: z.rankScore ?? z.qualityScore ?? null,
        invalidated_at: z.invalidatedAt ?? null,
        tapped_at: z.firstTouchAt ?? null,
        touch_count: z.tapped ? 1 : 0,
        source_json: {
          zoneKind: z.zoneKind,
          formation: z.formation,
          direction: z.direction,
          strengthScore: z.strengthScore,
          qualityScore: z.qualityScore,
        },
        ts: z.ts,
      };
    });
  },
};
