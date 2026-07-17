import { describe, it, expect } from "vitest";
import { assertProducerFresh } from "@tm/shared";

function fakePool(map: { fpr?: any[]; lc?: any[] }) {
  return {
    query: async (sql: string) => {
      if (/FROM feature_producer_runs/i.test(sql)) return { rows: map.fpr ?? [] };
      if (/FROM lifecycle_refresh_state/i.test(sql)) return { rows: map.lc ?? [] };
      return { rows: [] };
    },
  } as any;
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe("assertProducerFresh", () => {
  it("fresh when a recent done run exists", async () => {
    const pool = fakePool({ fpr: [{ finished_at: minutesAgo(2), watermark_ts: minutesAgo(2) }] });
    const r = await assertProducerFresh(pool, {
      symbol: "XAUUSD", feature_table: "features_atr", tf: "5m", maxAgeMinutes: 10, producer: "engine",
    });
    expect(r.fresh).toBe(true);
    expect(r.ageMinutes).not.toBeNull();
    expect(r.ageMinutes!).toBeLessThan(10);
    expect(r.reason).toBeUndefined();
  });

  it("stale (BLOCKED_PRODUCER_STALE) when the done run is older than maxAge", async () => {
    const pool = fakePool({ fpr: [{ finished_at: minutesAgo(60), watermark_ts: minutesAgo(60) }] });
    const r = await assertProducerFresh(pool, {
      symbol: "XAUUSD", feature_table: "features_atr", tf: "5m", maxAgeMinutes: 10, producer: "engine",
    });
    expect(r.fresh).toBe(false);
    expect(r.reason).toContain("BLOCKED_PRODUCER_STALE");
    expect(r.reason).toContain("producer age");
  });

  it("level cross-check: stale lifecycle blocks even when producer run is recent", async () => {
    const pool = fakePool({
      fpr: [{ finished_at: minutesAgo(3), watermark_ts: minutesAgo(3) }],
      lc: [{ last_processed_ts: minutesAgo(800) }], // ~ the XAUUSD death-spiral
    });
    const r = await assertProducerFresh(pool, {
      symbol: "XAUUSD", feature_table: "features_zone", tf: "15m", maxAgeMinutes: 30,
      producer: "lifecycle", crossCheckLifecycle: true,
    });
    expect(r.fresh).toBe(false);
    expect(r.lifecycleAgeMinutes).not.toBeNull();
    expect(r.reason).toContain("lifecycle age");
  });

  it("latest failed run blocks instead of falling back to older success", async () => {
    const pool = fakePool({
      fpr: [{
        finished_at: minutesAgo(1),
        watermark_ts: minutesAgo(6),
        status: "error",
        error_message: "producer invariant failed: output_anchor_stale",
      }],
    });
    const r = await assertProducerFresh(pool, {
      symbol: "XAUUSD", feature_table: "features_atr", tf: "5m", maxAgeMinutes: 10, producer: "engine",
    });
    expect(r.fresh).toBe(false);
    expect(r.reason).toContain("BLOCKED_PRODUCER_ERROR");
    expect(r.reason).toContain("output_anchor_stale");
  });

  it("no ledger row yet → unknown/fresh (rollout must not block)", async () => {
    const pool = fakePool({ fpr: [] });
    const r = await assertProducerFresh(pool, {
      symbol: "XAUUSD", feature_table: "features_atr", tf: "5m", maxAgeMinutes: 10, producer: "engine",
    });
    expect(r.fresh).toBe(true);
    expect(r.lastFinishedAt).toBeNull();
  });
});
