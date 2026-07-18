import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { StrategySpec } from "../types/strategy";
import {
  getOrCreateFeatureConfigSnapshot,
  getOrCreateStrategySettingsSnapshot,
} from "./snapshots";

function poolReturning(snapshotId: string) {
  const query = vi.fn().mockResolvedValue({ rows: [{ snapshot_id: snapshotId }] });
  return { pool: { query } as unknown as Pool, query };
}

describe("snapshot binary hash lookup", () => {
  it("reuses feature snapshot through 32-byte binary hash", async () => {
    const { pool, query } = poolReturning("feature-id");
    const dag = {
      getFeatureNames: () => ["features_atr"],
      get: () => ({ name: "features_atr", version: "1.2.0", dependencies: [] }),
    };

    await expect(getOrCreateFeatureConfigSnapshot(pool, dag)).resolves.toBe("feature-id");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("content_hash_bin = $1");
    const digest = query.mock.calls[0][1][0];
    expect(Buffer.isBuffer(digest)).toBe(true);
    expect(digest).toHaveLength(32);
  });

  it("reuses strategy snapshot through 32-byte binary hash", async () => {
    const { pool, query } = poolReturning("strategy-id");
    const spec = {
      id: "test_strategy",
      version: "1.0.0",
      name: "Test strategy",
    } as StrategySpec;

    await expect(getOrCreateStrategySettingsSnapshot(pool, spec)).resolves.toBe("strategy-id");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("content_hash_bin = $1");
    const digest = query.mock.calls[0][1][0];
    expect(Buffer.isBuffer(digest)).toBe(true);
    expect(digest).toHaveLength(32);
  });
});
