/**
 * Zone feature.
 * Detects supply/demand zones and Fair Value Gaps (FVGs).
 */

import type { Candle, FeatureDefinition, ZoneOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";
import { computeZoneLifecycle } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface ZoneInput {
  candles: Candle[];
  features_pivot: PivotOutput;
}

function classifyFormation(
  zoneKind: ZoneOutput["zones"][number]["zoneKind"],
  candle: Candle,
  prev: Candle | undefined,
  pivots: PivotOutput["pivots"]
): ZoneOutput["zones"][number]["formation"] {
  if (zoneKind === "fvg") return "fvg";
  if (zoneKind === "breaker") return "breaker";

  // Demand zone
  if (zoneKind === "demand") {
    if (prev && candle.c > candle.o && candle.l > prev.l) return "rbr";
    if (prev && candle.c > candle.o && candle.l <= prev.l) return "dbu";
    return "other";
  }

  // Supply zone
  if (zoneKind === "supply") {
    if (prev && candle.c < candle.o && candle.h < prev.h) return "dbd";
    if (prev && candle.c < candle.o && candle.h >= prev.h) return "rbd";
    return "other";
  }

  return "other";
}

function computeZoneQuality(
  zone: ZoneOutput["zones"][number],
  candles: Candle[],
  zoneIndex: number,
  formingCandle?: Candle
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

  // Quality score: composite (0-1)
  const ageFactor = Math.max(0, 1 - (zone.ageBars ?? 0) / 50);
  const freshFactor = zone.isFresh ? 1 : 0.3;
  const departureFactor = Math.min(1, departures / 3);
  const widthFactor = zone.zoneKind === "fvg" ? 0.8 : 1.0;
  zone.qualityScore = (ageFactor * 0.3 + freshFactor * 0.4 + departureFactor * 0.2 + widthFactor * 0.1);

  // Strength score: emphasizes the forming candle and departure follow-through
  let bodyStrength = 0.5;
  if (formingCandle) {
    const range = formingCandle.h - formingCandle.l;
    bodyStrength = range > 0 ? Math.abs(formingCandle.c - formingCandle.o) / range : 0.5;
  }
  zone.strengthScore = Math.min(1,
    bodyStrength * 0.3 +
    departureFactor * 0.25 +
    freshFactor * 0.25 +
    ageFactor * 0.1 +
    widthFactor * 0.1
  );
}

function detectZones(
  candles: Candle[],
  pivots: PivotOutput["pivots"]
): ZoneOutput["zones"] {
  const zones: ZoneOutput["zones"] = [];

  // Detect FVGs: 3-candle pattern where candle 1 and 3 don't overlap
  for (let i = 2; i < candles.length; i++) {
    const c1 = candles[i - 2];
    const c2 = candles[i - 1];
    const c3 = candles[i];

    // Bullish FVG: c1.high < c3.low
    if (c1.h < c3.l) {
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "fvg",
        direction: "bullish",
        top: c3.l,
        bottom: c1.h,
        fillPct: 0,
        tapped: false,
        ts: c3.ts,
      };
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "fvg", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction: "bullish" },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      computeZoneQuality(zone, candles, i, c3);
      zone.formation = "fvg";
      zones.push(zone);
    }

    // Bearish FVG: c1.low > c3.high
    if (c1.l > c3.h) {
      const zone: ZoneOutput["zones"][number] = {
        zoneKind: "fvg",
        direction: "bearish",
        top: c1.l,
        bottom: c3.h,
        fillPct: 0,
        tapped: false,
        ts: c3.ts,
      };
      const lifecycle = computeZoneLifecycle(
        { zoneKind: "fvg", top: zone.top, bottom: zone.bottom, ts: zone.ts, direction: "bearish" },
        candles,
        i
      );
      zone.firstTouchAt = lifecycle.firstTouchAt;
      zone.mitigatedAt = lifecycle.mitigatedAt;
      zone.invalidatedAt = lifecycle.invalidatedAt;
      zone.fillPct = lifecycle.fillPct ?? 0;
      zone.tapped = !!lifecycle.firstTouchAt;
      computeZoneQuality(zone, candles, i, c3);
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

    // Strong bullish candle after a low pivot = demand zone
    if (bodyPct > 0.6 && candle.c > candle.o) {
      const nearbyLow = pivots.find(
        (p) => p.kind === "low" && Math.abs(p.ts.getTime() - candle.ts.getTime()) < 300_000
      );
      if (nearbyLow) {
        const zone: ZoneOutput["zones"][number] = {
          zoneKind: "demand",
          direction: "bullish",
          top: candle.h,
          bottom: nearbyLow.price,
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
        computeZoneQuality(zone, candles, i, candle);
        zone.formation = classifyFormation("demand", candle, prev, pivots);
        zones.push(zone);
      }
    }

    // Strong bearish candle after a high pivot = supply zone
    if (bodyPct > 0.6 && candle.c < candle.o) {
      const nearbyHigh = pivots.find(
        (p) => p.kind === "high" && Math.abs(p.ts.getTime() - candle.ts.getTime()) < 300_000
      );
      if (nearbyHigh) {
        const zone: ZoneOutput["zones"][number] = {
          zoneKind: "supply",
          direction: "bearish",
          top: nearbyHigh.price,
          bottom: candle.l,
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
        computeZoneQuality(zone, candles, i, candle);
        zone.formation = classifyFormation("supply", candle, prev, pivots);
        zones.push(zone);
      }
    }
  }

  return zones;
}

export const zoneFeature: FeatureDefinition<ZoneInput, ZoneOutput> = {
  name: "features_zone",
  version: "1.2.0",
  dependencies: ["features_pivot"],

  compute(input): ZoneOutput {
    return { zones: detectZones(input.candles, input.features_pivot.pivots) };
  },

  hashInput(input): string {
    return sha256(
      input.candles
        .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`)
        .join("|") +
        "|" +
        input.features_pivot.pivots
          .map((p) => `${p.ts.toISOString()}:${p.kind}:${p.price}`)
          .join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.zones
        .map(
          (z) =>
            `${z.ts.toISOString()}:${z.zoneKind}:${z.top}:${z.bottom}:${z.mitigatedAt?.toISOString() ?? ""}:${z.invalidatedAt?.toISOString() ?? ""}`
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
      first_touch_at: z.firstTouchAt ?? null,
      mitigated_at: z.mitigatedAt ?? null,
      invalidated_at: z.invalidatedAt ?? null,
    }));
  },

  deserialize(rows): ZoneOutput {
    return {
      zones: rows.map((r) => ({
        zoneKind: r.zone_kind as "demand" | "supply" | "fvg" | "breaker",
        top: r.top as number,
        bottom: r.bottom as number,
        fillPct: r.fill_pct as number,
        tapped: r.tapped as boolean,
        ts: new Date(r.ts as string),
        ageBars: r.age_bars as number | undefined,
        departureCandles: r.departure_candles as number | undefined,
        isFresh: r.is_fresh as boolean | undefined,
        qualityScore: r.quality_score as number | undefined,
        formation: r.formation as ZoneOutput["zones"][number]["formation"] | undefined,
        strengthScore: r.strength_score as number | undefined,
        firstTouchAt: r.first_touch_at ? new Date(r.first_touch_at as string) : undefined,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at as string) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },
};
