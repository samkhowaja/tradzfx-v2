import { describe, it, expect } from "vitest";
import { computeLotSize, computeBalanceLotSize, computeProfitLotSize, buildOrderInput } from "./orderExecutor";
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
    expect(input.lot_size).toBeCloseTo(0.02, 5);
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

describe("computeBalanceLotSize", () => {
  // Helper: round to 2 decimals to avoid floating-point noise
  const r = (n: number) => Math.round(n * 100) / 100;

  it("returns 0.01 for balances below the first step", () => {
    expect(r(computeBalanceLotSize(0))).toBe(0.01);
    expect(r(computeBalanceLotSize(50))).toBe(0.01);
    expect(r(computeBalanceLotSize(99.99))).toBe(0.01);
  });

  it("scales by $100 increments by default", () => {
    expect(r(computeBalanceLotSize(100))).toBe(0.02);
    expect(r(computeBalanceLotSize(199.99))).toBe(0.02);
    expect(r(computeBalanceLotSize(200))).toBe(0.03);
    expect(r(computeBalanceLotSize(500))).toBe(0.06);
    expect(r(computeBalanceLotSize(1000))).toBe(0.11);
    expect(r(computeBalanceLotSize(2500))).toBe(0.26);
  });

  it("respects custom baseSize and stepUsd", () => {
    // $50 step, 0.02 base → $0–$49 = 0.02, $50–$99 = 0.04, $100–$149 = 0.06, $150–$199 = 0.08
    expect(r(computeBalanceLotSize(0, 0.02, 50))).toBe(0.02);
    expect(r(computeBalanceLotSize(75, 0.02, 50))).toBe(0.04);
    expect(r(computeBalanceLotSize(150, 0.02, 50))).toBe(0.08);
  });

  it("falls back to defaults for invalid inputs", () => {
    expect(r(computeBalanceLotSize(NaN))).toBe(0.01);
    expect(r(computeBalanceLotSize(-100))).toBe(0.01);
    // bad baseSize (0) → reset to default 0.01, so 500/100 = 5 steps → 0.06
    expect(r(computeBalanceLotSize(500, 0, 100))).toBe(0.06);
    // bad stepUsd (0) → reset to default 100, so 500/100 = 5 steps → 0.06
    expect(r(computeBalanceLotSize(500, 0.01, 0))).toBe(0.06);
  });
});

describe("buildOrderInput balance-based lot sizing", () => {
  function balanceSpec(balance: number, opts: Partial<LiveExecutionConfig> = {}): StrategySpec {
    return {
      ...baseSpec(false),
      live: {
        ...baseSpec(false).live,
        accountBalance: balance,
        useBalanceLotSizing: true,
        ...opts,
      } as any,
    };
  }

  it("uses 0.01 lot for sub-$100 balance", () => {
    const input = buildOrderInput(baseSignal(), balanceSpec(50), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.01);
  });

  it("uses 0.02 lot at $100 balance when risk guard is inactive", () => {
    const signal = { ...baseSignal(), stopLoss: 1.0895 }; // 5-pip stop → risk lot > balance lot
    const input = buildOrderInput(signal, balanceSpec(100), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.02, 5);
  });

  it("caps balance sizing by risk% at $1000 balance", () => {
    // Default 20-pip stop: risk lot = 0.05, balance ladder = 0.11 → risk guard wins.
    const input = buildOrderInput(baseSignal(), balanceSpec(1000), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.05, 2);
  });

  it("respects maxLot cap with balance sizing", () => {
    const input = buildOrderInput(
      baseSignal(),
      balanceSpec(5000, { maxLot: 0.1 }),
      "trace-1",
      undefined,
      snapshotWithGrade("A+")
    );
    // 5000 / 100 = 50 steps → 0.51 lots, capped at 0.1
    expect(input.lot_size).toBe(0.1);
  });

  it("takes precedence over grade-based sizing but still respects risk guard", () => {
    // Even with A+ grade (which would normally be 0.05), balance sizing wins,
    // but the risk guard caps it below the raw balance ladder.
    const spec = { ...balanceSpec(300), live: { ...balanceSpec(300).live, useGradeLotSizing: true } as any };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.015, 3); // 1% of $300 / 20 pips / $10
  });

  it("falls back to grade sizing when balance is missing", () => {
    const spec = {
      ...baseSpec(true),
      live: { ...baseSpec(true).live, accountBalance: 0, useBalanceLotSizing: true } as any,
    };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.05);
  });

  it("caps balance sizing by risk% on a wide stop", () => {
    // $5,000 balance → balance ladder = 0.51 lots.
    // 100-pip stop on EURUSD with 1% risk → risk lot ≈ 0.05 lots.
    const signal = { ...baseSignal(), stopLoss: 1.08 }; // 100 pips vs default 20
    const spec = balanceSpec(5000);
    const input = buildOrderInput(signal, spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.05, 2);
  });

  it("uses balance ladder when risk%-based lot is larger", () => {
    // $1000 balance → balance ladder = 0.11 lots.
    // 5-pip stop with 1% risk → risk lot ≈ 0.2 lots.
    const signal = { ...baseSignal(), stopLoss: 1.0895 };
    const input = buildOrderInput(signal, balanceSpec(1000), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.11);
  });

  it("uses balance ladder when no risk config is provided", () => {
    const spec = {
      ...baseSpec(false),
      live: {
        ...baseSpec(false).live,
        accountBalance: 1000,
        riskPerTradePct: undefined,
        useBalanceLotSizing: true,
      } as any,
    };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.11);
  });
});

describe("computeProfitLotSize", () => {
  const r = (n: number) => Math.round(n * 100) / 100;

  it("returns base 0.01 when there is no profit", () => {
    expect(r(computeProfitLotSize(0))).toBe(0.01);
    expect(r(computeProfitLotSize(-50))).toBe(0.01);
  });

  it("adds 0.01 per $100 of profit by default", () => {
    expect(r(computeProfitLotSize(50))).toBe(0.01);
    expect(r(computeProfitLotSize(100))).toBe(0.02);
    expect(r(computeProfitLotSize(199.99))).toBe(0.02);
    expect(r(computeProfitLotSize(200))).toBe(0.03);
    expect(r(computeProfitLotSize(500))).toBe(0.06);
  });

  it("respects custom baseSize and stepUsd", () => {
    expect(r(computeProfitLotSize(0, 0.02, 50))).toBe(0.02);
    expect(r(computeProfitLotSize(75, 0.02, 50))).toBe(0.04);
    expect(r(computeProfitLotSize(150, 0.02, 50))).toBe(0.08);
  });
});

describe("buildOrderInput profit-based lot sizing", () => {
  function profitSpec(profit: number, opts: Partial<LiveExecutionConfig> = {}): StrategySpec {
    return {
      ...baseSpec(false),
      live: {
        ...baseSpec(false).live,
        useProfitLotSizing: true,
        realizedProfit: profit,
        ...opts,
      } as any,
    };
  }

  it("uses 0.01 lot with zero profit", () => {
    const input = buildOrderInput(baseSignal(), profitSpec(0), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBe(0.01);
  });

  it("uses 0.02 lot after $100 profit", () => {
    const signal = { ...baseSignal(), stopLoss: 1.0895 }; // 5-pip stop → risk lot > profit lot
    const input = buildOrderInput(signal, profitSpec(100), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.02, 5);
  });

  it("caps profit sizing by risk% on a wide stop", () => {
    // $500 profit → profit ladder = 0.06 lots.
    // 100-pip stop on EURUSD with 1% risk on $10k → risk lot ≈ 0.1 lots.
    // The smaller profit-lot value wins.
    const signal = { ...baseSignal(), stopLoss: 1.08 };
    const input = buildOrderInput(signal, profitSpec(500), "trace-1", undefined, snapshotWithGrade("A+"));
    expect(input.lot_size).toBeCloseTo(0.06, 2);
  });

  it("respects maxLot cap with profit sizing", () => {
    const input = buildOrderInput(
      baseSignal(),
      profitSpec(5000, { maxLot: 0.1 }),
      "trace-1",
      undefined,
      snapshotWithGrade("A+")
    );
    // 5000 / 100 = 50 steps → 0.51 lots, capped at 0.1
    expect(input.lot_size).toBe(0.1);
  });

  it("takes precedence over balance-based sizing when enabled", () => {
    const spec = {
      ...baseSpec(false),
      live: {
        ...baseSpec(false).live,
        accountBalance: 10000,
        useBalanceLotSizing: true,
        useProfitLotSizing: true,
        realizedProfit: 50,
      } as any,
    };
    const input = buildOrderInput(baseSignal(), spec, "trace-1", undefined, snapshotWithGrade("A+"));
    // Profit sizing wins: $50 profit → 0.01, not $10k balance → 1.01
    expect(input.lot_size).toBe(0.01);
  });
});
