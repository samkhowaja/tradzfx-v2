import { describe, expect, it } from "vitest";
import type { StrategySpec } from "@tm/shared";
import {
  assertExecutionAllowedByDxyPolicy,
  DXY_NON_AUTHORITATIVE_BLOCKED,
  findNonAuthoritativeDxyDependency,
} from "./dxyGuard";

const spec = (withCorrelation: boolean): StrategySpec => ({
  id: "test",
  name: "Test",
  version: "1",
  active: false,
  filters: { symbols: ["XAUUSD"] },
  setup: withCorrelation
    ? [{ id: "dxy", feature: "features_correlation", tf: "15m", predicate: "reference_symbol = 'DXY'", required: false }]
    : [],
  entry: [],
  risk: { sl: "atr(5m)", tp: "sl * 2", minRR: 2, timeoutBars: 10 },
  gates: [],
});

describe("DXY execution guard", () => {
  it("finds optional correlation dependencies", () => {
    expect(findNonAuthoritativeDxyDependency(spec(true))).toBe("features_correlation@15m");
    expect(findNonAuthoritativeDxyDependency(spec(false))).toBeNull();
  });

  it("blocks execution and allows evaluation-only", () => {
    expect(() => assertExecutionAllowedByDxyPolicy(spec(true), false)).toThrow(
      `${DXY_NON_AUTHORITATIVE_BLOCKED}:features_correlation@15m`,
    );
    expect(() => assertExecutionAllowedByDxyPolicy(spec(true), true)).not.toThrow();
    expect(() => assertExecutionAllowedByDxyPolicy(spec(false), false)).not.toThrow();
  });
});
