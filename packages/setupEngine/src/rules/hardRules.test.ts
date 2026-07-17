import { describe, expect, it } from "vitest";
import type { EvaluationContext } from "../types";
import { runHardRules } from "./hardRules";

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    pool: {} as any,
    symbol: "XAUUSD",
    tf: "15m",
    asOf: new Date("2026-07-10T14:00:00Z"),
    setupFamily: "zone_reversal",
    signalSource: "zone",
    direction: "long",
    minRR: 2,
    latestCandle: { o: 100, h: 101, l: 99, c: 100, ts: new Date("2026-07-10T14:00:00Z") },
    bias: null,
    htfBias: null,
    pricing: null,
    structure: [],
    zones: [],
    pivots: [],
    atr: 1,
    spreadPips: 1,
    maxAllowedSpreadPips: 3,
    maxStopPips: 50,
    volatility: { regime: "normal", atrPips: 10 },
    sessionProfile: { name: "NY", killzone: true },
    activePositionCount: 0,
    maxPositionsPerSymbol: 2,
    evidence: [],
    warnings: [],
    featuresUsed: [],
    entryZone: null,
    ...overrides,
  };
}

describe("runHardRules setup families", () => {
  it("keeps zone hard rules for zone-reversal strategies", () => {
    const blocks = runHardRules(ctx());

    expect(blocks).toContain("No active zones available for entry");
    expect(blocks).toContain("No entry zone within 1.5 ATR of current price");
  });

  it("does not force ORB strategies through zone hard rules", () => {
    const blocks = runHardRules(ctx({ setupFamily: "orb_breakout", signalSource: "orb" }));

    expect(blocks).not.toContain("No active zones available for entry");
    expect(blocks).not.toContain("All nearby zones have already been tapped");
    expect(blocks).not.toContain("No entry zone within 1.5 ATR of current price");
  });

  it("does not force FVG continuation strategies through zone proximity rules", () => {
    const blocks = runHardRules(
      ctx({
        setupFamily: "fvg_continuation",
        signalSource: "fvg",
        zones: [{ top: 101, bottom: 100, tapped: true }],
      })
    );

    expect(blocks).not.toContain("All nearby zones have already been tapped");
    expect(blocks).not.toContain("No entry zone within 1.5 ATR of current price");
  });
});
