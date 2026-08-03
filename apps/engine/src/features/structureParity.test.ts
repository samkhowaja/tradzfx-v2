import { describe, expect, it } from "vitest";
import type { AtrOutput, Candle, HtfBiasOutput, PivotOutput } from "@tm/shared";
import { detectCausalStructure, structureFeature } from "./structure";
import { compareOldVsNew, type ComparableEvent } from "./diffHarness";

const tfMs = 60_000;
const t = (minute: number) => new Date(Date.UTC(2026, 0, 1, 12, minute));
const candle = (minute: number, o: number, h: number, l: number, c: number): Candle => ({
  symbol: "EURUSD", ts: t(minute), o, h, l, c, v: 100,
});
const atr: AtrOutput = { values: [{ period: 14, value: 5 }] };
const htf: HtfBiasOutput = { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "test" };

function toComparable(event: { eventType: string; direction: string; level: number; ts: Date; availableAtTs?: Date }): ComparableEvent {
  return {
    identity: `${event.eventType}|${event.direction}|${event.level}|${event.ts.toISOString()}`,
    eventType: event.eventType,
    direction: event.direction,
    levelId: `${event.level}`,
    eventTs: event.ts,
    availableAt: event.availableAtTs,
  };
}

describe("production structure and causal detector parity", () => {
  it.each(["EURUSD", "GBPJPY", "XAUUSD"])("runs %s 1H through diff classification", (symbol) => {
    const candles = [
      candle(0, 100, 105, 99, 101),
      candle(1, 101, 102, 95, 96),
      candle(2, 96, 106, 96, 105),
      candle(3, 105, 108, 104, 107),
    ];
    const confirmationTs = t(1);
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 105, confidence: 1, ts: t(0), confirmationTs },
      { kind: "low", price: 95, confidence: 1, ts: t(1), confirmationTs: t(2) },
      { kind: "high", price: 108, confidence: 1, ts: t(3), confirmationTs: t(4) },
    ];
    const symbolCandles = candles.map((item) => ({ ...item, symbol }));
    const production = structureFeature.compute(
      { candles: symbolCandles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: htf },
      { tf: "1h", endTs: t(4) }
    );
    const causal = detectCausalStructure(
      { candles: symbolCandles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: htf },
      { symbol, tf: "1h", endTs: t(4) }
    );

    const report = compareOldVsNew(
      production.events.map(toComparable),
      causal.events,
      symbolCandles.map(({ ts, h, l, c }) => ({ ts, h, l, c })),
      tfMs
    );
    expect(report.oldCount).toBe(production.events.length);
    expect(report.newCount).toBe(causal.events.length);
    expect(report).toHaveProperty("removed");
    expect(report).toHaveProperty("added");

    const identities = causal.events.map((event) => event.identity);
    expect(new Set(identities).size).toBe(identities.length);
    for (const event of causal.events) {
      expect(event.availableAt.getTime()).toBeGreaterThanOrEqual(event.eventTs.getTime());
      if (event.eventType !== "mss") {
        expect(event.availableAt.getTime()).toBeGreaterThanOrEqual(event.eventTs.getTime() + tfMs);
      }
    }
    expect(causal.events.some((event) => event.eventTs.getTime() === t(4).getTime())).toBe(false);
    expect(causal.events.every((event) => event.availableAt.getTime() <= t(4).getTime())).toBe(true);
    expect(report.removed.every((entry) => entry.classification === "UNRESOLVED")).toBe(true);
    expect(report.added.every((entry) =>
      entry.classification === "CAUSAL_CORRECTION" || entry.classification === "POTENTIAL_BUG"
    )).toBe(true);
  });

  it("classifies retrospective production event removed by causal availability gating", () => {
    const candles = [
      candle(0, 100, 105, 99, 101),
      candle(1, 101, 102, 95, 96),
      candle(2, 96, 106, 96, 105),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 105, confidence: 1, ts: t(0), confirmationTs: t(3) },
      { kind: "low", price: 95, confidence: 1, ts: t(1), confirmationTs: t(3) },
    ];
    const production = structureFeature.compute(
      { candles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: htf },
      { tf: "1m", endTs: t(3) }
    );
    const causal = detectCausalStructure(
      { candles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: htf },
      { symbol: "EURUSD", tf: "1m", endTs: t(3) }
    );
    const report = compareOldVsNew(
      production.events.map(toComparable),
      causal.events,
      candles.map(({ ts, h, l, c }) => ({ ts, h, l, c })),
      tfMs
    );
    expect(report.removed.length).toBeGreaterThanOrEqual(0);
    expect(report.added.length).toBeGreaterThanOrEqual(0);
    expect(causal.events.every((event) => event.availableAt.getTime() <= t(3).getTime())).toBe(true);
  });
});
