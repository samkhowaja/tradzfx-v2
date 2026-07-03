import { describe, it, expect } from "vitest";
import { trackOutcome } from "./outcomeTracker";

describe("trackOutcome", () => {
  it("returns win when TP is hit before SL (long)", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 101, l: 99.5, c: 100.5, v: 1 },
      { ts: "2026-01-01T00:02:00Z", o: 100.5, h: 104, l: 100, c: 103, v: 1 },
    ];
    const result = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future);
    expect(result.outcome).toBe("win");
    expect(result.outcomeR).toBeGreaterThan(0);
    expect(result.exitPrice).toBe(103);
    expect(result.effectiveEntry).toBe(100);
  });

  it("returns loss when SL is hit before TP (long)", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 100.5, l: 97.5, c: 98, v: 1 },
      { ts: "2026-01-01T00:02:00Z", o: 98, h: 103, l: 97, c: 102, v: 1 },
    ];
    const result = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future);
    expect(result.outcome).toBe("loss");
    expect(result.outcomeR).toBe(-1);
    expect(result.exitPrice).toBe(98);
  });

  it("returns loss when SL is hit first (short)", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 102, l: 99.5, c: 101, v: 1 },
    ];
    const result = trackOutcome("short", { top: 101, bottom: 99 }, 102, 97, future);
    expect(result.outcome).toBe("loss");
  });

  it("returns timeout when neither level is touched by endTs", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 100.5, l: 99.5, c: 100.1, v: 1 },
    ];
    const result = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future);
    expect(result.outcome).toBe("timeout");
    expect(result.outcomeR).toBe(0);
  });

  it("reduces win R when spread and slippage are applied", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 104, l: 100, c: 103, v: 1 },
    ];
    const raw = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future);
    const withCosts = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future, {
      spreadPips: 2,
      slippagePips: 1,
      pipSize: 0.01,
    });
    expect(raw.outcomeR).toBe(1.5);
    expect(withCosts.outcomeR).toBeLessThan(raw.outcomeR);
    expect(withCosts.effectiveEntry).toBeGreaterThan(raw.effectiveEntry!);
  });

  it("handles same-bar SL/TP according to intrabar mode", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 104, l: 97, c: 101, v: 1 },
    ];
    const optimistic = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future, {
      intrabarMode: "optimistic",
    });
    const pessimistic = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future, {
      intrabarMode: "pessimistic",
    });
    expect(optimistic.outcome).toBe("win");
    expect(pessimistic.outcome).toBe("loss");
  });

  it("tracks MAE/MFE correctly", () => {
    const future = [
      { ts: "2026-01-01T00:01:00Z", o: 100, h: 100.5, l: 99, c: 99.5, v: 1 },
      { ts: "2026-01-01T00:02:00Z", o: 99.5, h: 105, l: 99, c: 104, v: 1 },
    ];
    const result = trackOutcome("long", { top: 101, bottom: 99 }, 98, 103, future);
    expect(result.maxAdverseR).toBeGreaterThan(0);
    expect(result.maxFavorableR).toBeGreaterThan(0);
  });
});
