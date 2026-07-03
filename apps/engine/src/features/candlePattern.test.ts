import { describe, it, expect } from "vitest";
import { candlePatternFeature, CandlePatternInput } from "./candlePattern";
import type { Candle } from "@tm/shared";

function makeCandle(ts: Date, o: number, h: number, l: number, c: number): Candle {
  return { symbol: "XAUUSD", ts, o, h, l, c, v: 100 };
}

function input(candles: Candle[]): CandlePatternInput {
  return { candles };
}

describe("candlePatternFeature", () => {
  it("detects a bullish engulfing pattern in the last 3 bars", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2502, 2503, 2499, 2499),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2498, 2506, 2498, 2505),
    ];
    const out = candlePatternFeature.compute(input(candles));
    expect(out.patterns.some((p) => p.patternName === "engulfing_bull")).toBe(true);
  });

  it("only emits patterns for the last N bars", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2502, 2503, 2499, 2499),
      // Earlier engulfing that should be ignored if lookback is 3 and there
      // are enough later bars without patterns.
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2498, 2506, 2498, 2505),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2505, 2506, 2504, 2505),
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2505, 2506, 2504, 2505),
    ];
    const out = candlePatternFeature.compute(input(candles));
    expect(out.patterns.every((p) => p.ts.getTime() >= candles[2].ts.getTime())).toBe(true);
  });

  it("filters patterns below the configured confidence threshold", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2502, 2503, 2499, 2499),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2498, 2506, 2498, 2505),
    ];
    const originalEnv = process.env.CANDLE_PATTERN_MIN_CONFIDENCE;
    process.env.CANDLE_PATTERN_MIN_CONFIDENCE = "0.9";
    const out = candlePatternFeature.compute(input(candles));
    if (originalEnv === undefined) {
      delete process.env.CANDLE_PATTERN_MIN_CONFIDENCE;
    } else {
      process.env.CANDLE_PATTERN_MIN_CONFIDENCE = originalEnv;
    }
    expect(out.patterns.every((p) => (p.confidence ?? 0) >= 0.9)).toBe(true);
  });

  it("serializes and deserializes pattern rows", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2505, 2500, 2502),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2502, 2503, 2499, 2499),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2498, 2506, 2498, 2505),
    ];
    const out = candlePatternFeature.compute(input(candles));
    expect(out.patterns.length).toBeGreaterThan(0);
    const rows = candlePatternFeature.serialize(out);
    const restored = candlePatternFeature.deserialize(rows);
    expect(restored.patterns.length).toBe(out.patterns.length);
  });
});
