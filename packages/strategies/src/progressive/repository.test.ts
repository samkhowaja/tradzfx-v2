import { describe, expect, it } from "vitest";
import type { Pool } from "@tm/shared";
import { applyProgressiveEvent, createProgressiveInstance, enqueueProgressiveEvent } from "./repository";
import { createProgressiveSetupState } from "./reducer";
import type { ProgressiveLifecycleEvent } from "./lifecycleTypes";
import type { ProgressivePlan } from "./types";

const plan: ProgressivePlan = {
  contractVersion: 2,
  strategyId: "repo_test",
  strategyVersion: "2",
  planHash: "a".repeat(64),
  roots: ["context"],
  terminals: ["context"],
  topologicalOrder: ["context"],
  nodes: [{
    id: "context", kind: "context", feature: "features_bias", tf: "1h",
    predicate: "1=1", dependencies: [], dependencyMode: "all", quorum: 0,
    ttlBars: null, rank: null, identityColumns: [], directionMap: "same",
    consumption: "reusable", terminal: "entry_ready", session: null,
  }],
};

const event: ProgressiveLifecycleEvent = {
  id: "event-1",
  type: "evidence",
  setupInstanceId: "setup-1",
  planHash: plan.planHash,
  nodeId: "context",
  symbol: "XAUUSD",
  occurredAt: "2026-07-23T08:00:00Z",
  identity: {
    feature: "features_bias", symbol: "XAUUSD", tf: "1h",
    sourceTs: "2026-07-23T08:00:00Z", sourceKey: "bias-1",
  },
  side: "buy",
  values: { direction: "bullish" },
};

function poolWithQueries(results: Array<{ rows: unknown[] }>): { pool: Pool; calls: Array<{ sql: string; values?: unknown[] }> } {
  const calls: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    query: async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      const result = results.shift();
      if (!result) throw new Error(`Unexpected query: ${sql}`);
      return result;
    },
  } as unknown as Pool;
  return { pool, calls };
}

describe("progressive lifecycle repository", () => {
  it("enqueues immutable event once", async () => {
    const mock = poolWithQueries([{ rows: [{ event_id: event.id }] }]);
    const result = await enqueueProgressiveEvent(mock.pool, event);
    expect(result.inserted).toBe(true);
    expect(result.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(mock.calls[0].values?.[0]).toBe(event.id);
  });

  it("accepts exact event replay but rejects payload collision", async () => {
    const first = poolWithQueries([{ rows: [] }, { rows: [{ payload_hash: "wrong" }] }]);
    await expect(enqueueProgressiveEvent(first.pool, event)).rejects.toThrow("event identity collision");

    const inserted = poolWithQueries([{ rows: [{ event_id: event.id }] }]);
    const hash = (await enqueueProgressiveEvent(inserted.pool, event)).payloadHash;
    const replay = poolWithQueries([{ rows: [] }, { rows: [{ payload_hash: hash }] }]);
    await expect(enqueueProgressiveEvent(replay.pool, event)).resolves.toEqual({ inserted: false, payloadHash: hash });
  });

  it("returns existing matching instance and rejects identity collision", async () => {
    const matchingState = { setupInstanceId: "setup-1" };
    const matching = poolWithQueries([
      { rows: [] },
      { rows: [{ state_json: matchingState, plan_hash: plan.planHash, symbol: "XAUUSD" }] },
    ]);
    await expect(createProgressiveInstance(matching.pool, plan, "setup-1", "XAUUSD")).resolves.toEqual(matchingState);

    const collision = poolWithQueries([
      { rows: [] },
      { rows: [{ state_json: matchingState, plan_hash: "b".repeat(64), symbol: "XAUUSD" }] },
    ]);
    await expect(createProgressiveInstance(collision.pool, plan, "setup-1", "XAUUSD")).rejects.toThrow("instance identity collision");
  });

  it("rolls back and releases client when locked event is missing", async () => {
    const calls: string[] = [];
    let released = false;
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("SELECT payload_json")) return { rows: [] };
        return { rows: [] };
      },
      release: () => { released = true; },
    };
    const pool = { connect: async () => client } as unknown as Pool;
    await expect(applyProgressiveEvent(pool, plan, "missing")).rejects.toThrow("event not found");
    expect(calls[0]).toBe("BEGIN");
    expect(calls.at(-1)).toBe("ROLLBACK");
    expect(released).toBe(true);
  });

  it("ignores exclusive evidence already consumed by another setup", async () => {
    const exclusivePlan: ProgressivePlan = {
      ...plan,
      nodes: [{ ...plan.nodes[0], consumption: "exclusive_setup" }],
    };
    const state = createProgressiveSetupState(exclusivePlan, "setup-1", "XAUUSD");
    const calls: string[] = [];
    const client = {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql.includes("SELECT payload_json")) {
          return { rows: [{ payload_json: event, processing_status: "pending", claim_token: "claim-1" }] };
        }
        if (sql.includes("SELECT state_json")) return { rows: [{ state_json: state }] };
        if (sql.includes("SELECT 1 FROM progressive_setup_node")) return { rows: [{ "?column?": 1 }] };
        return { rows: [] };
      },
      release: () => undefined,
    };
    const pool = { connect: async () => client } as unknown as Pool;
    const result = await applyProgressiveEvent(pool, exclusivePlan, event.id, "claim-1");
    expect(result.inboxStatus).toBe("ignored");
    expect(result.ignoredReason).toBe("exclusive_evidence_consumed");
    expect(calls.some((sql)=>sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(calls.at(-1)).toBe("COMMIT");
  });
});
