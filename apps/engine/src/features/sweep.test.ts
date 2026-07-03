import { describe, it, expect } from "vitest";
import { sweepFeature, type SweepInput } from "./sweep";
import type { Candle, AtrOutput, PivotOutput, StructureOutput } from "@tm/shared";

function makeCandle(ts: string, o: number, h: number, l: number, c: number): Candle {
  return { ts: new Date(ts), o, h, l, c, v: 100 };
}

function makeInput(
  candles: Candle[],
  pivots: PivotOutput["pivots"],
  structureEvents: StructureOutput["events"] = []
): SweepInput {
  return {
    candles,
    features_pivot: { pivots },
    features_atr: { values: [{ period: 14, value: 1.0 }] } as AtrOutput,
    features_structure: { events: structureEvents },
  };
}

describe("sweepFeature", () => {
  it("detects a post-structure bullish sweep", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100), // pivot low 99.5
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.1, 100.3, 99.7, 100.0),
      makeCandle("2026-01-01T00:03:00Z", 100.0, 100.2, 98.5, 100.0), // sweep low
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const structure: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 100.3, ts: candles[2].ts },
    ];

    const output = sweepFeature.compute(makeInput(candles, pivots, structure));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].direction).toBe("bullish");
    expect(output.sweeps[0].sweepType).toBe("post_structure");
  });

  it("detects an inducement bullish sweep (sweep followed by choch)", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100), // pivot low 99.5
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.1, 100.3, 99.7, 100.0),
      makeCandle("2026-01-01T00:03:00Z", 100.0, 100.2, 98.5, 100.0), // sweep low
      makeCandle("2026-01-01T00:04:00Z", 100.0, 101.0, 99.9, 100.8), // confirming choch
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const structure: StructureOutput["events"] = [
      { eventType: "choch", direction: "bullish", level: 100.3, ts: candles[4].ts },
    ];

    const output = sweepFeature.compute(makeInput(candles, pivots, structure));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].direction).toBe("bullish");
    expect(output.sweeps[0].sweepType).toBe("inducement");
  });

  it("ignores a sweep with no structure context", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.1, 100.3, 99.7, 100.0),
      makeCandle("2026-01-01T00:03:00Z", 100.0, 100.2, 98.5, 100.0),
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];

    const output = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(output.sweeps).toHaveLength(0);
  });

  it("detects a post-structure bearish sweep", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100), // pivot high 100.5
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 99.9),
      makeCandle("2026-01-01T00:02:00Z", 99.9, 100.2, 99.7, 99.8),
      makeCandle("2026-01-01T00:03:00Z", 99.8, 101.5, 99.7, 100.0), // sweep high
    ];
    const pivots = [{ kind: "high" as const, price: 100.5, ts: candles[0].ts, confidence: 1 }];
    const structure: StructureOutput["events"] = [
      { eventType: "choch", direction: "bearish", level: 99.7, ts: candles[2].ts },
    ];

    const output = sweepFeature.compute(makeInput(candles, pivots, structure));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].direction).toBe("bearish");
    expect(output.sweeps[0].sweepType).toBe("post_structure");
  });
});
