import { describe, expect, it } from "vitest";
import { getLevelMaxAgeMs, isLevelAliveAsOf } from "./aliveness";

const anchor = new Date("2026-07-21T00:00:00Z");
const base = { ts: "2026-07-20T00:00:00Z" };

describe("level aliveness", () => {
  it("rejects invalidation at or before anchor", () => {
    expect(isLevelAliveAsOf({ ...base, invalidatedAt: anchor }, anchor, "zone", "15m")).toBe(false);
  });

  it("rejects fill at 95 percent", () => {
    expect(isLevelAliveAsOf({ ...base, fillPct: 0.95 }, anchor, "zone", "15m")).toBe(false);
  });

  it("makes mitigation strategy-controlled", () => {
    const row = { ...base, mitigatedAt: "2026-07-20T12:00:00Z" };
    expect(isLevelAliveAsOf(row, anchor, "zone", "15m")).toBe(false);
    expect(isLevelAliveAsOf(row, anchor, "zone", "15m", { allowMitigated: true })).toBe(true);
  });

  it("makes first touch strategy-controlled while preserving retest default", () => {
    const row = { ...base, firstTouchAt: "2026-07-20T12:00:00Z" };
    expect(isLevelAliveAsOf(row, anchor, "zone", "15m")).toBe(true);
    expect(isLevelAliveAsOf(row, anchor, "zone", "15m", { allowTouched: false })).toBe(false);
  });

  it("rejects rows older than kind and timeframe limit", () => {
    expect(getLevelMaxAgeMs("zone", "15m")).toBe(5 * 86_400_000);
    expect(isLevelAliveAsOf({ ts: "2026-07-15T23:59:59Z" }, anchor, "zone", "15m")).toBe(false);
    expect(isLevelAliveAsOf({ ts: "2026-07-16T00:00:00Z" }, anchor, "zone", "15m")).toBe(true);
  });

  it("ignores lifecycle events after PIT anchor", () => {
    expect(isLevelAliveAsOf({
      ...base,
      firstTouchAt: "2026-07-22T00:00:00Z",
      mitigatedAt: "2026-07-22T00:00:00Z",
      invalidatedAt: "2026-07-22T00:00:00Z",
    }, anchor, "zone", "15m")).toBe(true);
  });
});
