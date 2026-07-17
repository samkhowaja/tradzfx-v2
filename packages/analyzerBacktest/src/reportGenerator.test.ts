import { describe, it, expect } from "vitest";
import { generateReport } from "./reportGenerator";
import type { BacktestTrade } from "./runBacktest";

function makeTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    ts: "2026-01-01T00:00:00Z",
    grade: "A",
    direction: "long",
    confidence: 70,
    entryZone: { top: 101, bottom: 99 },
    stopLoss: 98,
    takeProfit: 103,
    riskReward: 2.5,
    outcome: "win",
    outcomeR: 2,
    exitPrice: 103,
    exitTs: "2026-01-01T01:00:00Z",
    barsHeld: 10,
    htfState: "READY",
    sessionName: "NY",
    effectiveEntry: 100,
    maxAdverseR: 0.5,
    maxFavorableR: 2.1,
    ...overrides,
  };
}

describe("generateReport", () => {
  it("computes basic metrics", () => {
    const trades = [
      makeTrade({ outcome: "win", outcomeR: 2 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
      makeTrade({ outcome: "win", outcomeR: 1 }),
    ];
    const report = generateReport(trades);
    expect(report.totalTrades).toBe(3);
    expect(report.winRate).toBeCloseTo(2 / 3);
    expect(report.totalR).toBe(2);
    expect(report.avgR).toBeCloseTo(2 / 3);
  });

  it("computes risk-return metrics", () => {
    const trades = [
      makeTrade({ outcome: "win", outcomeR: 2 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
      makeTrade({ outcome: "win", outcomeR: 1 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
    ];
    const rr = generateReport(trades).riskReturn;
    expect(rr.profitFactor).toBe(3 / 2);
    expect(rr.payoffRatio).toBe(1.5);
    expect(rr.avgWinR).toBe(1.5);
    expect(rr.avgLossR).toBe(-1);
    expect(rr.expectancy).toBeCloseTo(0.25);
    expect(rr.equityCurve.length).toBe(4);
    expect(rr.streaks.maxWinStreak).toBe(1);
    expect(rr.winRateConfidence.winRate).toBe(0.5);
    // Sortino is reported as a per-trade ratio, not annualized by sqrt(n).
    expect(rr.sortinoRatio).toBeCloseTo(0.25 / Math.sqrt(0.5));
  });

  it("groups by direction", () => {
    const trades = [
      makeTrade({ direction: "long", outcome: "win", outcomeR: 1 }),
      makeTrade({ direction: "short", outcome: "loss", outcomeR: -1 }),
    ];
    const report = generateReport(trades);
    expect(report.byDirection).toHaveLength(2);
    expect(report.byDirection.find((d) => d.direction === "long")?.wins).toBe(1);
    expect(report.byDirection.find((d) => d.direction === "short")?.losses).toBe(1);
  });

  it("computes drawdown correctly", () => {
    const trades = [
      makeTrade({ outcome: "win", outcomeR: 2 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
      makeTrade({ outcome: "loss", outcomeR: -1 }),
    ];
    const rr = generateReport(trades).riskReturn;
    expect(rr.maxDrawdownR).toBe(-3);
  });

  it("handles empty trades gracefully", () => {
    const report = generateReport([]);
    expect(report.totalTrades).toBe(0);
    expect(report.riskReturn.profitFactor).toBe(0);
    expect(report.riskReturn.sharpeRatio).toBe(0);
  });
});
