import { describe, it, expect } from "vitest";
import { computeLotSize, buildOrderInput } from "./orderExecutor";
import type { LiveExecutionConfig, Signal, StrategySpec, SetupEvaluationSnapshot } from "@tm/shared";

const baseConfig: Partial<LiveExecutionConfig> = {
  riskPerTradePct: 1.0,
  accountBalance: 10000,
  lotSize: 0.01,
};

function baseSignal(): Signal {
  return {
    symbol: "EURUSD",
    side: "buy",
    entryType: "market",
    entryPrice: 1.09,
    stopLoss: 1.088,
    takeProfit: 1.095,
    timestamp: new Date(),
  };
}

function baseSpec(gradeSizing = true): StrategySpec {
  return {
    id: "test-strat",
    name: "Test Strategy",
    version: "1",
    signalSource: "zone",
    filters: { symbols: ["EURUSD"] },
    setup: [],
    entry: [],
    risk: { sl: "0.002", tp: "0.005", minRR: 2.5, timeoutBars: 10 },
    live: {
      mode: "paper",
      lotSize: 0.01,
      riskPerTradePct: 1,
      accountBalance: 10000,
      accountCurrency: "USD",
      signalTtlMinutes: 15,
      maxSpreadPips: 3,
      maxSlippagePoints: 20,
      entryZonePips: 2,
      maxPositionsPerSymbol: 1,
      maxPositionsTotal: 6,
      cooldownMinutes: 30,
      useGradeLotSizing: gradeSizing,
    },
  };
}

function snapshotWithGrade(grade: string): SetupEvaluationSnapshot {
  return {
    symbol: "EURUSD",
    tf: "15m",
    ts: new Date(),
    grade,
    direction: "long",
    confidence: 70,
  };
}

describe("buildOrderInput grade-based lot sizing", () => {
  it("uses 0.05 lots for A+ grade", () => {
    const input = buildOrderInput(baseSignal(), baseSpec(true), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.05);
  });

  it("uses 0.04 lots for A grade", () => {
    const input = buildOrderInput(baseSignal(), baseSpec(true), "trace-1", undefined, snapshotWithGrade("A"));
    expect(input.lot_size).toBe(0.04);
  });

  it("uses 0.03 lots for B grade", () => {
    const input = buildOrderInput(baseSignal(), baseSpec(true), "trace-1", undefined, snapshotWithGrade("B"));
    expect(input.lot_size).toBe(0.03);
  });

  it("uses 0.02 lots for C grade", () => {
    const input = buildOrderInput(baseSignal(), baseSpec(true), "trace-1", undefined, snapshotWithGrade("C"));
    expect(input.lot_size).toBe(0.02);
  });

  it("caps lot size at maxLot when grade sizing is enabled", () => {
    const input = buildOrderInput(
      baseSignal(),
      { ...baseSpec(true), live: { ...baseSpec(true).live, maxLot: 0.03 } as any },
      "trace-1",
      undefined,
      snapshotWithGrade("A+")
    );
    expect(input.lot_size).toBe(0.03);
  });
});

describe("buildOrderInput risk-based lot sizing", () => {
  it("uses %-risk sizing when risk config is present and grade sizing is disabled", () => {
    const spec = baseSpec(false);
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    // 1% of 10k = $100 risk. SL distance = 0.002 (20 pips). EURUSD pip value ≈ $10/lot.
    // Required lot = $100 / (20 pips * $10/pip) = 0.5 lots.
    expect(input.lot_size).toBeGreaterThan(0.05);
  });

  it("respects maxLot cap in risk-based sizing", () => {
    const spec = { ...baseSpec(false), live: { ...baseSpec(false).live, maxLot: 0.2 } as any };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeLessThanOrEqual(0.2);
  });

  it("falls back to grade sizing when no risk config is provided", () => {
    const spec = {
      ...baseSpec(false),
      live: { ...baseSpec(false).live, riskPerTradePct: undefined, accountBalance: undefined } as any,
    };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.05);
  });
});

describe("computeLotSize", () => {
  it("uses fixed lot size when risk-based sizing is disabled", () => {
    const lot = computeLotSize(2500.0, 2499.5, { lotSize: 0.05 }, "XAUUSD", "buy");
    expect(lot).toBe(0.05);
  });

  it("reduces XAUUSD long size due to side asymmetry", () => {
    const longLot = computeLotSize(2500.0, 2499.5, baseConfig, "XAUUSD", "buy");
    const shortLot = computeLotSize(2500.0, 2500.5, baseConfig, "XAUUSD", "sell");

    // Long risk is 60% of short risk, so long lot should be ~60% of short lot
    expect(longLot).toBeLessThan(shortLot);
    expect(longLot).toBeCloseTo(shortLot * 0.6, 1);
  });

  it("does not reduce XAUUSD short size", () => {
    const shortLot = computeLotSize(2500.0, 2500.5, baseConfig, "XAUUSD", "sell");
    expect(shortLot).toBeGreaterThan(0.01);
  });

  it("clamps lot size to minimum 0.01", () => {
    // Wide SL and tiny risk → required lot below 0.01 → clamped up
    const lot = computeLotSize(
      2500.0,
      2490.0,
      { ...baseConfig, riskPerTradePct: 0.001 },
      "XAUUSD",
      "buy"
    );
    expect(lot).toBe(0.01);
  });

  it("clamps lot size to maximum 50.0", () => {
    // Tight SL and large risk → required lot above 50.0 → clamped down
    const lot = computeLotSize(
      2500.0,
      2499.9999,
      { ...baseConfig, riskPerTradePct: 50.0 },
      "XAUUSD",
      "buy"
    );
    expect(lot).toBe(50.0);
  });
});
