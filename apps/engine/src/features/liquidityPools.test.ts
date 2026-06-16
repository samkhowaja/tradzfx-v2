import { describe, it, expect } from "vitest";
import { liquidityPoolsFeature, sweepMatchesPool } from "./liquidityPools";
import type { Candle, SweepOutput } from "@tm/shared";

function makeCandles(symbol: string, count: number, basePrice: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 0, 5, 14, i)); // 14:00 UTC = NY session
    const price = basePrice + i * 0.1;
    candles.push({ symbol, ts, o: price, h: price + 0.5, l: price - 0.5, c: price, v: 100 });
  }
  return candles;
}

describe("liquidityPoolsFeature", () => {
  it("computes pools for Gold with round numbers", () => {
    const candles = makeCandles("XAUUSD", 100, 2545.0);
    const sweep: SweepOutput = { sweeps: [] };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });

    expect(out.pools.length).toBeGreaterThan(0);
    expect(out.roundNumbers.length).toBeGreaterThan(0);
    expect(out.nearestAbove).not.toBeNull();
    expect(out.nearestBelow).not.toBeNull();
    expect(out.recentSweepMatched).toBe(false);
  });

  it("detects recent sweep matched a pool", () => {
    const candles = makeCandles("XAUUSD", 100, 2545.0);
    const sweep: SweepOutput = {
      sweeps: [
        {
          direction: "bearish",
          level: 2550.0,
          extreme: 2550.0,
          close: 2549.5,
          ts: new Date(Date.UTC(2026, 0, 5, 14, 99)),
        },
      ],
    };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });
    expect(out.recentSweepMatched).toBe(true);
  });

  it("serializes and deserializes output", () => {
    const candles = makeCandles("XAUUSD", 50, 2545.0);
    const sweep: SweepOutput = { sweeps: [] };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });
    const rows = liquidityPoolsFeature.serialize(out);
    const restored = liquidityPoolsFeature.deserialize(rows);
    expect(restored.pools.length).toBe(out.pools.length);
    expect(restored.recentSweepMatched).toBe(out.recentSweepMatched);
  });
});

describe("sweepMatchesPool", () => {
  it("matches when swept price is within tolerance", () => {
    const pools = [
      { kind: "round_number" as const, label: "RN 2550", price: 2550.0, distance: 1.0, strength: 80 },
    ];
    const match = sweepMatchesPool(2550.2, pools, 0.5, 1.0);
    expect(match.matched).toBe(true);
    expect(match.pool?.price).toBe(2550.0);
  });

  it("does not match when outside tolerance", () => {
    const pools = [
      { kind: "round_number" as const, label: "RN 2550", price: 2550.0, distance: 1.0, strength: 80 },
    ];
    const match = sweepMatchesPool(2560.0, pools, 0.5, 1.0);
    expect(match.matched).toBe(false);
  });
});
