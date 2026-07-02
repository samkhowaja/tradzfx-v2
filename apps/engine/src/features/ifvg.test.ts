import { describe, it, expect } from "vitest";
import { ifvgFeature } from "./ifvg";
import type { Candle } from "@tm/shared";

function makeCandle(ts: Date, o: number, h: number, l: number, c: number): Candle {
  return { symbol: "XAUUSD", ts, o, h, l, c, v: 100 };
}

describe("ifvgFeature", () => {
  it("does not flag an FVG as reversed after a single close outside", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      // Bullish FVG: c1.h < c3.l => c1.h=2500, c3.l=2502
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2498, 2500, 2498, 2499),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2501, 2501, 2501),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      // Fill then one close above zone top
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2503, 2501, 2503.5),
    ];
    const out = ifvgFeature.compute({ candles });
    expect(out.ifvgs.length).toBe(0);
  });

  it("flags a bullish iFVG after two consecutive closes above the zone", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2498, 2500, 2498, 2499),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2501, 2501, 2501),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      // Fill the zone
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2503, 2500.5, 2501),
      // First close above zone top
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2504, 2501, 2503),
      // Second close above zone top with strong body
      makeCandle(new Date(t0.getTime() + 5 * 60000), 2503, 2506, 2503, 2505),
    ];
    const out = ifvgFeature.compute({ candles });
    expect(out.ifvgs.length).toBe(1);
    expect(out.ifvgs[0].direction).toBe("bullish");
    expect(out.ifvgs[0].confirmationCount).toBeGreaterThanOrEqual(2);
    expect(out.ifvgs[0].strengthScore).toBeGreaterThan(0);
  });

  it("flags a bearish iFVG after two consecutive closes below the zone", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      // Bearish FVG: c1.l > c3.h => c1.l=2504, c3.h=2502
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2505, 2505, 2504, 2504.5),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2503, 2503, 2503, 2503),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2501, 2502, 2501, 2501.5),
      // Fill the zone
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2501.5, 2503.5, 2501.5, 2503),
      // First close below zone bottom
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2503, 2503, 2499, 2500),
      // Second close below zone bottom with strong body
      makeCandle(new Date(t0.getTime() + 5 * 60000), 2500, 2500, 2497, 2498),
    ];
    const out = ifvgFeature.compute({ candles });
    expect(out.ifvgs.length).toBe(1);
    expect(out.ifvgs[0].direction).toBe("bearish");
    expect(out.ifvgs[0].confirmationCount).toBeGreaterThanOrEqual(2);
  });

  it("resets confirmation streak if price closes back inside the zone", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2498, 2500, 2498, 2499),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2501, 2501, 2501),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      // Fill
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2503, 2500.5, 2501),
      // One close above
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2504, 2501, 2503),
      // Back inside
      makeCandle(new Date(t0.getTime() + 5 * 60000), 2503, 2503, 2501, 2501.5),
      // Two more closes above
      makeCandle(new Date(t0.getTime() + 6 * 60000), 2501.5, 2505, 2501.5, 2504),
      makeCandle(new Date(t0.getTime() + 7 * 60000), 2504, 2506, 2504, 2505),
    ];
    const out = ifvgFeature.compute({ candles });
    expect(out.ifvgs.length).toBe(1);
    expect(out.ifvgs[0].confirmationCount).toBeGreaterThanOrEqual(2);
  });

  it("serializes and deserializes confirmation_count", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2498, 2500, 2498, 2499),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2501, 2501, 2501),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2503, 2500.5, 2501),
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2504, 2501, 2503),
      makeCandle(new Date(t0.getTime() + 5 * 60000), 2503, 2506, 2503, 2505),
    ];
    const out = ifvgFeature.compute({ candles });
    const rows = ifvgFeature.serialize(out);
    const restored = ifvgFeature.deserialize(rows);
    expect(restored.ifvgs[0].confirmationCount).toBe(out.ifvgs[0].confirmationCount);
  });
});
