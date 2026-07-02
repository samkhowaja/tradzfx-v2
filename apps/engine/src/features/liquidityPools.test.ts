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

  it("detects bearish sweep matched a round-number resistance pool", () => {
    const candles = makeCandles("XAUUSD", 100, 2545.0);
    const sweep: SweepOutput = {
      sweeps: [
        {
          direction: "bearish",
          level: 2550.0,
          extreme: 2550.0,
          close: 2549.5,
          ts: candles[candles.length - 1].ts,
        },
      ],
    };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });
    expect(out.recentSweepMatched).toBe(true);
  });

  it("detects bullish sweep matched a round-number support pool", () => {
    const candles = makeCandles("XAUUSD", 100, 2545.0);
    const sweep: SweepOutput = {
      sweeps: [
        {
          direction: "bullish",
          level: 2500.0,
          extreme: 2500.0,
          close: 2500.5,
          ts: candles[candles.length - 1].ts,
        },
      ],
    };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });
    expect(out.recentSweepMatched).toBe(true);
  });

  it("does not match bullish sweep against a high structural pool", () => {
    // A bullish sweep is a low-side sweep; an extreme up near the highs should not match.
    const candles = makeCandles("XAUUSD", 100, 2545.0);
    const lastHigh = candles[candles.length - 1].h;
    const sweep: SweepOutput = {
      sweeps: [
        {
          direction: "bullish",
          level: lastHigh - 0.2,
          extreme: lastHigh,
          close: lastHigh - 0.3,
          ts: candles[candles.length - 1].ts,
        },
      ],
    };
    const out = liquidityPoolsFeature.compute({ candles, features_sweep: sweep });
    expect(out.recentSweepMatched).toBe(false);
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
