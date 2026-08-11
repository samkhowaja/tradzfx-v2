import { describe, expect, it } from "vitest";
import { evaluateSetup } from "./evaluateSetup";
import { SETUP_EVALUATOR_ID, SETUP_ENGINE_EVALUATOR_VERSION } from "./evaluatorIdentity";
import type { Queryable } from "@tm/shared";

const fakePool: Queryable = {
  async query() {
    return { rows: [] };
  },
};

describe("setup evaluation lineage stamping", () => {
  it("attaches full lineage with live environment on the BLOCKED_DATA path", async () => {
    const result = await evaluateSetup(fakePool, {
      symbol: "XAUUSD",
      tf: "1h",
      asOf: new Date("2026-07-22T14:00:00Z"),
      direction: "long",
      strategyId: "watukushay_no1",
      familyId: "watukushay",
      strategySpecVersion: "1.0.0",
      evaluationEnvironment: "live",
    });

    // Fake pool returns no features -> BLOCKED_DATA early return, which must
    // still carry lineage.
    expect(result.lineage).toBeDefined();
    expect(result.lineage?.evaluatorId).toBe(SETUP_EVALUATOR_ID);
    expect(result.lineage?.evaluatorVersion).toBe(SETUP_ENGINE_EVALUATOR_VERSION);
    expect(result.lineage?.setupEngineVersion).toBe(SETUP_ENGINE_EVALUATOR_VERSION);
    expect(result.lineage?.evaluationEnvironment).toBe("live");
    expect(result.lineage?.strategyId).toBe("watukushay_no1");
    expect(result.lineage?.strategyFamilyId).toBe("watukushay");
    expect(result.lineage?.strategySpecVersion).toBe("1.0.0");
  });

  it("attaches pit environment and signal context hash when provided", async () => {
    const result = await evaluateSetup(fakePool, {
      symbol: "XAUUSD",
      tf: "1h",
      asOf: new Date("2026-07-22T14:00:00Z"),
      direction: "long",
      strategyId: "watukushay_no1",
      familyId: "watukushay",
      evaluationEnvironment: "pit",
      signalContextHash: "9105cc78cbb55c883728c6de5b72c916",
    });

    expect(result.lineage?.evaluationEnvironment).toBe("pit");
    expect(result.lineage?.signalContextHash).toBe("9105cc78cbb55c883728c6de5b72c916");
  });

  it("defaults environment to backtest when caller does not specify one", async () => {
    const result = await evaluateSetup(fakePool, {
      symbol: "EURUSD",
      tf: "5m",
      asOf: new Date("2026-08-03T12:00:00Z"),
    });
    expect(result.lineage?.evaluationEnvironment).toBe("backtest");
  });
});
