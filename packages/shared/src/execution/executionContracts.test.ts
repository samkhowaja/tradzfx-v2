import { describe, expect, it } from "vitest";
import {
  ENTRY_DRIFT_REJECTION_CODE,
  INVALID_BRACKET_CODE,
  MIN_STOP_REJECTION_CODE,
  evaluateEntryDrift,
  validateExecutionGeometry,
  validateStopPips,
} from "./executionContracts";

describe("execution contracts", () => {
  it("accepts entry drift at boundary and rejects above it", () => {
    expect(evaluateEntryDrift("EURUSD", 1.1, 1.1002, 2).accepted).toBe(true);
    const rejected = evaluateEntryDrift("EURUSD", 1.1, 1.10021, 2);
    expect(rejected.accepted).toBe(false);
    expect(rejected.code).toBe(ENTRY_DRIFT_REJECTION_CODE);
  });

  it("uses registry minimum stop", () => {
    const rejected = validateStopPips("XAUUSD", 9);
    expect(rejected.valid).toBe(false);
    expect(rejected.code).toBe(MIN_STOP_REJECTION_CODE);
    expect(rejected.minStopPips).toBe(10);
  });

  it("rejects degenerate directional bracket", () => {
    const rejected = validateExecutionGeometry({
      symbol: "EURUSD",
      side: "buy",
      entry: 1.1,
      stopLoss: 1.101,
      takeProfit: 1.103,
    });
    expect(rejected.valid).toBe(false);
    if (rejected.valid) throw new Error("expected invalid bracket");
    expect(rejected.code).toBe(INVALID_BRACKET_CODE);
  });

  it("accepts valid bracket above minimum stop", () => {
    const accepted = validateExecutionGeometry({
      symbol: "EURUSD",
      side: "sell",
      entry: 1.1,
      stopLoss: 1.101,
      takeProfit: 1.098,
    });
    expect(accepted.valid).toBe(true);
  });
});
