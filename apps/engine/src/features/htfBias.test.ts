import { describe, it, expect } from "vitest";
import { htfBiasFeature, HtfBiasInput } from "./htfBias";
import type { Candle, TimeFrame } from "@tm/shared";

function makeCandles(
  count: number,
  startPrice: number,
  step: number,
  direction: "bullish" | "bearish" | "range"
): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const base =
      direction === "range"
        ? startPrice + (i % 2 === 0 ? 0 : step)
        : startPrice + i * step;
    const body = Math.abs(step) * 0.6;
    const wick = Math.abs(step) * 0.4;
    const o = direction === "bullish" ? base : base + body;
    const c = direction === "bullish" ? base + body : base;
    const l = Math.min(o, c) - wick;
    const h = Math.max(o, c) + wick;
    candles.push({
      symbol: "XAUUSD",
      ts: new Date(Date.UTC(2024, 0, 1, 0, 0, i)),
      o,
      h,
      l,
      c,
      v: 1000,
    });
  }
  return candles;
}

function input(
  tfs: Partial<Record<TimeFrame, Candle[]>>,
  candles: Candle[] = []
): HtfBiasInput {
  return { candles, higherTfCandles: tfs as Record<TimeFrame, Candle[]> };
}

describe("htfBiasFeature", () => {
  it("returns READY bullish when 1D and 4H swings align bullish", async () => {
    const output = await htfBiasFeature.compute(
      input({
        "1d": makeCandles(60, 1800, 5, "bullish"),
        "4h": makeCandles(60, 1800, 2, "bullish"),
        "1h": makeCandles(60, 1800, 1, "bullish"),
      }),
      { tf: "15m" }
    );

    expect(output.direction).toBe("bullish");
    expect(output.state).toBe("READY");
    expect(output.confidence).toBe(90);
    expect(output.score).toBeGreaterThanOrEqual(3);
    expect(output.byTimeFrame).toBeDefined();
    expect(output.byTimeFrame?.["1d"].state).toBe("soft");
    expect(output.byTimeFrame?.["4h"].state).toBe("soft");
  });

  it("returns bearish SOFT_WARN when 4H bearish is not offset by higher TFs", async () => {
    const output = await htfBiasFeature.compute(
      input({
        "1d": makeCandles(60, 1800, 2, "range"),
        "4h": makeCandles(60, 1800, -2, "bearish"),
        "1h": makeCandles(60, 1800, 2, "range"),
      }),
      { tf: "15m" }
    );

    expect(output.direction).toBe("bearish");
    expect(output.state).toBe("SOFT_WARN");
    expect(output.confidence).toBe(70);
    expect(output.score).toBe(-1.5);
  });

  it("returns BLOCK when no fresh HTF context exists", async () => {
    const output = await htfBiasFeature.compute(
      input({
        "1d": makeCandles(60, 1800, 2, "range"),
        "4h": makeCandles(60, 1800, 2, "range"),
        "1h": makeCandles(60, 1800, 1, "range"),
      }),
      { tf: "15m" }
    );

    expect(output.direction).toBe("neutral");
    expect(output.state).toBe("BLOCK");
    expect(output.confidence).toBe(0);
  });

  it("only considers TFs at or above the feature tf", async () => {
    const output = await htfBiasFeature.compute(
      input({
        "15m": makeCandles(60, 1800, 5, "bullish"),
        "1h": makeCandles(60, 1800, 1, "range"),
        "4h": makeCandles(60, 1800, 2, "range"),
        "1d": makeCandles(60, 1800, 2, "range"),
      }),
      { tf: "1h" }
    );

    const tfs = Object.keys(output.byTimeFrame ?? {});
    expect(tfs).toContain("1d");
    expect(tfs).toContain("4h");
    expect(tfs).toContain("1h");
    expect(tfs).not.toContain("15m");
  });

  it("marks a child TF as opposing when it disagrees with a strong parent", async () => {
    const output = await htfBiasFeature.compute(
      input({
        "1d": makeCandles(60, 1800, 5, "bullish"),
        "4h": makeCandles(60, 1800, -2, "bearish"),
        "1h": makeCandles(60, 1800, 1, "range"),
      }),
      { tf: "15m" }
    );

    expect(output.byTimeFrame?.["1d"].state).toBe("soft");
    expect(output.byTimeFrame?.["1d"].direction).toBe("bullish");
    expect(output.byTimeFrame?.["4h"].state).toBe("opposing");
    expect(output.byTimeFrame?.["4h"].direction).toBe("bearish");
  });

  it("includes higher-timeframe candles in the input hash", () => {
    const a = input({
      "1d": makeCandles(60, 1800, 5, "bullish"),
      "4h": makeCandles(60, 1800, 2, "bullish"),
    });
    const b = input({
      "1d": makeCandles(60, 1800, 5, "bullish"),
      "4h": makeCandles(60, 1800, 3, "bullish"),
    });
    expect(htfBiasFeature.hashInput(a)).not.toBe(htfBiasFeature.hashInput(b));
  });
});
