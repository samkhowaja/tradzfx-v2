import type { Pool } from "@tm/shared";
import { loadProgressivePlan } from "./planRegistry";
import {
  produceXauusdProgressiveShadowBatch,
  type ProgressiveShadowProducerConfig,
  type ProgressiveShadowProducerResult,
} from "./shadowProducer";
import {
  processProgressiveShadowBatch,
  type ProgressiveBatchResult,
  type ProgressiveShadowWorkerConfig,
} from "./worker";

export interface ProgressiveShadowReplayConfig {
  producer: ProgressiveShadowProducerConfig;
  worker: ProgressiveShadowWorkerConfig;
  maxPasses: number;
}

export interface ProgressiveShadowReplayPass {
  pass: number;
  producer: ProgressiveShadowProducerResult;
  worker: ProgressiveBatchResult;
  workerBatches: number;
}

export interface ProgressiveShadowReplayResult {
  converged: boolean;
  passes: ProgressiveShadowReplayPass[];
}

export interface ProgressiveShadowReplayOperations {
  produce: () => Promise<ProgressiveShadowProducerResult>;
  process: () => Promise<ProgressiveBatchResult>;
}

function boundedMaxPasses(raw: string | undefined): number {
  const value = raw ?? "20";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) {
    throw new Error("TM_PROGRESSIVE_DAG_MAX_PASSES must be an integer from 1 to 100");
  }
  return Number(value);
}

export function readProgressiveShadowReplayMaxPasses(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return boundedMaxPasses(env.TM_PROGRESSIVE_DAG_MAX_PASSES);
}

/**
 * Alternates bounded production and complete inbox drains until one pass creates
 * no events and processes no events. Shadow tables remain sole write target.
 */
export async function runProgressiveShadowReplayOperations(
  operations: ProgressiveShadowReplayOperations,
  maxPasses: number,
): Promise<ProgressiveShadowReplayResult> {
  if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 100) {
    throw new Error("Progressive shadow replay maxPasses must be an integer from 1 to 100");
  }
  const passes: ProgressiveShadowReplayPass[] = [];
  for (let pass = 1; pass <= maxPasses; pass += 1) {
    const producer = await operations.produce();
    const worker: ProgressiveBatchResult = { selected: 0, applied: 0, ignored: 0, errors: [] };
    let workerBatches = 0;
    for (;;) {
      const batch = await operations.process();
      workerBatches += 1;
      worker.selected += batch.selected;
      worker.applied += batch.applied;
      worker.ignored += batch.ignored;
      worker.errors.push(...batch.errors);
      if (batch.errors.length > 0) {
        throw new Error(`Progressive shadow replay worker errors: ${JSON.stringify(batch.errors)}`);
      }
      if (batch.selected === 0) break;
    }
    passes.push({ pass, producer, worker, workerBatches });
    if (producer.eventsInserted === 0 && worker.selected === 0) {
      return { converged: true, passes };
    }
  }
  throw new Error(`Progressive shadow replay did not converge within ${maxPasses} passes`);
}

export async function runProgressiveShadowReplay(
  pool: Pool,
  config: ProgressiveShadowReplayConfig,
): Promise<ProgressiveShadowReplayResult> {
  if (!config.producer.enabled || !config.worker.enabled) {
    return { converged: true, passes: [] };
  }
  if (config.producer.mode !== "shadow" || config.worker.mode !== "shadow") {
    throw new Error("Progressive shadow replay mode must remain shadow");
  }
  return runProgressiveShadowReplayOperations({
    produce: () => produceXauusdProgressiveShadowBatch(pool, config.producer),
    process: () => processProgressiveShadowBatch(
      pool,
      (planHash) => loadProgressivePlan(pool, planHash),
      config.worker,
    ),
  }, config.maxPasses);
}
