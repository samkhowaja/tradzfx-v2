import { describe, expect, it } from "vitest";
import type { Candle } from "./types/feature";
import { computeZoneLifecycle, findBandMaxFill } from "./lifecycle";

function candle(minute: number, h: number, l: number, c: number): Candle {
  return {
    symbol: "TEST",
    ts: new Date(Date.UTC(2026, 0, 1, 0, minute)),
    o: c,
    h,
    l,
    c,
  };
}

describe("canonical band lifecycle", () => {
  it("returns cumulative deepest bullish fill, not first-touch fill", () => {
    const candles = [
      candle(0, 111, 109, 110),
      candle(1, 111, 108, 109), // 20% first touch
      candle(2, 109, 104, 106), // 60% cumulative fill and mitigation
    ];

    const lifecycle = computeZoneLifecycle(
      { zoneKind: "demand", top: 110, bottom: 100, ts: candles[0].ts, direction: "bullish" },
      candles,
      0
    );

    expect(lifecycle.firstTouchAt).toEqual(candles[1].ts);
    expect(lifecycle.fillPct).toBeCloseTo(0.6);
    expect(lifecycle.mitigatedAt).toEqual(candles[2].ts);
    expect(lifecycle.invalidatedAt).toBeUndefined();
  });

  it("computes bearish cumulative fill and falls back to invalidation for mitigation", () => {
    const candles = [
      candle(0, 101, 99, 100),
      candle(1, 102, 99, 101), // 20% first touch
      candle(2, 111, 109, 111), // invalidating close; 100% fill
    ];

    const lifecycle = computeZoneLifecycle(
      { zoneKind: "supply", top: 110, bottom: 100, ts: candles[0].ts, direction: "bearish" },
      candles,
      0
    );

    expect(lifecycle.firstTouchAt).toEqual(candles[1].ts);
    expect(lifecycle.fillPct).toBe(1);
    expect(lifecycle.mitigatedAt).toEqual(candles[2].ts);
    expect(lifecycle.invalidatedAt).toEqual(candles[2].ts);
  });

  it("ignores candles before and at formation index", () => {
    const candles = [
      candle(0, 110, 100, 105),
      candle(1, 111, 109, 110),
    ];

    expect(findBandMaxFill(candles, 0, 110, 100, "bullish")).toBeCloseTo(0.1);
  });
});
