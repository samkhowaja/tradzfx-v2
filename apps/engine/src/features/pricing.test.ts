import { describe, it, expect } from "vitest";
import { pricingFeature } from "./pricing";
import type { Candle, PivotOutput, AtrOutput } from "@tm/shared";

function makeCandle(
  ts: Date,
  o: number,
  h: number,
  l: number,
  c: number,
  symbol = "XAUUSD",
  v = 100
): Candle {
  return { symbol, ts, o, h, l, c, v };
}

function makePivots(pivots: Array<{ kind: "high" | "low"; price: number; ts: Date }>): PivotOutput {
  return {
    pivots: pivots.map((p) => ({ ...p, confidence: 1 })),
  };
}

function makeAtr(value: number): AtrOutput {
  return { values: [{ period: 14, value }] };
}

describe("pricingFeature", () => {
  it("classifies Gold near the top of a 50-bar range as premium", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const price = 2500 + i;
      candles.push(makeCandle(new Date(t0.getTime() + i * 60000), price, price + 1, price - 1, price));
    }
    // Last close at the very top of the range
    candles[candles.length - 1] = makeCandle(
      new Date(t0.getTime() + 49 * 60000),
      2549,
      2550,
      2549,
      2550
    );
    const out = pricingFeature.compute({ candles });
    expect(out.position).toBe("premium");
  });

  it("classifies Gold near the bottom of a 50-bar range as discount", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const price = 2500 + i;
      candles.push(makeCandle(new Date(t0.getTime() + i * 60000), price, price + 1, price - 1, price));
    }
    candles[candles.length - 1] = makeCandle(
      new Date(t0.getTime() + 49 * 60000),
      2500,
      2501,
      2500,
      2500
    );
    const out = pricingFeature.compute({ candles });
    expect(out.position).toBe("discount");
  });

  it("uses a shorter lookback for non-Gold symbols", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const price = 1.05 + i * 0.001;
      candles.push(makeCandle(new Date(t0.getTime() + i * 60000), price, price + 0.0005, price - 0.0005, price, "EURUSD"));
    }
    candles[candles.length - 1] = makeCandle(
      new Date(t0.getTime() + 19 * 60000),
      1.068,
      1.069,
      1.068,
      1.069,
      "EURUSD"
    );
    const out = pricingFeature.compute({ candles });
    expect(out.position).toBe("premium");
  });

  it("detects a bullish impulse leg and derives dynamic OTE", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    // Build 50 bars: flat baseline 2500, then impulse up, then retracement into OTE.
    for (let i = 0; i < 50; i++) {
      let price = 2500;
      let v = 100;
      if (i >= 10 && i <= 20) {
        // impulse leg up
        price = 2500 + (i - 10) * 2;
        v = 300;
      } else if (i > 20) {
        // retracement back into the 0.618-0.786 band of the 22-bar impulse (move ~22)
        price = 2524 - (i - 21) * 0.2;
        v = 100;
      }
      candles.push(
        makeCandle(new Date(t0.getTime() + i * 60000), price, price + 0.5, price - 0.5, price, "XAUUSD", v)
      );
    }

    // Final close lands in the OTE band of the leg: leg low=2500, high≈2522,
    // OTE band ≈ [2513.6, 2517.3]. Close 2523.8? Need adjust.
    // Let's pin the last close to 2516.
    const lastIdx = candles.length - 1;
    candles[lastIdx] = makeCandle(
      candles[lastIdx].ts,
      2516,
      2517,
      2515,
      2516,
      "XAUUSD",
      100
    );

    const pivots = makePivots([
      { kind: "low", price: 2500, ts: candles[10].ts },
      { kind: "high", price: 2522, ts: candles[21].ts },
    ]);

    const out = pricingFeature.compute({
      candles,
      features_pivot: pivots,
      features_atr: makeAtr(10),
    });

    expect(out.impulseLegs?.length).toBeGreaterThan(0);
    expect(out.dynamicOteSource).toBe("impulse_leg");
    expect(out.inOte).toBe(true);
    expect(out.dynamicOteLow).toBeLessThanOrEqual(out.dynamicOteHigh ?? 0);
    expect(out.dynamicOteMid).toBeCloseTo(((out.dynamicOteLow ?? 0) + (out.dynamicOteHigh ?? 0)) / 2, 6);
    expect(out.dynamicOteQuality).toBeGreaterThan(0);
  });

  it("falls back to recent-range OTE when no valid impulse leg exists", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const price = 2500 + i;
      candles.push(makeCandle(new Date(t0.getTime() + i * 60000), price, price + 1, price - 1, price));
    }

    const out = pricingFeature.compute({
      candles,
      features_pivot: makePivots([]),
      features_atr: makeAtr(10),
    });

    expect(out.dynamicOteSource).toBe("recent_range");
    expect(out.oteLow).toBeDefined();
    expect(out.oteHigh).toBeDefined();
  });

  it("requires volume confirmation for an impulse leg", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      let price = 2500;
      let v = 100;
      if (i >= 10 && i <= 20) {
        price = 2500 + (i - 10) * 2;
        v = 100; // same as baseline -> not enough volume confirmation
      }
      candles.push(
        makeCandle(new Date(t0.getTime() + i * 60000), price, price + 0.5, price - 0.5, price, "XAUUSD", v)
      );
    }

    const pivots = makePivots([
      { kind: "low", price: 2500, ts: candles[10].ts },
      { kind: "high", price: 2522, ts: candles[21].ts },
    ]);

    const out = pricingFeature.compute({
      candles,
      features_pivot: pivots,
      features_atr: makeAtr(10),
    });

    expect(out.impulseLegs?.length).toBe(0);
    expect(out.dynamicOteSource).toBe("recent_range");
  });
});
