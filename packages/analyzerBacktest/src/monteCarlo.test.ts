import { describe, it, expect } from "vitest";
import { runMonteCarlo } from "./monteCarlo";
import type { BacktestTrade } from "./runBacktest";

function makeTrade(outcome: "win" | "loss", r: number): BacktestTrade {
  return {
    ts: "2026-01-01T00:00:00Z",
    grade: "A",
    direction: "long",
    confidence: 70,
    entryZone: { top: 101, bottom: 99 },
    stopLoss: 98,
    takeProfit: 103,
    riskReward: 2.5,
    outcome,
    outcomeR: r,
    exitPrice: outcome === "win" ? 103 : 98,
    exitTs: "2026-01-01T01:00:00Z",
    barsHeld: 10,
    htfState: "READY",
    sessionName: "NY",
    effectiveEntry: 100,
    maxAdverseR: 0.5,
    maxFavorableR: r,
  };
}

describe("runMonteCarlo", () => {
  it("returns empty result for no trades", () => {
    const result = runMonteCarlo([], { iterations: 100 });
    expect(result.finalEquity.mean).toBe(0);
    expect(result.iterations).toBe(100);
  });

  it("produces a profitable median for a positive edge", () => {
    const trades: BacktestTrade[] = [];
    for (let i = 0; i < 50; i++) {
      trades.push(makeTrade("win", 2));
      trades.push(makeTrade("loss", -1));
    }
    const result = runMonteCarlo(trades, { iterations: 1000 });
    expect(result.finalEquity.median).toBeGreaterThan(0);
    expect(result.probProfit).toBeGreaterThan(0.5);
    expect(result.maxDrawdown.worst).toBeGreaterThanOrEqual(0);
  });

  it("produces a losing median for a negative edge", () => {
    const trades: BacktestTrade[] = [];
    for (let i = 0; i < 50; i++) {
      trades.push(makeTrade("win", 1));
      trades.push(makeTrade("loss", -2));
    }
    const result = runMonteCarlo(trades, { iterations: 1000 });
    expect(result.finalEquity.median).toBeLessThan(0);
    expect(result.probProfit).toBeLessThan(0.5);
  });

  it("returns confidence bounds around the median", () => {
    const trades = [makeTrade("win", 2), makeTrade("loss", -1), makeTrade("win", 1)];
    const result = runMonteCarlo(trades, { iterations: 500, confidence: 0.95 });
    expect(result.confidence).toBe(0.95);
    expect(result.finalEquity.lower).toBeLessThanOrEqual(result.finalEquity.median);
    expect(result.finalEquity.upper).toBeGreaterThanOrEqual(result.finalEquity.median);
  });
});
