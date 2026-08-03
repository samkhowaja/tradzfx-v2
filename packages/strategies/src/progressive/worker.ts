import type { Pool } from "@tm/shared";
import {
  applyProgressiveEvent,
  claimProgressiveEvents,
  recordProgressiveEventFailure,
  type ApplyEventResult,
} from "./repository";
import type { ProgressivePlan } from "./types";

export interface ProgressiveShadowWorkerConfig {
  enabled: boolean;
  mode: "shadow";
  batchSize: number;
  leaseSeconds?: number;
  maxAttempts?: number;
}

export interface ProgressivePendingEvent {
  eventId: string;
  planHash: string;
}

export interface ProgressiveBatchResult {
  selected: number;
  applied: number;
  ignored: number;
  errors: Array<{ eventId: string; message: string }>;
}

export type ProgressivePlanResolver = (planHash: string) => Promise<ProgressivePlan | null>;

function positiveBatchSize(raw: string | undefined): number {
  const value = raw ?? "100";
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 1000) {
    throw new Error("TM_PROGRESSIVE_DAG_BATCH_SIZE must be an integer from 1 to 1000");
  }
  return Number(value);
}

/** Fail-closed activation guard. Progressive DAG v2 supports shadow mode only. */
export function readProgressiveShadowWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProgressiveShadowWorkerConfig {
  const enabled = env.TM_PROGRESSIVE_DAG_ENABLED === "true";
  const mode = env.TM_PROGRESSIVE_DAG_MODE ?? "shadow";
  if (mode !== "shadow") {
    throw new Error(`TM_PROGRESSIVE_DAG_MODE=${mode} is forbidden; only shadow is supported`);
  }
  return {
    enabled,
    mode: "shadow",
    batchSize: positiveBatchSize(env.TM_PROGRESSIVE_DAG_BATCH_SIZE),
    leaseSeconds: 60,
    maxAttempts: 5,
  };
}

export async function listPendingProgressiveEvents(
  pool: Pool,
  batchSize: number,
): Promise<ProgressivePendingEvent[]> {
  const { rows } = await pool.query(
    `SELECT event_id, plan_hash
     FROM progressive_setup_event_inbox
     WHERE processing_status = 'pending'
     ORDER BY occurred_at ASC, event_id ASC
     LIMIT $1`,
    [batchSize],
  );
  return rows.map((row) => ({ eventId: row.event_id as string, planHash: row.plan_hash as string }));
}

/**
 * Processes one deterministic shadow batch. Repository row locks remain final
 * race authority; this function never reads or writes order/execution tables.
 */
export async function processProgressiveShadowBatch(
  pool: Pool,
  resolvePlan: ProgressivePlanResolver,
  config: ProgressiveShadowWorkerConfig,
): Promise<ProgressiveBatchResult> {
  if (!config.enabled) return { selected: 0, applied: 0, ignored: 0, errors: [] };
  if (config.mode !== "shadow") throw new Error("Progressive DAG worker mode must remain shadow");
  const claimed = await claimProgressiveEvents(pool, config.batchSize, config.leaseSeconds ?? 60);
  const result: ProgressiveBatchResult = { selected: claimed.length, applied: 0, ignored: 0, errors: [] };
  for (const item of claimed) {
    try {
      const plan = await resolvePlan(item.planHash);
      if (!plan || plan.planHash !== item.planHash) {
        throw new Error(`Progressive plan unavailable: ${item.planHash}`);
      }
      const applied: ApplyEventResult = await applyProgressiveEvent(pool, plan, item.eventId, item.claimToken);
      if (applied.inboxStatus === "applied") result.applied += 1;
      else result.ignored += 1;
    } catch (error) {
      await recordProgressiveEventFailure(pool, item.eventId, item.claimToken, error, config.maxAttempts ?? 5);
      result.errors.push({
        eventId: item.eventId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
