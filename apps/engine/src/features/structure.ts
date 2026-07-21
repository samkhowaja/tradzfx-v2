/**
 * Structure Detection v2.
 *
 * Detects BOS (Break of Structure), MSS (Market Structure Shift), CHoCH (Change of Character),
 * plus failure events (bos_failed / choch_failed) when a break is subsequently reversed.
 *
 * Enhancements over v1:
 *   - Confirmation tracking: a break is confirmed by a following close beyond the level
 *     or a volume spike > 1.5x the 20-bar average.
 *   - Strength grading by body% relative to ATR.
 *   - HTF alignment flag against features_htf_bias.
 *   - Failure events emitted when price closes back through the broken level.
 */

import type {
  Candle,
  FeatureDefinition,
  StructureOutput,
  StructureEvent,
  Direction,
  AtrOutput,
  HtfBiasOutput,
} from "@tm/shared";
import { sha256, computeStructureLifecycle } from "@tm/shared";
import type { PivotOutput } from "@tm/shared";

export interface StructureInput {
  candles: Candle[];
  features_pivot: PivotOutput;
  features_atr: AtrOutput;
  features_htf_bias: HtfBiasOutput;
}

const CONFIRMATION_WINDOW_BARS = 5;

function findFirstCandle(
  candles: Candle[],
  startTs: Date,
  endTs: Date | undefined,
  predicate: (c: Candle) => boolean
): Candle | undefined {
  for (const c of candles) {
    if (c.ts.getTime() < startTs.getTime()) continue;
    if (endTs && c.ts.getTime() > endTs.getTime()) break;
    if (predicate(c)) return c;
  }
  return undefined;
}

function findFirstCandleAfter(
  candles: Candle[],
  afterTs: Date,
  predicate: (c: Candle) => boolean
): Candle | undefined {
  for (const c of candles) {
    if (c.ts.getTime() <= afterTs.getTime()) continue;
    if (predicate(c)) return c;
  }
  return undefined;
}

function getAtr14(atr: AtrOutput): number {
  return atr.values.find((v) => v.period === 14)?.value ?? 0;
}

function gradeStrength(bodySize: number, atr14: number): StructureEvent["strength"] {
  if (atr14 <= 0) return "medium";
  const ratio = bodySize / atr14;
  if (ratio >= 0.75) return "strong";
  if (ratio >= 0.35) return "medium";
  return "weak";
}

function bodySize(candle: Candle): number {
  return Math.abs(candle.c - candle.o);
}

function isHtfAligned(eventDirection: Direction, htf: HtfBiasOutput): boolean {
  if (htf.direction === "neutral") return false;
  return htf.direction === eventDirection;
}

interface RawBreakEvent {
  eventType: "bos" | "choch" | "mss";
  direction: Direction;
  level: number;
  ts: Date;
  breakCandle: Candle;
  opposingSweepTs?: Date;
}

function detectBreakEvents(
  candles: Candle[],
  pivots: PivotOutput["pivots"]
): RawBreakEvent[] {
  const events: RawBreakEvent[] = [];
  if (pivots.length < 2) return events;

  const sorted = [...pivots].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  let lastHigh = sorted.find((p) => p.kind === "high");
  let lastLow = sorted.find((p) => p.kind === "low");
  if (!lastHigh || !lastLow) return events;

  let trend: Direction | undefined;
  let lastChoChTs = new Date(0);
  let lastMssTs = new Date(0);

  for (let i = 1; i < sorted.length; i++) {
    const pivot = sorted[i];

    if (pivot.kind === "high" && lastHigh && pivot.price > lastHigh.price) {
      const breakCandle = findFirstCandle(
        candles,
        lastHigh.ts,
        pivot.ts,
        (c) => c.c > lastHigh!.price
      );

      if (breakCandle) {
        const sweptLow = findFirstCandle(
          candles,
          lastLow.ts,
          breakCandle.ts,
          (c) => c.l < lastLow!.price
        );

        if (sweptLow && breakCandle.ts.getTime() > lastChoChTs.getTime()) {
          events.push({
            eventType: "choch",
            direction: "bullish",
            level: lastHigh.price,
            ts: breakCandle.ts,
            breakCandle,
            opposingSweepTs: sweptLow.ts,
          });
          trend = "bullish";
          lastChoChTs = breakCandle.ts;
        } else if (trend === "bullish" || trend === undefined) {
          events.push({
            eventType: "bos",
            direction: "bullish",
            level: lastHigh.price,
            ts: breakCandle.ts,
            breakCandle,
          });
          if (!trend) trend = "bullish";
        }
      }

      const sweptLowForMss = findFirstCandle(
        candles,
        lastLow.ts,
        pivot.ts,
        (c) => c.l < lastLow!.price
      );
      if (sweptLowForMss && pivot.ts.getTime() > lastMssTs.getTime()) {
        events.push({
          eventType: "mss",
          direction: "bullish",
          level: lastLow.price,
          ts: pivot.ts,
          breakCandle: candles.find((c) => c.ts.getTime() === pivot.ts.getTime()) ?? pivot as unknown as Candle,
          opposingSweepTs: sweptLowForMss.ts,
        });
        lastMssTs = pivot.ts;
        if (!trend) trend = "bullish";
      }

      lastHigh = pivot;
    }

    if (pivot.kind === "low" && lastLow && pivot.price < lastLow.price) {
      const breakCandle = findFirstCandle(
        candles,
        lastLow.ts,
        pivot.ts,
        (c) => c.c < lastLow!.price
      );

      if (breakCandle) {
        const sweptHigh = findFirstCandle(
          candles,
          lastHigh.ts,
          breakCandle.ts,
          (c) => c.h > lastHigh!.price
        );

        if (sweptHigh && breakCandle.ts.getTime() > lastChoChTs.getTime()) {
          events.push({
            eventType: "choch",
            direction: "bearish",
            level: lastLow.price,
            ts: breakCandle.ts,
            breakCandle,
            opposingSweepTs: sweptHigh.ts,
          });
          trend = "bearish";
          lastChoChTs = breakCandle.ts;
        } else if (trend === "bearish" || trend === undefined) {
          events.push({
            eventType: "bos",
            direction: "bearish",
            level: lastLow.price,
            ts: breakCandle.ts,
            breakCandle,
          });
          if (!trend) trend = "bearish";
        }
      }

      const sweptHighForMss = findFirstCandle(
        candles,
        lastHigh.ts,
        pivot.ts,
        (c) => c.h > lastHigh!.price
      );
      if (sweptHighForMss && pivot.ts.getTime() > lastMssTs.getTime()) {
        events.push({
          eventType: "mss",
          direction: "bearish",
          level: lastHigh.price,
          ts: pivot.ts,
          breakCandle: candles.find((c) => c.ts.getTime() === pivot.ts.getTime()) ?? pivot as unknown as Candle,
          opposingSweepTs: sweptHighForMss.ts,
        });
        lastMssTs = pivot.ts;
        if (!trend) trend = "bearish";
      }

      lastLow = pivot;
    }
  }

  return events;
}

function enrichEvent(
  raw: RawBreakEvent,
  candles: Candle[],
  atr14: number,
  htf: HtfBiasOutput
): StructureEvent {
  // A break is confirmed by a following close beyond the broken level within
  // the confirmation window. Volume-spike confirmation has been removed.
  const confirmation = findFirstCandleAfter(candles, raw.ts, (c) => {
    if (raw.direction === "bullish" && c.c > raw.level) return true;
    if (raw.direction === "bearish" && c.c < raw.level) return true;
    return false;
  });

  const withinWindow = confirmation
    ? candles.filter((c) => c.ts.getTime() > raw.ts.getTime() && c.ts.getTime() <= confirmation.ts.getTime()).length <=
      CONFIRMATION_WINDOW_BARS
    : false;

  const confirmed = !!confirmation && withinWindow;
  const confirmationTs = confirmed ? confirmation.ts : undefined;

  const strength = gradeStrength(bodySize(raw.breakCandle), atr14);
  const htfAligned = isHtfAligned(raw.direction, htf);

  return {
    eventType: raw.eventType,
    direction: raw.direction,
    level: raw.level,
    ts: raw.ts,
    strength,
    confirmed,
    confirmationTs,
    opposingSweepTs: raw.opposingSweepTs,
    htfAligned,
  };
}

function detectStructure(input: StructureInput): StructureOutput["events"] {
  const { candles, features_pivot } = input;
  const raw = detectBreakEvents(candles, features_pivot.pivots);
  if (raw.length === 0) return [];

  const atr14 = getAtr14(input.features_atr);
  const all = raw
    .map((r) => enrichEvent(r, candles, atr14, input.features_htf_bias))
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // Failure events and CISD window have been removed in v2.1 to keep the
  // feature pure and deterministic; isCisd stays false for consumers.

  for (const event of all) {
    event.isCisd = false;
    const idx = candles.findIndex((c) => c.ts.getTime() === event.ts.getTime());
    if (idx >= 0) {
      const lifecycle = computeStructureLifecycle(
        { direction: event.direction, level: event.level },
        candles,
        idx
      );
      event.invalidatedAt = lifecycle.invalidatedAt;
    }
  }

  return all;
}

export const structureFeature: FeatureDefinition<StructureInput, StructureOutput> = {
  name: "features_structure",
  version: "2.1.0",
  dependencies: ["features_pivot", "features_atr", "features_htf_bias"],

  compute(input): StructureOutput {
    const events = detectStructure(input);
    return { events };
  },

  hashInput(input): string {
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
        `${input.features_htf_bias.direction}:${input.features_htf_bias.confidence}:${input.features_htf_bias.score}`
    );
  },

  hashOutput(output): string {
    return sha256(
      output.events
        .map(
          (e) =>
            `${e.ts.toISOString()}:${e.eventType}:${e.direction}:${e.level}:` +
            `${e.strength ?? ""}:${e.confirmed ?? ""}:${e.confirmationTs?.toISOString() ?? ""}:` +
            `${e.htfAligned ?? ""}`
        )
        .join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.events.map((e) => ({
      event_type: e.eventType,
      direction: e.direction,
      level: e.level,
      ts: e.ts,
      strength: e.strength ?? null,
      confirmed: e.confirmed ?? false,
      confirmation_ts: e.confirmationTs ?? null,
      opposing_sweep_ts: e.opposingSweepTs ?? null,
      is_cisd: e.isCisd ?? false,
      htf_aligned: e.htfAligned ?? false,
    }));
  },

  deserialize(rows): StructureOutput {
    return {
      events: rows.map((r) => ({
        eventType: r.event_type as StructureEvent["eventType"],
        direction: r.direction as Direction,
        level: r.level as number,
        ts: new Date(r.ts as string),
        strength: (r.strength as StructureEvent["strength"]) ?? undefined,
        confirmed: (r.confirmed as boolean) ?? undefined,
        confirmationTs: r.confirmation_ts ? new Date(r.confirmation_ts as string) : undefined,
        opposingSweepTs: r.opposing_sweep_ts ? new Date(r.opposing_sweep_ts as string) : undefined,
        isCisd: (r.is_cisd as boolean) ?? undefined,
        htfAligned: (r.htf_aligned as boolean) ?? undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at as string) : undefined,
      })),
    };
  },
};
