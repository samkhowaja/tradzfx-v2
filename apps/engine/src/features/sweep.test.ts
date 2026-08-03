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
    features_pivot: {
      pivots: pivots.map((pivot) => ({
        ...pivot,
        confirmationTs: pivot.confirmationTs ?? pivot.ts,
      })),
    },
    features_atr: { values: [{ period: 14, value: 1.0 }] } as AtrOutput,
    features_structure: { events: structureEvents },
  };
}

describe("sweepFeature (v1.4.0 level-based)", () => {
  it("assigns availability at sweep candle completion", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100, 100.2, 98.5, 100),
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const output = sweepFeature.compute(makeInput(candles, pivots), { symbol: "EURUSD", tf: "5m", endTs: candles[2].ts });
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].availableAtTs).toEqual(new Date(candles[2].ts.getTime() + 300_000));
  });

  it("detects a bullish swing sweep with same-bar close-back", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100), // pivot low 99.5
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.1, 100.3, 99.7, 100.0),
      makeCandle("2026-01-01T00:03:00Z", 100.0, 100.2, 98.5, 100.0), // pierce + close back
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const structure: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 100.3, ts: candles[2].ts },
    ];

    const output = sweepFeature.compute(makeInput(candles, pivots, structure));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].direction).toBe("bullish");
    expect(output.sweeps[0].targetType).toBe("swing");
    expect(output.sweeps[0].sweepType).toBe("post_structure");
    expect(output.sweeps[0].ts.getTime()).toBe(candles[3].ts.getTime());
    expect(output.sweeps[0].evidence?.penetrationAtr).toBeCloseTo(1.0, 5);
  });

  it("detects a bearish swing sweep", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100), // pivot high 100.5
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 99.9),
      makeCandle("2026-01-01T00:02:00Z", 99.9, 100.2, 99.7, 99.8),
      makeCandle("2026-01-01T00:03:00Z", 99.8, 101.6, 99.7, 100.0), // pierce above + close back below
    ];
    const pivots = [{ kind: "high" as const, price: 100.5, ts: candles[0].ts, confidence: 1 }];

    const output = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].direction).toBe("bearish");
    expect(output.sweeps[0].targetType).toBe("swing");
    // No structure => not required; classified as inducement by the score mapping.
    expect(output.sweeps[0].sweepType).toBe("inducement");
  });

  it("emits even with no structure context (structure is a score, not a gate)", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.1, 100.3, 99.7, 100.0),
      makeCandle("2026-01-01T00:03:00Z", 100.0, 100.2, 98.5, 100.0),
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];

    const output = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(output.sweeps).toHaveLength(1);
    expect(output.sweeps[0].evidence?.structureScore).toBe(0);
  });

  it("rejects a pierce below the ATR penetration threshold", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.95, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.96, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.0, 100.2, 99.9, 100.0), // pen = 0.05 < 0.1*ATR(1.0)
    ];
    const pivots = [{ kind: "low" as const, price: 99.95, ts: candles[0].ts, confidence: 1 }];

    const output = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(output.sweeps).toHaveLength(0);
  });

  it("rejects a pierce that does not close back within the window", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.0, 100.2, 98.5, 98.6), // pierce, closes below level
      makeCandle("2026-01-01T00:03:00Z", 98.6, 99.0, 98.4, 98.7), // still below (within 2-bar window)
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];

    const output = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(output.sweeps).toHaveLength(0);
  });

  it("detects a prior-day-high (PDH) sweep", () => {
    const candles = [
      // Day 1 establishes the prior day high at 101.0
      makeCandle("2026-01-01T10:00:00Z", 100, 101.0, 99.5, 100.5),
      makeCandle("2026-01-01T11:00:00Z", 100.5, 100.8, 100.0, 100.2),
      // Day 2 sweeps 101.0 and closes back below
      makeCandle("2026-01-02T10:00:00Z", 100.2, 101.5, 100.0, 100.4),
    ];
    const output = sweepFeature.compute(makeInput(candles, [], []));
    const pdh = output.sweeps.find((s) => s.targetType === "pdh");
    expect(pdh).toBeDefined();
    expect(pdh!.direction).toBe("bearish");
    expect(pdh!.level).toBeCloseTo(101.0, 5);
    expect(pdh!.ts.getTime()).toBe(candles[2].ts.getTime());
  });

  it("is PIT-correct: a future structure event does not change emission", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100, 100.4, 99.6, 100.1),
      makeCandle("2026-01-01T00:02:00Z", 100.0, 100.2, 98.5, 100.0), // sweep here (00:02)
      makeCandle("2026-01-01T00:03:00Z", 100.0, 101.0, 99.9, 100.8), // future choch (00:03)
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const futureChoch: StructureOutput["events"] = [
      { eventType: "choch", direction: "bullish", level: 100.3, ts: candles[3].ts },
    ];

    const withFuture = sweepFeature.compute(makeInput(candles, pivots, futureChoch));
    const without = sweepFeature.compute(makeInput(candles, pivots, []));
    expect(withFuture.sweeps).toHaveLength(1);
    expect(without.sweeps).toHaveLength(1);
    // Same sweep ts regardless of the future event (no look-ahead).
    expect(withFuture.sweeps[0].ts.getTime()).toBe(without.sweeps[0].ts.getTime());
    expect(withFuture.sweeps[0].ts.getTime()).toBe(candles[2].ts.getTime());
  });

  it("serialize/deserialize round-trips target_type", () => {
    const candles = [
      makeCandle("2026-01-01T00:00:00Z", 100, 100.5, 99.5, 100),
      makeCandle("2026-01-01T00:01:00Z", 100.0, 100.2, 98.5, 100.0),
    ];
    const pivots = [{ kind: "low" as const, price: 99.5, ts: candles[0].ts, confidence: 1 }];
    const out = sweepFeature.compute(makeInput(candles, pivots, []));
    const rows = sweepFeature.serialize(out);
    expect(rows[0].target_type).toBe("swing");
    const back = sweepFeature.deserialize(rows);
    expect(back.sweeps[0].targetType).toBe("swing");
  });
});
