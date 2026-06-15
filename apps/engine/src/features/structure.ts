/**
 * Structure feature.
 * Detects BOS (Break of Structure), MSS (Market Structure Shift), CHoCH (Change of Character).
 */

import type { Candle, FeatureDefinition, StructureOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface StructureInput {
  candles: Candle[];
  features_pivot: PivotOutput;
}

function detectStructure(
  candles: Candle[],
  pivots: PivotOutput["pivots"]
): StructureOutput["events"] {
  const events: StructureOutput["events"] = [];
  if (pivots.length < 2) return events;

  // Sort pivots by time
  const sorted = [...pivots].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  let lastHigh = sorted.find((p) => p.kind === "high");
  let lastLow = sorted.find((p) => p.kind === "low");

  // Track sweeps for CISD detection
  const sweeps: Array<{ direction: Direction; level: number; ts: Date }> = [];

  for (let i = 1; i < sorted.length; i++) {
    const pivot = sorted[i];
    const prevPivot = sorted[i - 1];

    // BOS: price breaks previous high/low in trend direction
    if (pivot.kind === "high" && lastHigh && pivot.price > lastHigh.price) {
      const breakCandle = candles.find((c) => c.ts >= pivot.ts && c.c > lastHigh!.price);
      if (breakCandle) {
        events.push({
          eventType: "bos",
          direction: "bullish",
          level: lastHigh.price,
          ts: breakCandle.ts,
        });
      }
      lastHigh = pivot;
    }

    if (pivot.kind === "low" && lastLow && pivot.price < lastLow.price) {
      const breakCandle = candles.find((c) => c.ts >= pivot.ts && c.c < lastLow!.price);
      if (breakCandle) {
        events.push({
          eventType: "bos",
          direction: "bearish",
          level: lastLow.price,
          ts: breakCandle.ts,
        });
      }
      lastLow = pivot;
    }

    // MSS: previous swing gets taken out, then structure breaks opposite
    if (pivot.kind === "high" && lastLow) {
      const tookOutLow = candles.some((c) => c.l < lastLow!.price && c.ts > lastLow!.ts);
      if (tookOutLow && pivot.price > prevPivot.price) {
        events.push({
          eventType: "mss",
          direction: "bullish",
          level: lastLow.price,
          ts: pivot.ts,
        });
        sweeps.push({ direction: "bearish", level: lastLow.price, ts: lastLow.ts });
      }
    }

    if (pivot.kind === "low" && lastHigh) {
      const tookOutHigh = candles.some((c) => c.h > lastHigh!.price && c.ts > lastHigh!.ts);
      if (tookOutHigh && pivot.price < prevPivot.price) {
        events.push({
          eventType: "mss",
          direction: "bearish",
          level: lastHigh.price,
          ts: pivot.ts,
        });
        sweeps.push({ direction: "bullish", level: lastHigh.price, ts: lastHigh.ts });
      }
    }
  }

  // CISD detection: a sweep followed by structure break in opposite direction
  for (const event of events) {
    if (event.eventType === "mss") {
      const priorSweep = sweeps.find(
        (s) =>
          s.ts < event.ts &&
          Math.abs(s.ts.getTime() - event.ts.getTime()) < 30 * 60 * 1000 &&
          s.direction !== event.direction
      );
      event.isCisd = !!priorSweep;
    } else {
      event.isCisd = false;
    }
  }

  return events;
}

export const structureFeature: FeatureDefinition<StructureInput, StructureOutput> = {
  name: "features_structure",
  version: "1.0.0",
  dependencies: ["features_pivot"],

  compute(input): StructureOutput {
    return { events: detectStructure(input.candles, input.features_pivot.pivots) };
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
      output.events.map((e) => `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.events.map((e) => ({
      event_type: e.eventType,
      direction: e.direction,
      level: e.level,
      ts: e.ts,
      is_cisd: e.isCisd ?? false,
    }));
  },

  deserialize(rows): StructureOutput {
    return {
      events: rows.map((r) => ({
        eventType: r.event_type as "bos" | "mss" | "choch",
        direction: r.direction as Direction,
        level: r.level as number,
        ts: new Date(r.ts as string),
        isCisd: r.is_cisd as boolean | undefined,
      })),
    };
  },
};
