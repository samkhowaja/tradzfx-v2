import { describe, it, expect } from "vitest";
import { evaluateExecutionQuality } from "./qualityEngine";
import type { Signal, StrategySpec } from "@tm/shared";

function mockPool(currentClose: number, spread = 0.2, atr = 0.001) {
  return {
    query: async (sql: string, _params: unknown[]) => {
      if (sql.includes("candles_1m")) {
        return { rows: [{ c: currentClose }] };
      }
      if (sql.includes("features_spread")) {
        return { rows: [{ spread }] };
      }
      if (sql.includes("features_atr")) {
        return { rows: [{ value: atr }] };
      }
      return { rows: [] };
    },
  } as any;
}

function baseSignal(overrides?: Partial<Signal>): Signal {
  return {
    symbol: "USDCHF",
    strategyId: "waqar_v2_15m",
    side: "buy",
    entryType: "market",
    entryPrice: 0.81191,
    stopLoss: 0.8111132,
    takeProfit: 0.8143004,
    ts: new Date(),
    confidence: 70,
    ...overrides,
  };
}

function baseSpec(overrides?: Partial<StrategySpec>): StrategySpec {
  return {
    id: "waqar_v2_15m",
    name: "Waqar Asim Scalp V2 (15m-only)",
    version: "2.0.1",
    filters: { symbols: ["USDCHF"] },
    setup: [],
    entry: [],
    signalSource: "zone",
    risk: { sl: "atr(15m) * 1.2", tp: "sl * 3.0", minRR: 3, timeoutBars: 180, maxFillBars: 45 },
    gates: [],
    live: {
      mode: "live",
      lotSize: 0.01,
      riskPerTradePct: 1,
      accountBalance: 10000,
      accountCurrency: "USD",
      signalTtlMinutes: 15,
      maxSpreadPips: 3,
      maxSlippagePoints: 20,
      entryZonePips: 0,
      maxPositionsPerSymbol: 1,
      maxPositionsTotal: 6,
      cooldownMinutes: 30,
      executionProfile: {
        entryStrategy: "market_if_close_else_limit",
        maxEntryDriftPips: 2,
        minEffectiveRR: 1,
        timeInForce: "GTC",
        limitTtlSeconds: 900,
      },
    },
    ...overrides,
  } as StrategySpec;
}

describe("evaluateExecutionQuality", () => {
  it("places a limit order when price has drifted past the signal entry", async () => {
    // Current price 0.8129 is ~10 pips above entry; effective RR drops below 1.
    const pool = mockPool(0.8129);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), baseSpec());
    expect(decision.action).toBe("limit");
    expect(decision.limitPrice).toBeCloseTo(0.81191, 5);
    expect(decision.executionStrategy).toBe("market_if_close_else_limit");
  });

  it("takes a market order when price is within drift tolerance", async () => {
    const pool = mockPool(0.81195);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), baseSpec());
    expect(decision.action).toBe("market");
  });

  it("takes a market order when price moved favorably and RR is still acceptable", async () => {
    // For a buy, current price below entry is favorable; RR improves.
    const pool = mockPool(0.8118);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), baseSpec());
    expect(decision.action).toBe("market");
  });

  it("respects a pure limit strategy", async () => {
    const spec = baseSpec({
      live: {
        ...baseSpec().live,
        executionProfile: {
          entryStrategy: "limit",
          maxEntryDriftPips: 2,
          minEffectiveRR: 1,
          timeInForce: "GTC",
          limitTtlSeconds: 900,
        },
      },
    } as StrategySpec);
    const pool = mockPool(0.8129);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), spec);
    expect(decision.action).toBe("limit");
  });

  it("rejects a pure market order when drift is too large", async () => {
    const spec = baseSpec({
      live: {
        ...baseSpec().live,
        executionProfile: {
          entryStrategy: "market",
          maxEntryDriftPips: 2,
          minEffectiveRR: 1,
          timeInForce: "GTC",
          limitTtlSeconds: 900,
        },
      },
    } as StrategySpec);
    const pool = mockPool(0.8129);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), spec);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toContain("drift");
  });

  it("rejects when effective RR is below threshold for market-only", async () => {
    const spec = baseSpec({
      live: {
        ...baseSpec().live,
        executionProfile: {
          entryStrategy: "market",
          maxEntryDriftPips: 10,
          minEffectiveRR: 2,
          timeInForce: "GTC",
          limitTtlSeconds: 900,
        },
      },
    } as StrategySpec);
    const pool = mockPool(0.8129);
    const decision = await evaluateExecutionQuality(pool, baseSignal(), spec);
    expect(decision.action).toBe("reject");
    expect(decision.reason).toContain("effective_rr");
  });
});
