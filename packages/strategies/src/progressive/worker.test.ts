import { describe, expect, it } from "vitest";
import type { Pool } from "@tm/shared";
import {
  listPendingProgressiveEvents,
  processProgressiveShadowBatch,
  readProgressiveShadowWorkerConfig,
} from "./worker";

describe("progressive shadow worker", () => {
  it("defaults disabled and shadow-only", () => {
    expect(readProgressiveShadowWorkerConfig({})).toEqual({
      enabled: false, mode: "shadow", batchSize: 100, leaseSeconds: 60, maxAttempts: 5,
    });
    expect(readProgressiveShadowWorkerConfig({
      TM_PROGRESSIVE_DAG_ENABLED: "true",
      TM_PROGRESSIVE_DAG_MODE: "shadow",
      TM_PROGRESSIVE_DAG_BATCH_SIZE: "25",
    })).toEqual({ enabled: true, mode: "shadow", batchSize: 25, leaseSeconds: 60, maxAttempts: 5 });
  });

  it("rejects every non-shadow activation mode", () => {
    expect(() => readProgressiveShadowWorkerConfig({ TM_PROGRESSIVE_DAG_MODE: "live" }))
      .toThrow("only shadow is supported");
    expect(() => readProgressiveShadowWorkerConfig({ TM_PROGRESSIVE_DAG_BATCH_SIZE: "0" }))
      .toThrow("must be an integer from 1 to 1000");
  });

  it("does no DB work while disabled", async () => {
    const pool = { query: async () => { throw new Error("DB must not be queried"); } } as unknown as Pool;
    await expect(processProgressiveShadowBatch(
      pool,
      async () => { throw new Error("resolver must not run"); },
      { enabled: false, mode: "shadow", batchSize: 100 },
    )).resolves.toEqual({ selected: 0, applied: 0, ignored: 0, errors: [] });
  });

  it("selects pending events in deterministic data-time order", async () => {
    let sql = "";
    let values: unknown[] | undefined;
    const pool = {
      query: async (query: string, params?: unknown[]) => {
        sql = query;
        values = params;
        return { rows: [
          { event_id: "a", plan_hash: "1".repeat(64) },
          { event_id: "b", plan_hash: "2".repeat(64) },
        ] };
      },
    } as unknown as Pool;
    await expect(listPendingProgressiveEvents(pool, 2)).resolves.toEqual([
      { eventId: "a", planHash: "1".repeat(64) },
      { eventId: "b", planHash: "2".repeat(64) },
    ]);
    expect(sql).toContain("ORDER BY occurred_at ASC, event_id ASC");
    expect(values).toEqual([2]);
  });

  it("reports missing plans and records retry failure", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes("WITH candidates")) return { rows: [{
          event_id: "event-1", plan_hash: "a".repeat(64), claim_token: "claim-1", attempt_count: 1,
        }] };
        return { rows: [{ processing_status: "pending" }] };
      },
    } as unknown as Pool;
    const result = await processProgressiveShadowBatch(
      pool,
      async () => null,
      { enabled: true, mode: "shadow", batchSize: 1 },
    );
    expect(result).toEqual({
      selected: 1,
      applied: 0,
      ignored: 0,
      errors: [{ eventId: "event-1", message: `Progressive plan unavailable: ${"a".repeat(64)}` }],
    });
    expect(queries.some((sql) => sql.includes("error_text = left"))).toBe(true);
  });
});
