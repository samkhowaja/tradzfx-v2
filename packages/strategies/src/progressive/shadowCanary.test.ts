import { describe, expect, it } from "vitest";
import type { Pool } from "@tm/shared";
import {
  readProgressiveShadowCanaryConfig,
  resolveProgressiveCanaryDataClock,
} from "./shadowCanary";

describe("progressive shadow canary", () => {
  it("defaults disabled with confirmed-BOS shadow contract", () => {
    expect(readProgressiveShadowCanaryConfig({})).toMatchObject({
      enabled: false, mode: "shadow", plan: "confirmed_bos", symbol: "XAUUSD",
      bootstrapDays: 7, maxRowsPerNode: 10000, maxPasses: 20,
      worker: { enabled: true, mode: "shadow", batchSize: 100 },
    });
  });

  it("rejects unsafe mode and invalid bounds", () => {
    expect(() => readProgressiveShadowCanaryConfig({ TM_PROGRESSIVE_DAG_MODE: "live" }))
      .toThrow("only shadow is supported");
    expect(() => readProgressiveShadowCanaryConfig({ TM_PROGRESSIVE_DAG_BOOTSTRAP_DAYS: "0" }))
      .toThrow("integer from 1 to 90");
    expect(() => readProgressiveShadowCanaryConfig({ TM_PROGRESSIVE_DAG_PLAN: "unknown" }))
      .toThrow("unsupported");
  });

  it("derives bounded window from canonical 15m data clock", async () => {
    const queries: string[] = [];
    const pool = { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes("candles_15m_canonical")) return { rows: [{ ts: new Date("2026-07-23T18:30:00Z") }] };
      return { rows: [{ max_ts: new Date("2026-07-23T18:15:00Z") }] };
    } } as unknown as Pool;
    const result = await resolveProgressiveCanaryDataClock(pool, readProgressiveShadowCanaryConfig({
      TM_PROGRESSIVE_DAG_CANARY_ENABLED: "true", TM_PROGRESSIVE_DAG_BOOTSTRAP_DAYS: "7",
    }));
    expect(result.dataClock).toBe("2026-07-23T18:30:00.000Z");
    expect(result.since).toBe("2026-07-16T18:30:00.000Z");
    expect(queries[0]).toContain("market.candles_1m_canonical");
    expect(queries[0]).toContain("c.ts + interval '14 minutes' <= edge.max_ts");
  });

  it("fails when canonical clock regresses behind checkpoint", async () => {
    const pool = { query: async (sql: string) => sql.includes("candles_15m_canonical")
      ? { rows: [{ ts: new Date("2026-07-23T18:00:00Z") }] }
      : { rows: [{ max_ts: new Date("2026-07-23T18:15:00Z") }] }
    } as unknown as Pool;
    await expect(resolveProgressiveCanaryDataClock(pool, readProgressiveShadowCanaryConfig({})))
      .rejects.toThrow("data clock moved backward");
  });
});
