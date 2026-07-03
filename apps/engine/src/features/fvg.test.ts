import { describe, it, expect } from "vitest";
import { fvgFeature, FvgInput } from "./fvg";
import type { Candle } from "@tm/shared";

function makeCandle(ts: Date, o: number, h: number, l: number, c: number): Candle {
  return { symbol: "XAUUSD", ts, o, h, l, c, v: 100 };
}

function input(candles: Candle[]): FvgInput {
  return { candles };
}

describe("fvgFeature", () => {
  it("detects a bullish FVG", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2504, 2506, 2504, 2505),
    ];
    const out = fvgFeature.compute(input(candles));
    expect(out.fvgs).toHaveLength(1);
    expect(out.fvgs[0].direction).toBe("bullish");
    expect(out.fvgs[0].top).toBe(2504);
    expect(out.fvgs[0].bottom).toBe(2502);
    expect(out.fvgs[0].isFresh).toBe(true);
  });

  it("detects a bearish FVG", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2505, 2506, 2505, 2505),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2504, 2505, 2504, 2504),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2499, 2501, 2499, 2500),
    ];
    const out = fvgFeature.compute(input(candles));
    expect(out.fvgs).toHaveLength(1);
    expect(out.fvgs[0].direction).toBe("bearish");
    expect(out.fvgs[0].top).toBe(2505);
    expect(out.fvgs[0].bottom).toBe(2501);
  });

  it("marks an FVG as not fresh when price closes back inside it", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2504, 2506, 2504, 2505),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2504, 2502, 2503),
    ];
    const out = fvgFeature.compute(input(candles));
    expect(out.fvgs).toHaveLength(1);
    expect(out.fvgs[0].isFresh).toBe(false);
    expect(out.fvgs[0].ageBars).toBe(1);
  });

  it("serializes and deserializes rows", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2504, 2506, 2504, 2505),
    ];
    const out = fvgFeature.compute(input(candles));
    const rows = fvgFeature.serialize(out);
    const restored = fvgFeature.deserialize(rows);
    expect(restored.fvgs).toHaveLength(1);
    expect(restored.fvgs[0].direction).toBe("bullish");
  });
});
