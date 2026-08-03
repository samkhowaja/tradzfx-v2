import { describe, expect, it } from "vitest";
import type { AtrOutput, Candle, HtfBiasOutput, PivotOutput, StructureInput } from "@tm/shared";
import { structureFeature } from "./structure";

const tfMs = 60_000;
const neutralHtf: HtfBiasOutput = { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "test" };
const atr: AtrOutput = { values: [] };
const ts = (minute: number) => new Date(Date.UTC(2026, 0, 1, 10, minute));
const candle = (minute: number, o: number, h: number, l: number, c: number): Candle => ({ symbol: "EURUSD", ts: ts(minute), o, h, l, c, v: 100 });
const input = (candles: Candle[], pivots: PivotOutput["pivots"]): StructureInput => ({ candles, features_pivot: { pivots }, features_atr: atr, features_htf_bias: neutralHtf });

describe("structureFeature (causal-only)", () => {
  it("emits no events before pivot confirmation", () => {
    const candles = [candle(0, 1, 1.1, 0.9, 1.05), candle(1, 1.05, 1.15, 1, 1.1)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(2), kind: "high", price: 1.1, confidence: 1 }];
    expect(structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(2) }).events).toHaveLength(0);
  });

  it("emits BOS only after confirmed level and completed break candle", () => {
    const candles = [candle(0, 1, 1.1, 0.9, 1.05), candle(1, 1.05, 1.15, 1, 1.1), candle(2, 1.1, 1.2, 1.1, 1.15), candle(3, 1.15, 1.25, 1.15, 1.2)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(1), kind: "high", price: 1.1, confidence: 1 }];
    const events = structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(4) }).events;
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("bos");
    expect(events[0].ts).toEqual(ts(2));
    expect(events[0].availableAtTs).toEqual(ts(3));
  });

  it("sets availability to later of candle completion and pivot availability", () => {
    const candles = [candle(1, 1, 1.1, 0.9, 1.05), candle(4, 1.05, 1.2, 1, 1.15)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(3), kind: "high", price: 1, confidence: 1 }];
    const events = structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(6) }).events;
    expect(events).toHaveLength(1);
    expect(events[0].availableAtTs!.getTime()).toBe(Math.max(ts(5).getTime(), ts(3).getTime()));
  });

  it("consumes level and emits no duplicate BOS", () => {
    const candles = [candle(1, 1, 1.1, 0.9, 1.05), candle(2, 1.05, 1.2, 1, 1.15), candle(3, 1.15, 1.3, 1.1, 1.25)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(1), kind: "high", price: 1, confidence: 1 }];
    const events = structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(5) }).events;
    expect(events.filter((event) => event.eventType === "bos")).toHaveLength(1);
  });

  it("suppresses opposite break without same-candle opposing sweep", () => {
    const candles = [candle(1, 1, 1.1, 0.9, 1.05), candle(2, 1.05, 1.2, 1, 1.15), candle(3, 1.15, 1.15, 0.8, 0.85)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(1), kind: "high", price: 1, confidence: 1 }, { ts: ts(1), confirmationTs: ts(2), kind: "low", price: 0.9, confidence: 1 }];
    const events = structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(5) }).events;
    expect(events.some((event) => event.eventType === "choch")).toBe(false);
  });

  it("round-trips causal source and sweep metadata", () => {
    const candles = [candle(1, 1, 1.1, 0.9, 1.05), candle(2, 1.05, 1.2, 1, 1.15)];
    const pivots: PivotOutput["pivots"] = [{ ts: ts(0), confirmationTs: ts(1), kind: "high", price: 1, confidence: 1 }];
    const output = structureFeature.compute(input(candles, pivots), { symbol: "EURUSD", tf: "1m", endTs: ts(4) });
    expect(structureFeature.deserialize(structureFeature.serialize(output))).toEqual(output);
  });
});
