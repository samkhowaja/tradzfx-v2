import { describe, expect, it } from "vitest";
import type { ProgressiveStepV2, StrategySpec } from "@tm/shared";
import { compileProgressivePlan } from "./planner";
import { validateProgressiveV2Spec } from "./validator";

function node(overrides: Partial<ProgressiveStepV2>): ProgressiveStepV2 {
  return {
    id: "context",
    kind: "context",
    feature: "features_bias",
    tf: "1h",
    predicate: "direction != 'neutral'",
    dependencies: [],
    ...overrides,
  };
}

function spec(steps: ProgressiveStepV2[]): StrategySpec {
  return {
    id: "dag_v2_test",
    name: "DAG v2 Test",
    version: "2.0.0",
    progressiveVersion: 2,
    progressiveSteps: steps,
    filters: { symbols: ["XAUUSD"] },
    setup: [],
    entry: [],
    risk: { sl: "atr(15m) * 1.2", tp: "sl * 3", minRR: 3, timeoutBars: 10 },
    gates: [],
  };
}

function validSpec(): StrategySpec {
  return spec([
    node({ id: "context" }),
    node({
      id: "zone",
      kind: "object",
      feature: "features_zone",
      tf: "15m",
      predicate: "kind IN ('demand','supply')",
      dependencies: [{ stepId: "context", relation: "as_of" }],
      identityColumns: ["zone_id"],
    }),
    node({
      id: "sweep",
      kind: "event",
      feature: "features_sweep",
      tf: "15m",
      predicate: "sweep_type IN ('high','low')",
      dependencies: [{ stepId: "zone", relation: "within", minDelayBars: 0, maxDelayBars: 8 }],
    }),
    node({
      id: "structure",
      kind: "confirmation",
      feature: "features_structure",
      tf: "15m",
      predicate: "event_type IN ('bos','mss')",
      dependencies: [
        { stepId: "zone", relation: "after" },
        { stepId: "sweep", relation: "after", maxDelayBars: 4 },
      ],
      dependencyMode: "all",
    }),
    node({
      id: "entry",
      kind: "entry",
      feature: "features_displacement",
      tf: "15m",
      predicate: "direction != 'neutral'",
      dependencies: [{ stepId: "structure", relation: "after", maxDelayBars: 2 }],
      terminal: "entry_ready",
    }),
  ]);
}

describe("progressive DAG v2 validation", () => {
  it("accepts explicit causal DAG", () => {
    expect(validateProgressiveV2Spec(validSpec()).errors).toEqual([]);
  });

  it("rejects progressiveSteps without version switch", () => {
    const candidate = validSpec();
    delete candidate.progressiveVersion;
    expect(validateProgressiveV2Spec(candidate).errors).toContain(
      "dag_v2_test: progressiveSteps requires progressiveVersion: 2",
    );
  });

  it("rejects dangling edge and cycle", () => {
    const candidate = validSpec();
    candidate.progressiveSteps![0].dependencies = [{ stepId: "entry", relation: "after" }];
    candidate.progressiveSteps![1].dependencies.push({ stepId: "missing", relation: "after" });
    const errors = validateProgressiveV2Spec(candidate).errors;
    expect(errors.some((error) => error.includes("missing node 'missing'"))).toBe(true);
    expect(errors.some((error) => error.includes("cycle detected"))).toBe(true);
  });

  it("rejects unbounded within edge", () => {
    const candidate = validSpec();
    delete candidate.progressiveSteps![2].dependencies[0].maxDelayBars;
    expect(validateProgressiveV2Spec(candidate).errors.some((error) => error.includes("requires maxDelayBars"))).toBe(true);
  });

  it("rejects invalid quorum", () => {
    const candidate = validSpec();
    const structure = candidate.progressiveSteps![3];
    structure.dependencyMode = "quorum";
    structure.quorum = 3;
    expect(validateProgressiveV2Spec(candidate).errors.some((error) => error.includes("quorum must be between"))).toBe(true);
  });

  it("rejects nodes disconnected from entry terminal", () => {
    const candidate = validSpec();
    candidate.progressiveSteps!.push(node({ id: "orphan", kind: "event", feature: "features_structure" }));
    expect(validateProgressiveV2Spec(candidate).errors.some((error) => error.includes("'orphan' cannot reach"))).toBe(true);
  });

  it("rejects unsafe ranking syntax", () => {
    const candidate = validSpec();
    candidate.progressiveSteps![1].rank = { limit: 1, orderBy: "rank_score DESC; DROP TABLE trades" };
    expect(validateProgressiveV2Spec(candidate).errors.some((error) => error.includes("unsupported syntax"))).toBe(true);
  });
});

describe("progressive DAG v2 planner", () => {
  it("produces deterministic order and hash", () => {
    const first = compileProgressivePlan(validSpec());
    const second = compileProgressivePlan(validSpec());
    expect(first.topologicalOrder).toEqual(["context", "zone", "sweep", "structure", "entry"]);
    expect(first.roots).toEqual(["context"]);
    expect(first.terminals).toEqual(["entry"]);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toEqual(first);
  });

  it("normalizes dependency modes and temporal bounds", () => {
    const plan = compileProgressivePlan(validSpec());
    const structure = plan.nodes.find((candidate) => candidate.id === "structure")!;
    expect(structure.dependencyMode).toBe("all");
    expect(structure.quorum).toBe(2);
    expect(structure.dependencies[0]).toEqual({
      stepId: "zone",
      relation: "after",
      minDelayBars: 0,
      maxDelayBars: null,
    });
  });

  it("refuses invalid plan compilation", () => {
    const candidate = validSpec();
    candidate.progressiveSteps![4].dependencies = [{ stepId: "missing", relation: "after" }];
    expect(() => compileProgressivePlan(candidate)).toThrow("Invalid progressive DAG v2 spec");
  });
});
