import { describe, it, expect } from "vitest";
import { timeOfDayEdgeFeature } from "./timeOfDayEdge";
import type { Candle } from "@tm/shared";

function makeCandles(symbol: string, hour: number, count = 10): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 0, 1, hour, i));
    candles.push({ symbol, ts, o: 1.0, h: 1.001, l: 0.999, c: 1.0, v: 100 });
  }
  return candles;
}

describe("timeOfDayEdgeFeature", () => {
  it("scores XAUUSD 13:00 UTC as AVOID (death zone)", () => {
    const candles = makeCandles("XAUUSD", 13);
    const out = timeOfDayEdgeFeature.compute({ candles });
    expect(out.edge).toBe("AVOID");
    expect(out.session).toBe("OVERLAP");
    expect(out.reasons.some((r) => r.includes("hour_13_wr"))).toBe(true);
  });

  it("scores XAUUSD 18:00 UTC as STRONG (late NY)", () => {
    const candles = makeCandles("XAUUSD", 18);
    const out = timeOfDayEdgeFeature.compute({ candles });
    expect(out.edge).toBe("STRONG");
    expect(out.session).toBe("NY");
  });

  it("returns NEUTRAL for unknown symbols", () => {
    const candles = makeCandles("UNKNOWNPAIR", 12);
    const out = timeOfDayEdgeFeature.compute({ candles });
    expect(out.edge).toBe("NEUTRAL");
    expect(out.score).toBe(50);
    expect(out.lowSample).toBe(true);
  });

  it("serializes and deserializes output", () => {
    const candles = makeCandles("XAUUSD", 18);
    const out = timeOfDayEdgeFeature.compute({ candles });
    const rows = timeOfDayEdgeFeature.serialize(out);
    const restored = timeOfDayEdgeFeature.deserialize(rows);
    expect(restored.edge).toBe(out.edge);
    expect(restored.score).toBe(out.score);
    expect(restored.session).toBe(out.session);
    expect(restored.reasons).toEqual(out.reasons);
  });
});
