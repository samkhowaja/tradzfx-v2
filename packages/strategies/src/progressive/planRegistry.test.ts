import { describe, expect, it } from "vitest";
import type { Pool } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import { loadProgressivePlan, registerProgressivePlan } from "./planRegistry";
import type { ProgressivePlan } from "./types";

function makePlan(): ProgressivePlan {
  const unsigned = {
    contractVersion: 2 as const,
    strategyId: "registry_test",
    strategyVersion: "2",
    roots: ["entry"],
    terminals: ["entry"],
    topologicalOrder: ["entry"],
    nodes: [{
      id: "entry", kind: "entry" as const, feature: "features_displacement", tf: "15m" as const,
      predicate: "1=1", dependencies: [], dependencyMode: "all" as const, quorum: 0,
      ttlBars: null, rank: null, identityColumns: [], directionMap: "same" as const,
      consumption: "exclusive_setup" as const, terminal: "entry_ready" as const, session: null,
    }],
  };
  return { ...unsigned, planHash: hashProgressiveValue(unsigned) };
}

function mockPool(results: Array<{ rows: unknown[] }>): Pool {
  return { query: async () => results.shift() ?? { rows: [] } } as unknown as Pool;
}

describe("progressive plan registry", () => {
  it("registers a correctly hashed immutable plan", async () => {
    await expect(registerProgressivePlan(mockPool([{ rows: [{ plan_hash: makePlan().planHash }] }]), makePlan()))
      .resolves.toBe(true);
  });

  it("rejects incorrect plan hash before DB access", async () => {
    const plan = { ...makePlan(), planHash: "f".repeat(64) };
    await expect(registerProgressivePlan(mockPool([]), plan)).rejects.toThrow("plan hash mismatch");
  });

  it("accepts canonical JSONB replay and rejects collision", async () => {
    const plan = makePlan();
    await expect(registerProgressivePlan(mockPool([{ rows: [] }, { rows: [{ plan_json: plan }] }]), plan))
      .resolves.toBe(false);
    await expect(registerProgressivePlan(mockPool([{ rows: [] }, { rows: [{ plan_json: { ...plan, strategyId: "changed" } }] }]), plan))
      .rejects.toThrow("plan identity collision");
  });

  it("loads by hash and detects corrupt embedded identity", async () => {
    const plan = makePlan();
    await expect(loadProgressivePlan(mockPool([{ rows: [{ plan_json: plan }] }]), plan.planHash)).resolves.toEqual(plan);
    await expect(loadProgressivePlan(mockPool([{ rows: [{ plan_json: { ...plan, planHash: "0".repeat(64) } }] }]), plan.planHash))
      .rejects.toThrow("registry corruption");
  });
});
