import { describe, it, expect, vi } from "vitest";

function makeCandles(n: number, price: (i: number) => number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(`2026-01-01T00:${String(i).padStart(2, "0")}:00Z`),
    o: price(i),
    h: price(i),
    l: price(i),
    c: price(i),
  }));
}

describe("movingAverageFeature", () => {
  it("computes SMA and EMA values", async () => {
    const { movingAverageFeature } = await import("./movingAverage");
    const candles = makeCandles(50, (i) => 1.0 + i * 0.001);
    const out = movingAverageFeature.compute({ candles });
    expect(out.values.length).toBeGreaterThan(0);
    expect(out.values.some((v) => v.maType === "sma" && v.period === 9)).toBe(true);
    expect(out.values.some((v) => v.maType === "ema" && v.period === 9)).toBe(true);
  });

  it("computes default EMA 9/21 and SMA 50/200 crosses", async () => {
    const { movingAverageFeature } = await import("./movingAverage");
    const candles = makeCandles(250, (i) => 1.0 + i * 0.001);
    const out = movingAverageFeature.compute({ candles });
    expect(out.crosses.length).toBeGreaterThanOrEqual(2);
    expect(out.crosses.some((c) => c.maType === "ema" && c.fastPeriod === 9 && c.slowPeriod === 21)).toBe(true);
    expect(out.crosses.some((c) => c.maType === "sma" && c.fastPeriod === 50 && c.slowPeriod === 200)).toBe(true);
  });

  it("serializes and deserializes both values and crosses", async () => {
    const { movingAverageFeature } = await import("./movingAverage");
    const candles = makeCandles(250, (i) => 1.0 + i * 0.001);
    const out = movingAverageFeature.compute({ candles });
    const rows = movingAverageFeature.serialize(out);
    expect(rows.length).toBe(out.values.length + out.crosses.length);
    const restored = movingAverageFeature.deserialize(rows);
    expect(restored.values.length).toBe(out.values.length);
    expect(restored.crosses.length).toBe(out.crosses.length);
  });

  it("respects custom EMA_CROSS_PAIRS and SMA_CROSS_PAIRS", async () => {
    process.env.MA_PERIODS = "5,10,20,30";
    process.env.EMA_CROSS_PAIRS = "5/10";
    process.env.SMA_CROSS_PAIRS = "20/30";
    vi.resetModules();
    const { movingAverageFeature: customFeature } = await import("./movingAverage");
    const candles = makeCandles(40, (i) => 1.0 + i * 0.001);
    const out = customFeature.compute({ candles });
    expect(out.crosses.some((c) => c.maType === "ema" && c.fastPeriod === 5 && c.slowPeriod === 10)).toBe(true);
    expect(out.crosses.some((c) => c.maType === "sma" && c.fastPeriod === 20 && c.slowPeriod === 30)).toBe(true);
    delete process.env.MA_PERIODS;
    delete process.env.EMA_CROSS_PAIRS;
    delete process.env.SMA_CROSS_PAIRS;
    vi.resetModules();
  });
});
