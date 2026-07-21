import { describe, expect, it } from "vitest";
import {
  compareReplayDecision,
  compareReplaySignal,
  replaySignalFingerprint,
  type ComparableSignal,
} from "./replayComparison";

describe("replay decision comparison", () => {
  it("matches identical execution decisions", () => {
    expect(compareReplayDecision(
      { executed: true, reason: null },
      { executed: true, reason: null },
    )).toMatchObject({ mismatchClass: "MATCH", decisionMatch: true });
  });

  it("classifies replay-only execution", () => {
    expect(compareReplayDecision(
      { executed: true, reason: null },
      { executed: false, reason: "gates_failed: spread" },
    )).toMatchObject({
      mismatchClass: "REPLAY_ONLY_EXECUTION",
      decisionMatch: false,
      differences: ["executed", "reason"],
    });
  });
});

const signal: ComparableSignal = {
  symbol: "XAUUSD",
  strategyId: "watukushay_no1",
  ts: "2026-07-19T12:15:00.000Z",
  side: "buy",
  entryType: "market",
  entryPrice: 3350.5,
  stopLoss: 3345.5,
  takeProfit: 3365.5,
};

describe("replay signal comparison", () => {
  it("returns MATCH for identical signals", () => {
    const result = compareReplaySignal(signal, { ...signal });
    expect(result.mismatchClass).toBe("MATCH");
    expect(result.signalMatch).toBe(true);
    expect(result.differences).toEqual([]);
  });

  it("classifies missing signals", () => {
    expect(compareReplaySignal(null, signal).mismatchClass).toBe("LIVE_ONLY");
    expect(compareReplaySignal(signal, null).mismatchClass).toBe("REPLAY_ONLY");
    expect(compareReplaySignal(null, null).mismatchClass).toBe("MATCH");
  });

  it("reports geometry drift", () => {
    const result = compareReplaySignal(signal, { ...signal, takeProfit: 3366 });
    expect(result.mismatchClass).toBe("SIGNAL_GEOMETRY");
    expect(result.differences).toContain("take_profit");
  });

  it("includes timestamp in replay identity", () => {
    const later = { ...signal, ts: "2026-07-19T12:30:00.000Z" };
    expect(replaySignalFingerprint(signal)).not.toBe(replaySignalFingerprint(later));
  });
});
