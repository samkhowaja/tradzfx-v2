import { describe, it, expect } from "vitest";
import { gradeEntryQuality } from "./entryQuality";
import type { EvaluationContext } from "../types";

function buildContext(
  overrides: Partial<EvaluationContext> = {}
): EvaluationContext {
  return {
    symbol: "EURUSD",
    tf: "15m",
    asOf: new Date(),
    direction: "long",
    latestCandle: { o: 1.05, h: 1.06, l: 1.04, c: 1.055 },
    bias: null,
    htfBias: null,
    pricing: null,
    structure: [],
    zones: [],
    pivots: [],
    atr: 0.001,
    spreadPips: 1,
    maxAllowedSpreadPips: 4,
    maxStopPips: 30,
    volatility: { regime: "normal", atrPips: 10 },
    sessionProfile: null,
    activePositionCount: 0,
    maxPositionsPerSymbol: 2,
    evidence: [],
    warnings: [],
    featuresUsed: [],
    entryZone: null,
    ...overrides,
  };
}

describe("gradeEntryQuality", () => {
  it("returns zero when no zones exist", () => {
    const ctx = buildContext();
    const result = gradeEntryQuality(ctx);
    expect(result.score).toBe(0);
    expect(result.entryZone).toBeNull();
  });

  it("scores higher when price is inside a fresh zone in OTE", () => {
    const ctx = buildContext({
      latestCandle: { o: 1.05, h: 1.055, l: 1.045, c: 1.051 },
      pricing: {
        inOte: true,
        oteLow: 1.05,
        oteHigh: 1.06,
      },
      zones: [
        {
          id: "demand-1",
          type: "demand",
          direction: "long",
          top: 1.06,
          bottom: 1.05,
          tapped: false,
        },
      ],
    });

    const result = gradeEntryQuality(ctx);
    expect(result.entryZone).not.toBeNull();
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.reasons.some((r) => r.includes("OTE with zone confluence"))).toBe(true);
  });

  it("scores lower when OTE does not overlap the selected zone", () => {
    const ctx = buildContext({
      latestCandle: { o: 1.05, h: 1.055, l: 1.045, c: 1.052 },
      pricing: {
        inOte: true,
        oteLow: 1.07,
        oteHigh: 1.08,
      },
      zones: [
        {
          id: "demand-1",
          type: "demand",
          direction: "long",
          top: 1.06,
          bottom: 1.05,
          tapped: false,
        },
      ],
    });

    const result = gradeEntryQuality(ctx);
    expect(result.score).toBeLessThan(80);
    expect(result.reasons.some((r) => r.includes("zone does not overlap"))).toBe(true);
  });
});
