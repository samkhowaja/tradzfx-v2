import type { Pool } from "@tm/shared";
import { coordinateProgressiveCandidates } from "./coordinator";
import type { ProgressiveSetupState } from "./lifecycleTypes";
import { compileProgressivePlan } from "./planner";
import {
  type ProgressiveShadowProducerConfig,
} from "./shadowProducer";
import {
  XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2,
  XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2,
} from "./shadowPlans";
import {
  runProgressiveShadowReplay,
  type ProgressiveShadowReplayResult,
} from "./shadowReplay";
import type { ProgressiveShadowWorkerConfig } from "./worker";

export interface ProgressiveShadowCanaryConfig {
  enabled: boolean;
  mode: "shadow";
  plan: "strict_reversal" | "confirmed_bos";
  symbol: "XAUUSD";
  bootstrapDays: number;
  maxRowsPerNode: number;
  maxPasses: number;
  worker: ProgressiveShadowWorkerConfig;
}

export interface ProgressiveShadowCanaryInvariants {
  transitions: number;
  revisions: number;
  pending: number;
  errors: number;
  claims: number;
  exclusiveDuplicates: number;
  overdueActive: number;
  passed: boolean;
}

export interface ProgressiveShadowCanaryResult {
  planHash: string;
  dataClock: string;
  since: string;
  replay: ProgressiveShadowReplayResult;
  invariants: ProgressiveShadowCanaryInvariants;
}

function boundedInteger(name: string, raw: string | undefined, fallback: string, min: number, max: number): number {
  const value = raw ?? fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

export function readProgressiveShadowCanaryConfig(
  env: NodeJS.ProcessEnv = process.env,
): ProgressiveShadowCanaryConfig {
  const mode = env.TM_PROGRESSIVE_DAG_MODE ?? "shadow";
  if (mode !== "shadow") throw new Error(`TM_PROGRESSIVE_DAG_MODE=${mode} is forbidden; only shadow is supported`);
  const plan = env.TM_PROGRESSIVE_DAG_PLAN ?? "confirmed_bos";
  if (plan !== "strict_reversal" && plan !== "confirmed_bos") {
    throw new Error(`TM_PROGRESSIVE_DAG_PLAN=${plan} is unsupported`);
  }
  return {
    enabled: env.TM_PROGRESSIVE_DAG_CANARY_ENABLED === "true",
    mode: "shadow",
    plan,
    symbol: "XAUUSD",
    bootstrapDays: boundedInteger("TM_PROGRESSIVE_DAG_BOOTSTRAP_DAYS", env.TM_PROGRESSIVE_DAG_BOOTSTRAP_DAYS, "7", 1, 90),
    maxRowsPerNode: boundedInteger("TM_PROGRESSIVE_DAG_MAX_ROWS", env.TM_PROGRESSIVE_DAG_MAX_ROWS, "10000", 1, 100000),
    maxPasses: boundedInteger("TM_PROGRESSIVE_DAG_MAX_PASSES", env.TM_PROGRESSIVE_DAG_MAX_PASSES, "20", 1, 100),
    worker: {
      enabled: true,
      mode: "shadow",
      batchSize: boundedInteger("TM_PROGRESSIVE_DAG_BATCH_SIZE", env.TM_PROGRESSIVE_DAG_BATCH_SIZE, "100", 1, 1000),
      leaseSeconds: 60,
      maxAttempts: 5,
    },
  };
}

function selectedPlan(config: ProgressiveShadowCanaryConfig) {
  return compileProgressivePlan(config.plan === "confirmed_bos"
    ? XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2
    : XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2);
}

export async function resolveProgressiveCanaryDataClock(
  pool: Pool,
  config: ProgressiveShadowCanaryConfig,
): Promise<{ planHash: string; dataClock: string; since: string }> {
  const plan = selectedPlan(config);
  const clockResult = await pool.query(
    `SELECT c.ts FROM market.candles_15m_canonical c
     CROSS JOIN (
       SELECT MAX(ts) AS max_ts FROM market.candles_1m_canonical WHERE symbol=$1
     ) edge
     WHERE c.symbol=$1 AND c.tick_count > 0
       AND c.ts + interval '14 minutes' <= edge.max_ts
     ORDER BY c.ts DESC LIMIT 1`,
    [config.symbol],
  );
  const value = clockResult.rows[0]?.ts as Date | string | undefined;
  if (!value) throw new Error(`Progressive canary data clock unavailable for ${config.symbol}`);
  const dataClock = new Date(value).toISOString();
  const checkpoint = await pool.query(
    `SELECT MAX(last_source_ts) AS max_ts
     FROM progressive_shadow_checkpoint
     WHERE plan_hash=$1 AND symbol=$2`,
    [plan.planHash, config.symbol],
  );
  const maxCheckpoint = checkpoint.rows[0]?.max_ts as Date | string | null | undefined;
  if (maxCheckpoint && Date.parse(dataClock) < new Date(maxCheckpoint).getTime()) {
    throw new Error(`Progressive canary data clock moved backward: ${dataClock} < ${new Date(maxCheckpoint).toISOString()}`);
  }
  return {
    planHash: plan.planHash,
    dataClock,
    since: new Date(Date.parse(dataClock) - config.bootstrapDays * 86_400_000).toISOString(),
  };
}

export async function auditProgressiveShadowCanary(
  pool: Pool,
  planHash: string,
  dataClock: string,
): Promise<ProgressiveShadowCanaryInvariants> {
  const plan = selectedPlan({ plan: planHash === compileProgressivePlan(XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2).planHash ? "confirmed_bos" : "strict_reversal" } as ProgressiveShadowCanaryConfig);
  if (plan.planHash !== planHash) throw new Error(`Progressive canary plan unavailable: ${planHash}`);
  const [counts, active] = await Promise.all([
    pool.query(
      `SELECT
       (SELECT COUNT(*) FROM progressive_setup_transition t JOIN progressive_setup_instance i USING(setup_instance_id) WHERE i.plan_hash=$1)::int transitions,
       (SELECT COALESCE(SUM(revision),0) FROM progressive_setup_instance WHERE plan_hash=$1)::int revisions,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND processing_status='pending')::int pending,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND processing_status='error')::int errors,
       (SELECT COUNT(*) FROM progressive_setup_event_inbox WHERE plan_hash=$1 AND claim_token IS NOT NULL)::int claims,
       (SELECT COUNT(*) FROM (SELECT n.source_feature,n.source_symbol,n.source_tf,n.source_ts,n.source_key FROM progressive_setup_node n JOIN progressive_setup_instance i USING(setup_instance_id) WHERE i.plan_hash=$1 AND n.consumption_policy='exclusive_setup' AND n.status='satisfied' GROUP BY 1,2,3,4,5 HAVING COUNT(*)>1) d)::int exclusive_duplicates`,
      [planHash],
    ),
    pool.query(
      `SELECT state_json FROM progressive_setup_instance
       WHERE plan_hash=$1 AND status='active'`,
      [planHash],
    ),
  ]);
  const overdueActive = active.rows.filter((row) =>
    coordinateProgressiveCandidates(plan, [], [row.state_json as ProgressiveSetupState], dataClock)
      .emittedEvents.some((event) => event.type === "expire")).length;
  const row = counts.rows[0];
  const result = {
    transitions: Number(row.transitions), revisions: Number(row.revisions),
    pending: Number(row.pending), errors: Number(row.errors), claims: Number(row.claims),
    exclusiveDuplicates: Number(row.exclusive_duplicates), overdueActive,
    passed: false,
  };
  result.passed = result.transitions === result.revisions && result.pending === 0
    && result.errors === 0 && result.claims === 0 && result.exclusiveDuplicates === 0
    && result.overdueActive === 0;
  return result;
}

export async function runProgressiveShadowCanary(
  pool: Pool,
  config: ProgressiveShadowCanaryConfig,
): Promise<ProgressiveShadowCanaryResult> {
  if (!config.enabled) throw new Error("Progressive shadow canary is disabled");
  if (config.mode !== "shadow") throw new Error("Progressive shadow canary mode must remain shadow");
  const clock = await resolveProgressiveCanaryDataClock(pool, config);
  const started = await pool.query(
    `INSERT INTO progressive_shadow_canary_run (
       plan_hash,symbol,data_clock,window_since,status
     ) VALUES ($1,$2,$3,$4,'running') RETURNING run_id`,
    [clock.planHash, config.symbol, clock.dataClock, clock.since],
  );
  const runId = Number(started.rows[0].run_id);
  try {
    const producer: ProgressiveShadowProducerConfig = {
      enabled: true, mode: "shadow", plan: config.plan, symbol: config.symbol,
      since: clock.since, until: clock.dataClock, maxRowsPerNode: config.maxRowsPerNode,
    };
    const replay = await runProgressiveShadowReplay(pool, {
      producer, worker: config.worker, maxPasses: config.maxPasses,
    });
    const invariants = await auditProgressiveShadowCanary(pool, clock.planHash, clock.dataClock);
    if (!invariants.passed) throw new Error(`Progressive shadow canary invariants failed: ${JSON.stringify(invariants)}`);
    const totals = replay.passes.reduce((sum, pass) => ({
      rowsRead: sum.rowsRead + pass.producer.rowsRead,
      inserted: sum.inserted + pass.producer.eventsInserted,
      applied: sum.applied + pass.worker.applied,
      ignored: sum.ignored + pass.worker.ignored,
    }), { rowsRead: 0, inserted: 0, applied: 0, ignored: 0 });
    await pool.query(
      `UPDATE progressive_shadow_canary_run SET
       status='passed',pass_count=$2,rows_read=$3,events_inserted=$4,
       events_applied=$5,events_ignored=$6,invariant_json=$7,finished_at=now()
       WHERE run_id=$1`,
      [runId, replay.passes.length, totals.rowsRead, totals.inserted,
        totals.applied, totals.ignored, JSON.stringify(invariants)],
    );
    return { ...clock, replay, invariants };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await pool.query(
      `UPDATE progressive_shadow_canary_run SET
       status='failed',error_text=left($2,4000),finished_at=now()
       WHERE run_id=$1`,
      [runId, message],
    );
    throw error;
  }
}
