/**
 * Zone Retest feature.
 * Detects when the latest candle interacts with an active supply/demand/FVG zone:
 *   - wick_into_zone: candle range intersects the zone
 *   - close_inside_zone: close is inside the zone
 *   - engulfing_at_zone: latest candle engulfs the previous candle while touching the zone
 */

import type { Candle, FeatureDefinition, ZoneOutput, ZoneRetestOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface ZoneRetestInput {
  candles: Candle[];
  features_zone: ZoneOutput;
}

function candleIntersectsZone(candle: Candle, zone: ZoneOutput["zones"][number]): boolean {
  return candle.h >= zone.bottom && candle.l <= zone.top;
}

function isBullishEngulfing(curr: Candle, prev: Candle): boolean {
  return (
    curr.o < prev.c &&
    curr.c > prev.o &&
    curr.c > curr.o &&
    curr.c >= prev.o &&
    curr.o <= prev.c
  );
}

function isBearishEngulfing(curr: Candle, prev: Candle): boolean {
  return (
    curr.o > prev.c &&
    curr.c < prev.o &&
    curr.c < curr.o &&
    curr.c <= prev.o &&
    curr.o >= prev.c
  );
}

function detectRetests(candles: Candle[], zones: ZoneOutput["zones"]): ZoneRetestOutput["retests"] {
  if (candles.length < 2 || zones.length === 0) return [];

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const retests: ZoneRetestOutput["retests"] = [];

  for (const zone of zones) {
    if (!candleIntersectsZone(last, zone)) continue;

    const wickInto = true;
    const closeInside = last.c >= zone.bottom && last.c <= zone.top;
    const engulfingAtZone =
      (isBullishEngulfing(last, prev) || isBearishEngulfing(last, prev)) && wickInto;
    const direction: ZoneRetestOutput["retests"][number]["direction"] =
      last.c > last.o ? "bullish" : last.c < last.o ? "bearish" : "neutral";

    retests.push({
      zoneKind: zone.zoneKind,
      top: zone.top,
      bottom: zone.bottom,
      wickInto,
      closeInside,
      engulfingAtZone,
      direction,
      ts: last.ts,
    });
  }

  return retests;
}

export const zoneRetestFeature: FeatureDefinition<ZoneRetestInput, ZoneRetestOutput> = {
  name: "features_zone_retest",
  version: "1.0.0",
  dependencies: ["features_zone"],

  compute(input): ZoneRetestOutput {
    const { candles } = input;
    const zones = (input.features_zone as ZoneOutput)?.zones ?? [];
    return { retests: detectRetests(candles, zones) };
  },

  hashInput(input): string {
    const zonePart = sha256(
      ((input.features_zone as ZoneOutput)?.zones ?? [])
        .map((z) => `${z.zoneKind}:${z.top}:${z.bottom}`)
        .join("|")
    );
    const candlePart = sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|")
    );
    return sha256(`${zonePart}:${candlePart}`);
  },

  hashOutput(output): string {
    return sha256(
      output.retests
        .map(
          (r) =>
            `${r.zoneKind}:${r.top}:${r.bottom}:${r.wickInto}:${r.closeInside}:${r.engulfingAtZone}:${r.direction}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.retests.map((r) => ({
      zone_kind: r.zoneKind,
      top: r.top,
      bottom: r.bottom,
      wick_into_zone: r.wickInto,
      close_inside_zone: r.closeInside,
      engulfing_at_zone: r.engulfingAtZone,
      direction: r.direction,
      ts: r.ts,
    }));
  },

  deserialize(rows): ZoneRetestOutput {
    return {
      retests: rows.map((r) => ({
        zoneKind: r.zone_kind as ZoneOutput["zones"][number]["zoneKind"],
        top: r.top as number,
        bottom: r.bottom as number,
        wickInto: r.wick_into_zone as boolean,
        closeInside: r.close_inside_zone as boolean,
        engulfingAtZone: r.engulfing_at_zone as boolean,
        direction: r.direction as ZoneRetestOutput["retests"][number]["direction"],
        ts: new Date(r.ts as string),
      })),
    };
  },
};
