import { describe, expect, it, vi } from "vitest";
import {
  readProgressiveShadowReplayMaxPasses,
  runProgressiveShadowReplayOperations,
} from "./shadowReplay";
import type { ProgressiveShadowProducerResult } from "./shadowProducer";
import type { ProgressiveBatchResult } from "./worker";

function producer(eventsInserted: number): ProgressiveShadowProducerResult {
  return {
    planHash: "a".repeat(64), rowsRead: 0, candidatesMatched: 0, instancesCreated: 0,
    eventsInserted, eventsDuplicate: 0, checkpointsAdvanced: 0, checkpointsResumed: 3,
    ignoredReasons: {},
  };
}

function worker(selected: number, errors: ProgressiveBatchResult["errors"] = []): ProgressiveBatchResult {
  return { selected, applied: selected, ignored: 0, errors };
}

describe("progressive shadow fixed-point replay", () => {
  it("validates bounded pass count", () => {
    expect(readProgressiveShadowReplayMaxPasses({})).toBe(20);
    expect(readProgressiveShadowReplayMaxPasses({ TM_PROGRESSIVE_DAG_MAX_PASSES: "7" })).toBe(7);
    expect(() => readProgressiveShadowReplayMaxPasses({ TM_PROGRESSIVE_DAG_MAX_PASSES: "0" }))
      .toThrow("integer from 1 to 100");
  });

  it("drains each pass and converges only after a zero-work pass", async () => {
    const produce = vi.fn()
      .mockResolvedValueOnce(producer(2))
      .mockResolvedValueOnce(producer(1))
      .mockResolvedValueOnce(producer(0));
    const process = vi.fn()
      .mockResolvedValueOnce(worker(2))
      .mockResolvedValueOnce(worker(0))
      .mockResolvedValueOnce(worker(1))
      .mockResolvedValueOnce(worker(0))
      .mockResolvedValueOnce(worker(0));
    const result = await runProgressiveShadowReplayOperations({ produce, process }, 5);
    expect(result.converged).toBe(true);
    expect(result.passes.map((pass) => ({
      inserted: pass.producer.eventsInserted,
      selected: pass.worker.selected,
      batches: pass.workerBatches,
    }))).toEqual([
      { inserted: 2, selected: 2, batches: 2 },
      { inserted: 1, selected: 1, batches: 2 },
      { inserted: 0, selected: 0, batches: 1 },
    ]);
  });

  it("fails immediately on worker error", async () => {
    await expect(runProgressiveShadowReplayOperations({
      produce: async () => producer(1),
      process: async () => worker(1, [{ eventId: "event-1", message: "failed" }]),
    }, 3)).rejects.toThrow("Progressive shadow replay worker errors");
  });

  it("fails closed when pass bound is exhausted", async () => {
    await expect(runProgressiveShadowReplayOperations({
      produce: async () => producer(1),
      process: async () => worker(0),
    }, 2)).rejects.toThrow("did not converge within 2 passes");
  });
});
