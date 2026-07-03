import { describe, it, expect } from "vitest";
import { zoneFeature } from "./zone";
import type { Candle, PivotOutput, AtrOutput, HtfBiasOutput, StructureOutput, ZoneInput } from "@tm/shared";

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
const emptyStructure: StructureOutput = { events: [] };

function makeInput(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  htf: HtfBiasOutput = neutralHtf,
  structure: StructureOutput = emptyStructure,
  atr: AtrOutput = defaultAtr
): ZoneInput {
  return {
    candles,
    features_pivot: { pivots },
    features_atr: atr,
    features_htf_bias: htf,
    features_structure: structure,
  };
}

describe("zoneFeature v2", () => {
  it("detects a demand zone from a strong bullish candle near a low pivot", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2501, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2496, 2505, 2495, 2504, 150), // strong bullish + volume
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
    ];
    const out = await zoneFeature.compute(makeInput(candles, pivots));
    const demand = out.zones.find((z) => z.zoneKind === "demand");
    expect(demand).toBeDefined();
    expect(demand!.direction).toBe("bullish");
    // Zone is now bounded by the impulse-candle body plus a 10% ATR buffer
    // (ATR=5, buffer=0.5). Body bottom = 2496, body top = 2504.
    expect(demand!.bottom).toBeCloseTo(2495.5, 5);
    expect(demand!.top).toBeCloseTo(2504.5, 5);
    expect(demand!.rankScore).toBeGreaterThan(0);
  });

  it("ignores demand zones without a nearby pivot", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2505, 2501, 2504),
    ];
    const pivots: PivotOutput["pivots"] = [];
    const out = await zoneFeature.compute(makeInput(candles, pivots));
    const demand = out.zones.find((z) => z.zoneKind === "demand");
    expect(demand).toBeUndefined();
  });

  it("detects a supply zone from a strong bearish candle near a high pivot", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2499, 2504),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2504, 2504, 2495, 2496, 150), // strong bearish + volume
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "high", price: 2505, confidence: 1, ts: candles[0].ts },
    ];
    const out = await zoneFeature.compute(makeInput(candles, pivots));
    const supply = out.zones.find((z) => z.zoneKind === "supply");
    expect(supply).toBeDefined();
    expect(supply!.direction).toBe("bearish");
    // Body top = 2504, body bottom = 2496, buffer = 0.5
    expect(supply!.top).toBeCloseTo(2504.5, 5);
    expect(supply!.bottom).toBeCloseTo(2495.5, 5);
  });

  it("classifies engulfing candles as rbr/dbd", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2503, 2500, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2499, 2506, 2498, 2505, 150), // bullish engulfing + volume
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2498, confidence: 1, ts: candles[0].ts },
    ];
    const out = await zoneFeature.compute(makeInput(candles, pivots));
    const demand = out.zones.find((z) => z.zoneKind === "demand");
    expect(demand).toBeDefined();
    expect(demand!.formation).toBe("rbr");
  });

  it("detects a bullish FVG aligned with recent structure", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2504, 2506, 2504, 2505), // gap up
    ];
    const pivots: PivotOutput["pivots"] = [];
    const structure: StructureOutput = {
      events: [
        { eventType: "bos", direction: "bullish", level: 2503, ts: candles[0].ts },
      ],
    };
    const out = await zoneFeature.compute(makeInput(candles, pivots, neutralHtf, structure));
    const fvg = out.zones.find((z) => z.zoneKind === "fvg" && z.direction === "bullish");
    expect(fvg).toBeDefined();
  });

  it("accepts but down-ranks FVGs that oppose recent structure", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2505, 2506, 2505, 2505),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2504, 2505, 2504, 2504),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2499, 2501, 2499, 2500), // gap down
    ];
    const pivots: PivotOutput["pivots"] = [];
    const structure: StructureOutput = {
      events: [
        { eventType: "bos", direction: "bullish", level: 2503, ts: candles[0].ts },
      ],
    };
    const out = await zoneFeature.compute(makeInput(candles, pivots, neutralHtf, structure));
    const bearishFvg = out.zones.find((z) => z.zoneKind === "fvg" && z.direction === "bearish");
    expect(bearishFvg).toBeDefined();
    expect((bearishFvg as any).fvgAligned).toBe(false);
    expect(bearishFvg!.qualityScore).toBeLessThan(0.5);
  });

  it("compute is pure and does not require a pool context", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2501, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2496, 2505, 2495, 2504, 150),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
    ];
    const out = zoneFeature.compute(makeInput(candles, pivots));
    expect(out.zones).toBeDefined();
    expect(out.zones.length).toBeGreaterThan(0);
  });

  it("serializes and deserializes v2 fields", async () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2501, 2495, 2496),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2496, 2505, 2495, 2504, 150),
    ];
    const pivots: PivotOutput["pivots"] = [
      { kind: "low", price: 2495, confidence: 1, ts: candles[0].ts },
    ];
    const out = await zoneFeature.compute(makeInput(candles, pivots));
    const rows = zoneFeature.serialize(out);
    const restored = zoneFeature.deserialize(rows);
    expect(restored.zones.length).toBe(out.zones.length);
    expect(restored.zones[0].rankScore).toBeDefined();
  });
});
