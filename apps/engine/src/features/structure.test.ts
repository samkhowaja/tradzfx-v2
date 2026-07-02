import { describe, it, expect } from "vitest";
import { structureFeature } from "./structure";
import type { Candle, PivotOutput, AtrOutput, HtfBiasOutput, StructureInput } from "@tm/shared";

function makeCandle(ts: Date, o: number, h: number, l: number, c: number, v = 100): Candle {
  return { symbol: "XAUUSD", ts, o, h, l, c, v };
}

const defaultAtr: AtrOutput = { values: [{ period: 14, value: 5 }] };
const neutralHtf: HtfBiasOutput = {
  direction: "neutral",
  confidence: 0,
  state: "BLOCK",
  score: 0,
  reason: "no_htf_context",
};

function makeInput(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  htf: HtfBiasOutput = neutralHtf,
  atr: AtrOutput = defaultAtr
): StructureInput {
  return {
    candles,
    features_pivot: { pivots },
    features_atr: atr,
    features_htf_bias: htf,
  };
}

describe("structureFeature v2", () => {
  it("detects bullish BOS when price closes above a prior swing high", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2495, 2498),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2498, 2512, 2497, 2511), // close above 2505
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2512, confidence: 1, ts: candles[1].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const bos = out.events.find((e) => e.eventType === "bos" && e.direction === "bullish");
    expect(bos).toBeDefined();
    expect(bos!.level).toBe(2505);
  });

  it("detects bullish CHoCH after a sweep of the prior low", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2503),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2503, 2503, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2496, 2496, 2492, 2498),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2498, 2510, 2498, 2509),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "low", price: 2495, confidence: 1, ts: candles[1].ts },
      { kind: "high", price: 2510, confidence: 1, ts: candles[3].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const choch = out.events.find((e) => e.eventType === "choch" && e.direction === "bullish");
    expect(choch).toBeDefined();
    expect(choch!.level).toBe(2505);
  });

  it("detects bearish CHoCH after a sweep of the prior high", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2499, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2502, 2502, 2490, 2491),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2491, 2508, 2491, 2505),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2505, 2505, 2485, 2486),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "low", price: 2490, confidence: 1, ts: candles[1].ts },
      { kind: "low", price: 2485, confidence: 1, ts: candles[3].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const choch = out.events.find((e) => e.eventType === "choch" && e.direction === "bearish");
    expect(choch).toBeDefined();
    expect(choch!.level).toBe(2490);
  });

  it("emits MSS when a new extreme forms after an opposing sweep", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2503),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2503, 2503, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2496, 2496, 2492, 2498),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2498, 2510, 2498, 2509),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "low", price: 2495, confidence: 1, ts: candles[1].ts },
      { kind: "high", price: 2510, confidence: 1, ts: candles[3].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const mss = out.events.find((e) => e.eventType === "mss" && e.direction === "bullish");
    expect(mss).toBeDefined();
    expect(mss!.level).toBe(2495);
  });

  it("confirms a break when a following candle closes beyond the level", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2495, 2498),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2498, 2512, 2497, 2511), // break above 2505
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2511, 2515, 2510, 2514), // confirm close > 2505
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2515, confidence: 1, ts: candles[2].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const bos = out.events.find((e) => e.eventType === "bos" && e.direction === "bullish");
    expect(bos).toBeDefined();
    expect(bos!.confirmed).toBe(true);
    expect(bos!.confirmationTs).toBeDefined();
  });

  it("emits a bos_failed event when price closes back through the level", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2495, 2498),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2498, 2512, 2497, 2511), // break above 2505
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2511, 2512, 2502, 2503), // fail: close below 2505
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2490, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2512, confidence: 1, ts: candles[1].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const failed = out.events.find((e) => e.eventType === "bos_failed" && e.direction === "bullish");
    expect(failed).toBeDefined();
    expect(failed!.level).toBe(2505);
  });

  it("marks htf_aligned when event direction matches HTF bias", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2495, 2498),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2498, 2512, 2497, 2511),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "high", price: 2512, confidence: 1, ts: candles[1].ts },
    ];
    const htf: HtfBiasOutput = {
      direction: "bullish",
      confidence: 90,
      state: "READY",
      score: 3.5,
      reason: "1D bullish OB",
    };
    const out = structureFeature.compute(makeInput(candles, pivots, htf));
    const bos = out.events.find((e) => e.eventType === "bos" && e.direction === "bullish");
    expect(bos).toBeDefined();
    expect(bos!.htfAligned).toBe(true);
  });

  it("serializes and deserializes v2 fields", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2503),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2503, 2503, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2496, 2496, 2492, 2498),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2498, 2510, 2498, 2509),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
      { kind: "low", price: 2495, confidence: 1, ts: candles[1].ts },
      { kind: "high", price: 2510, confidence: 1, ts: candles[3].ts },
    ];
    const out = structureFeature.compute(makeInput(candles, pivots));
    const rows = structureFeature.serialize(out);
    const restored = structureFeature.deserialize(rows);
    expect(restored.events.some((e) => e.eventType === "choch")).toBe(true);
    expect(restored.events.length).toBe(out.events.length);

    const choch = restored.events.find((e) => e.eventType === "choch");
    expect(choch?.strength).toBeDefined();
    expect(choch?.htfAligned).toBe(false);
  });
});
