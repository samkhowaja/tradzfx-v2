import { describe, it, expect } from "vitest";
import { biasFeature } from "./bias";
import type { Candle, HtfBiasOutput, AtrOutput, StructureOutput, PivotOutput } from "@tm/shared";

function makeCandles(basePrice: number, count: number, slope: number): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const c = basePrice + i * slope;
    const o = c - slope / 2;
    const h = c + Math.abs(slope) * 0.3 + 0.0005;
    const l = c - Math.abs(slope) * 0.3 - 0.0005;
    candles.push({
      symbol: "EURUSD",
      ts: new Date(Date.UTC(2024, 0, 1, 0, i)),
      o,
      h,
      l,
      c,
      v: 1000 + i * 10,
    });
  }
  return candles;
}

function makePivots(trend: "up" | "down"): PivotOutput {
  const pivots: PivotOutput["pivots"] = [];
  const base = trend === "up" ? 1.07 : 1.09;
  const step = trend === "up" ? 0.0005 : -0.0005;
  for (let i = 0; i < 6; i++) {
    const price = base + i * step;
    const kind = i % 2 === 0 ? "low" : "high";
    pivots.push({
      kind,
      price,
      confidence: 0.8,
      ts: new Date(Date.UTC(2024, 0, 1, 0, 10 + i * 5)),
    });
  }
  return { pivots };
}

const htfBullish: HtfBiasOutput = {
  direction: "bullish",
  confidence: 90,
  state: "READY",
  score: 3.5,
  reason: "1D bullish OB",
};

const atr: AtrOutput = { values: [{ period: 14, value: 0.001 }] };

const structure: StructureOutput = {
  events: [
    {
      eventType: "bos",
      direction: "bullish",
      level: 1.08,
      ts: new Date(Date.UTC(2024, 0, 1, 0, 40)),
    },
  ],
};

describe("regimeBias", () => {
  it("returns bullish bias in an uptrend with HTF alignment", () => {
    const candles = makeCandles(1.07, 60, 0.0001);
    const result = biasFeature.compute({
      candles,
      features_structure: structure,
      features_htf_bias: htfBullish,
      features_atr: atr,
      features_pivot: makePivots("up"),
    });

    expect(result.direction).toBe("bullish");
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.regime).toBeDefined();
    expect(result.score.htfAlignment).toBe(90);
    expect(result.score.hhhl).toBeDefined();
    expect(result.factors.length).toBeGreaterThan(0);
  });

  it("returns bearish bias in a downtrend with HTF alignment", () => {
    const candles = makeCandles(1.09, 60, -0.0001);
    const result = biasFeature.compute({
      candles,
      features_structure: {
        events: [
          { eventType: "bos", direction: "bearish", level: 1.08, ts: new Date(Date.UTC(2024, 0, 1, 0, 40)) },
        ],
      },
      features_htf_bias: {
        direction: "bearish",
        confidence: 90,
        state: "READY",
        score: -3.5,
        reason: "1D bearish OB",
      },
      features_atr: atr,
      features_pivot: makePivots("down"),
    });

    expect(result.direction).toBe("bearish");
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("falls back to neutral with insufficient candles", () => {
    const candles = makeCandles(1.08, 10, 0);
    const result = biasFeature.compute({
      candles,
      features_structure: structure,
      features_htf_bias: htfBullish,
      features_atr: atr,
      features_pivot: makePivots("up"),
    });

    expect(result.direction).toBe("neutral");
    expect(result.confidence).toBe(0);
  });
});
