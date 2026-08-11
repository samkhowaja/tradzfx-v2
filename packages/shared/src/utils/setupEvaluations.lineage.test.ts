import { describe, expect, it } from "vitest";
import { recordSetupEvaluation } from "./setupEvaluations";
import type { Queryable } from "./db";

function capturePool(): { pool: Queryable; calls: Array<{ sql: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params: params ?? [] });
      return { rows: [], rowCount: 1 };
    },
  } as unknown as Queryable;
  return { pool, calls };
}

const baseSnapshot = {
  symbol: "XAUUSD",
  tf: "1h" as const,
  ts: new Date("2026-07-22T14:00:00Z"),
  grade: "C",
  direction: "long",
  confidence: 60,
};

describe("recordSetupEvaluation lineage persistence", () => {
  it("writes all 8 lineage columns when lineage is present", async () => {
    const { pool, calls } = capturePool();
    await recordSetupEvaluation(pool, {
      ...baseSnapshot,
      lineage: {
        evaluatorId: "setup_engine",
        evaluatorVersion: "1.0.3",
        setupEngineVersion: "1.0.3",
        strategyId: "watukushay_no1",
        strategyFamilyId: "watukushay",
        strategySpecVersion: "1.0.0",
        signalContextHash: "abc123",
        evaluationEnvironment: "pit",
      },
    });

    expect(calls).toHaveLength(1);
    const { sql, params } = calls[0];
    expect(sql).toContain("evaluator_id");
    expect(sql).toContain("evaluator_version");
    expect(sql).toContain("setup_engine_version");
    expect(sql).toContain("strategy_id");
    expect(sql).toContain("strategy_family_id");
    expect(sql).toContain("strategy_spec_version");
    expect(sql).toContain("signal_context_hash");
    expect(sql).toContain("evaluation_environment");
    // ON CONFLICT clause preserved (order_id partial unique index target).
    expect(sql).toContain("ON CONFLICT (symbol, tf, ts, direction, order_id)");
    // Params 17-24 (0-indexed 16-23) are the lineage values.
    expect(params[16]).toBe("setup_engine");
    expect(params[17]).toBe("1.0.3");
    expect(params[18]).toBe("1.0.3");
    expect(params[19]).toBe("watukushay_no1");
    expect(params[20]).toBe("watukushay");
    expect(params[21]).toBe("1.0.0");
    expect(params[22]).toBe("abc123");
    expect(params[23]).toBe("pit");
  });

  it("writes NULL lineage columns when lineage is absent (legacy callers)", async () => {
    const { pool, calls } = capturePool();
    await recordSetupEvaluation(pool, { ...baseSnapshot });

    const { params } = calls[0];
    expect(params).toHaveLength(24);
    for (let i = 16; i < 24; i++) {
      expect(params[i]).toBeNull();
    }
  });

  it("persists live environment for live runner snapshots", async () => {
    const { pool, calls } = capturePool();
    await recordSetupEvaluation(
      pool,
      {
        ...baseSnapshot,
        lineage: {
          evaluatorId: "setup_engine",
          evaluatorVersion: "1.0.3",
          setupEngineVersion: "1.0.3",
          strategyId: "watukushay_no1",
          strategyFamilyId: "watukushay",
          evaluationEnvironment: "live",
        },
      },
      "order-123"
    );

    const { params } = calls[0];
    expect(params[13]).toBe("order-123");
    expect(params[23]).toBe("live");
    expect(params[22]).toBeNull(); // no signalContextHash on live rows
  });
});
