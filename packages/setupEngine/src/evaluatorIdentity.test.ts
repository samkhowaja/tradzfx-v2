import { describe, expect, it } from "vitest";
import {
  buildSetupEvaluatorIdentity,
  canReuseEvaluationFromCache,
  SETUP_EVALUATOR_ID,
  SETUP_ENGINE_EVALUATOR_VERSION,
} from "./evaluatorIdentity";

describe("buildSetupEvaluatorIdentity", () => {
  it("stamps fixed evaluator id and version with caller-supplied environment", () => {
    const identity = buildSetupEvaluatorIdentity({
      evaluationEnvironment: "pit",
      strategyId: "watukushay_no1",
      strategyFamilyId: "watukushay",
      strategySpecVersion: "1.2.0",
      signalContextHash: "abc123",
    });
    expect(identity.evaluatorId).toBe(SETUP_EVALUATOR_ID);
    expect(identity.evaluatorVersion).toBe(SETUP_ENGINE_EVALUATOR_VERSION);
    expect(identity.setupEngineVersion).toBe(SETUP_ENGINE_EVALUATOR_VERSION);
    expect(identity.evaluationEnvironment).toBe("pit");
    expect(identity.strategyId).toBe("watukushay_no1");
    expect(identity.strategyFamilyId).toBe("watukushay");
    expect(identity.strategySpecVersion).toBe("1.2.0");
    expect(identity.signalContextHash).toBe("abc123");
  });

  it("records live environment for live runner evaluations", () => {
    const identity = buildSetupEvaluatorIdentity({
      evaluationEnvironment: "live",
      strategyId: "watukushay_no1",
    });
    expect(identity.evaluationEnvironment).toBe("live");
    expect(identity.signalContextHash).toBeUndefined();
  });
});

describe("canReuseEvaluationFromCache (strict mode)", () => {
  const expected = {
    evaluatorVersion: SETUP_ENGINE_EVALUATOR_VERSION,
    strategyId: "watukushay_no1",
    strategyFamilyId: "watukushay",
  };
  const matchingLineage = buildSetupEvaluatorIdentity({
    evaluationEnvironment: "pit",
    strategyId: "watukushay_no1",
    strategyFamilyId: "watukushay",
  });

  it("rejects rows with NULL lineage in strict mode", () => {
    expect(canReuseEvaluationFromCache({ lineage: null }, expected)).toBe(false);
    expect(canReuseEvaluationFromCache({}, expected)).toBe(false);
  });

  it("allows NULL lineage only in explicit legacy-compat mode", () => {
    expect(
      canReuseEvaluationFromCache({ lineage: null }, expected, {
        allowLegacyNullLineage: true,
      })
    ).toBe(true);
  });

  it("rejects rows with a different evaluator version", () => {
    expect(
      canReuseEvaluationFromCache(
        { lineage: { ...matchingLineage, evaluatorVersion: "0.9.0" } },
        expected
      )
    ).toBe(false);
  });

  it("rejects rows with a different evaluator id", () => {
    expect(
      canReuseEvaluationFromCache(
        { lineage: { ...matchingLineage, evaluatorId: "other_engine" } },
        expected
      )
    ).toBe(false);
  });

  it("rejects rows with a different strategy id", () => {
    expect(
      canReuseEvaluationFromCache(
        { lineage: { ...matchingLineage, strategyId: "other_strategy" } },
        expected
      )
    ).toBe(false);
  });

  it("rejects rows with a different strategy family id", () => {
    expect(
      canReuseEvaluationFromCache(
        { lineage: { ...matchingLineage, strategyFamilyId: "other_family" } },
        expected
      )
    ).toBe(false);
  });

  it("reuses rows with matching lineage", () => {
    expect(canReuseEvaluationFromCache({ lineage: matchingLineage }, expected)).toBe(true);
  });
});
