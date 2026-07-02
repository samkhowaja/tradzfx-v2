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
const VOLUME_SPIKE_RATIO = 1.5;

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

function averageVolume(candles: Candle[]): number {
  if (candles.length === 0) return 0;
  return candles.reduce((s, c) => s + (c.v ?? 0), 0) / candles.length;
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
  const confirmation = findFirstCandleAfter(
    candles,
    raw.ts,
    (c) => {
      if (raw.direction === "bullish" && c.c > raw.level) return true;
      if (raw.direction === "bearish" && c.c < raw.level) return true;
      const recent = candles.filter((x) => x.ts.getTime() < c.ts.getTime()).slice(-20);
      const avg = averageVolume(recent);
      if (avg > 0 && (c.v ?? 0) >= avg * VOLUME_SPIKE_RATIO) return true;
      return false;
    }
  );

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

function detectFailures(
  enriched: StructureEvent[],
  candles: Candle[]
): StructureEvent[] {
  const failures: StructureEvent[] = [];

  for (const event of enriched) {
    if (event.eventType !== "bos" && event.eventType !== "choch") continue;

    const failCandle = findFirstCandleAfter(candles, event.ts, (c) => {
      if (event.direction === "bullish" && c.c < event.level) return true;
      if (event.direction === "bearish" && c.c > event.level) return true;
      return false;
    });

    if (failCandle) {
      failures.push({
        eventType: event.eventType === "bos" ? "bos_failed" : "choch_failed",
        direction: event.direction,
        level: event.level,
        ts: failCandle.ts,
        strength: event.strength,
        confirmed: false,
        htfAligned: event.htfAligned,
      });
    }
  }

  return failures;
}

function detectStructure(input: StructureInput): StructureOutput["events"] {
  const { candles, features_pivot } = input;
  const raw = detectBreakEvents(candles, features_pivot.pivots);
  if (raw.length === 0) return [];

  const atr14 = getAtr14(input.features_atr);
  const enriched = raw.map((r) => enrichEvent(r, candles, atr14, input.features_htf_bias));
  const failures = detectFailures(enriched, candles);

  const all = [...enriched, ...failures].sort((a, b) => a.ts.getTime() - b.ts.getTime());

  // CISD detection: a sweep followed by structure break in opposite direction
  for (const event of all) {
    if (event.eventType === "mss" || event.eventType === "choch") {
      const priorSweepDirection = event.direction === "bullish" ? "bearish" : "bullish";
      const priorSweep = all.find(
        (e) =>
          (e.eventType === "mss" || e.eventType === "choch") &&
          e.direction === priorSweepDirection &&
          e.ts < event.ts &&
          event.ts.getTime() - e.ts.getTime() < 30 * 60 * 1000
      );
      event.isCisd = !!priorSweep;
      if (priorSweep) {
        event.opposingSweepTs = priorSweep.ts;
      }
    } else {
      event.isCisd = false;
    }
  }

  // Lifecycle invalidation
  for (const event of all) {
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
  version: "2.0.0",
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
            `${e.htfAligned ?? ""}:${e.invalidatedAt?.toISOString() ?? ""}`
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
      invalidated_at: e.invalidatedAt ?? null,
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
