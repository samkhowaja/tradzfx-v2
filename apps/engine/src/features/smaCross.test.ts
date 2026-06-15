import { describe, it, expect, vi } from "vitest";
import { smaCrossFeature } from "./smaCross";
import type { Candle } from "@tm/shared";

function makeCandles(count: number, closeFn: (i: number) => number): Candle[] {
  return Array.from({ length: count }, (_, i) => {
    const c = closeFn(i);
    return {
      symbol: "EURUSD",
      ts: new Date(Date.UTC(2026, 0, 1, 0, i)),
      o: c,
      h: c + 0.0001,
      l: c - 0.0001,
      c,
      v: 100,
    };
  });
}

describe("smaCrossFeature", () => {
  it("returns empty crosses for fewer than 2 candles", () => {
    const out = smaCrossFeature.compute({ candles: makeCandles(1, () => 1.0) });
    expect(out.crosses).toHaveLength(0);
  });

  it("classifies a rising trend as bullish across default pairs", () => {
    const candles = makeCandles(250, (i) => 1.0 + i * 0.0001);
    const out = smaCrossFeature.compute({ candles });

    expect(out.crosses.length).toBeGreaterThan(0);
    for (const cross of out.crosses) {
      expect(cross.direction).toBe("bullish");
      expect(cross.fastValue).toBeGreaterThan(cross.slowValue);
      expect(cross.ts).toEqual(candles[candles.length - 1].ts);
    }

    const pair15_250 = out.crosses.find(
      (c) => c.fastPeriod === 15 && c.slowPeriod === 250
    );
    expect(pair15_250).toBeDefined();
    expect(pair15_250!.direction).toBe("bullish");
  });

  it("classifies a falling trend as bearish", () => {
    const candles = makeCandles(250, (i) => 1.1 - i * 0.0001);
    const out = smaCrossFeature.compute({ candles });

    expect(out.crosses.length).toBeGreaterThan(0);
    for (const cross of out.crosses) {
      expect(cross.direction).toBe("bearish");
      expect(cross.fastValue).toBeLessThan(cross.slowValue);
    }
  });

  it("classifies a flat trend as neutral", () => {
    const candles = makeCandles(250, () => 1.0);
    const out = smaCrossFeature.compute({ candles });

    const pair9_21 = out.crosses.find(
      (c) => c.fastPeriod === 9 && c.slowPeriod === 21
    );
    expect(pair9_21).toBeDefined();
    expect(pair9_21!.direction).toBe("neutral");
    expect(pair9_21!.fastValue).toBeCloseTo(pair9_21!.slowValue, 10);
  });

  it("skips pairs that need more data than available", () => {
    // Only 50 candles — enough for 9/21 but not for 15/250
    const candles = makeCandles(50, (i) => 1.0 + i * 0.0001);
    const out = smaCrossFeature.compute({ candles });

    expect(out.crosses.some((c) => c.fastPeriod === 15 && c.slowPeriod === 250)).toBe(false);
    expect(out.crosses.some((c) => c.fastPeriod === 9 && c.slowPeriod === 21)).toBe(true);
  });

  it("respects SMA_CROSS_PAIRS env override", async () => {
    vi.resetModules();
    process.env.SMA_CROSS_PAIRS = "5/10";
    const { smaCrossFeature: customFeature } = await import("./smaCross");

    const candles = makeCandles(20, (i) => 1.0 + i * 0.0001);
    const out = customFeature.compute({ candles });

    expect(out.crosses).toHaveLength(1);
    expect(out.crosses[0].fastPeriod).toBe(5);
    expect(out.crosses[0].slowPeriod).toBe(10);

    delete process.env.SMA_CROSS_PAIRS;
    vi.resetModules();
  });

  it("serializes and deserializes output", () => {
    const candles = makeCandles(250, (i) => 1.0 + i * 0.0001);
    const out = smaCrossFeature.compute({ candles });
    const rows = smaCrossFeature.serialize(out);
    const restored = smaCrossFeature.deserialize(rows);

    expect(restored.crosses).toHaveLength(out.crosses.length);
    expect(restored.crosses[0].direction).toBe(out.crosses[0].direction);
    expect(restored.crosses[0].fastValue).toBe(out.crosses[0].fastValue);
  });
});
