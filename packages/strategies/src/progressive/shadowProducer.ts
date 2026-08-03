import type { Pool } from "@tm/shared";
import { compileProgressivePlan } from "./planner";
import { registerProgressivePlan } from "./planRegistry";
import { coordinateProgressiveCandidates } from "./coordinator";
import {
  adaptProgressiveFeatureRow,
  progressiveFeatureRowCursor,
  type ProgressiveFeatureRow,
} from "./featureRows";
import type { ProgressiveSetupState } from "./lifecycleTypes";
import { createProgressiveInstance, enqueueProgressiveEvent } from "./repository";
import type { ProgressivePlan, ProgressivePlanNode } from "./types";
import {
  XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2,
  XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2,
} from "./shadowPlans";

export interface ProgressiveShadowProducerConfig {
  enabled: boolean;
  mode: "shadow";
  plan: "strict_reversal" | "confirmed_bos";
  symbol: "XAUUSD";
  since: string;
  until: string;
  maxRowsPerNode: number;
}

export interface ProgressiveShadowProducerResult {
  planHash: string;
  rowsRead: number;
  candidatesMatched: number;
  instancesCreated: number;
  eventsInserted: number;
  eventsDuplicate: number;
  checkpointsAdvanced: number;
  checkpointsResumed: number;
  ignoredReasons: Record<string, number>;
}

interface ProgressiveSourceRow {
  node: ProgressivePlanNode;
  row: ProgressiveFeatureRow;
  sourceTs: string;
  sourceKey: string;
}

const TABLES = new Set(["features_direction_state", "features_sweep", "features_structure"]);

function iso(name: string, value: string | undefined): string {
  const parsed = new Date(value ?? "");
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${name} must be an ISO timestamp`);
  return parsed.toISOString();
}

/** Fail-closed. Explicit bounded interval required; service never follows wall clock implicitly. */
export function readProgressiveShadowProducerConfig(env: NodeJS.ProcessEnv = process.env): ProgressiveShadowProducerConfig {
  const mode = env.TM_PROGRESSIVE_DAG_MODE ?? "shadow";
  if (mode !== "shadow") throw new Error(`TM_PROGRESSIVE_DAG_MODE=${mode} is forbidden; only shadow is supported`);
  const since = iso("TM_PROGRESSIVE_DAG_SINCE", env.TM_PROGRESSIVE_DAG_SINCE);
  const until = iso("TM_PROGRESSIVE_DAG_UNTIL", env.TM_PROGRESSIVE_DAG_UNTIL);
  if (Date.parse(until) < Date.parse(since)) throw new Error("TM_PROGRESSIVE_DAG_UNTIL precedes TM_PROGRESSIVE_DAG_SINCE");
  const maxRowsPerNode = Number(env.TM_PROGRESSIVE_DAG_MAX_ROWS ?? "10000");
  if (!Number.isInteger(maxRowsPerNode) || maxRowsPerNode < 1 || maxRowsPerNode > 100000) {
    throw new Error("TM_PROGRESSIVE_DAG_MAX_ROWS must be an integer from 1 to 100000");
  }
  const plan = env.TM_PROGRESSIVE_DAG_PLAN ?? "strict_reversal";
  if (plan !== "strict_reversal" && plan !== "confirmed_bos") {
    throw new Error(`TM_PROGRESSIVE_DAG_PLAN=${plan} is unsupported`);
  }
  return { enabled: env.TM_PROGRESSIVE_DAG_ENABLED === "true", mode: "shadow", plan, symbol: "XAUUSD", since, until, maxRowsPerNode };
}

function selectColumns(node: ProgressivePlanNode): string {
  switch (node.feature) {
    case "features_direction_state": return "symbol,tf,ts,direction,regime,agreement,htf_state,confidence";
    case "features_sweep": return "symbol,tf,ts,direction,level,extreme,close,sweep_type AS kind,target_type,mitigated_at";
    case "features_structure": return "symbol,tf,ts,event_type,direction,level,strength,confirmed,confirmation_ts,htf_aligned,invalidated_at";
    default: throw new Error(`Unsupported progressive shadow feature: ${node.feature}`);
  }
}

export async function readProgressiveShadowRows(
  pool: Pool,
  plan: ProgressivePlan,
  config: ProgressiveShadowProducerConfig,
): Promise<{ rows: ProgressiveSourceRow[]; checkpointsResumed: number }> {
  const output: ProgressiveSourceRow[] = [];
  let checkpointsResumed = 0;
  for (const nodeId of plan.topologicalOrder) {
    const node = plan.nodes.find((item) => item.id === nodeId)!;
    if (!TABLES.has(node.feature)) throw new Error(`Progressive table not allowlisted: ${node.feature}`);
    const checkpoint = await pool.query(
      `SELECT last_source_ts,last_source_key FROM progressive_shadow_checkpoint
       WHERE plan_hash=$1 AND node_id=$2 AND symbol=$3
       FOR UPDATE`,
      [plan.planHash, node.id, config.symbol],
    );
    const cursor = checkpoint.rows[0] as { last_source_ts: Date | string; last_source_key: string } | undefined;
    if (cursor) checkpointsResumed += 1;
    const lowerBound = cursor
      ? new Date(cursor.last_source_ts).toISOString()
      : config.since;
    const { rows } = await pool.query(
      `SELECT ${selectColumns(node)} FROM ${node.feature}
       WHERE symbol=$1 AND tf=$2 AND ts >= $3 AND ts <= $4
       ORDER BY ts ASC`,
      [config.symbol, node.tf, lowerBound, config.until],
    );
    const unread = rows
      .map((row) => ({ node, row, ...progressiveFeatureRowCursor(node, row) }))
      .filter((item) => !cursor
        || Date.parse(item.sourceTs) > new Date(cursor.last_source_ts).getTime()
        || (Date.parse(item.sourceTs) === new Date(cursor.last_source_ts).getTime()
          && item.sourceKey > cursor.last_source_key))
      .sort((a, b) => Date.parse(a.sourceTs) - Date.parse(b.sourceTs)
        || a.sourceKey.localeCompare(b.sourceKey));
    if (unread.length > config.maxRowsPerNode) throw new Error(`Progressive row limit exceeded for ${node.id}`);
    output.push(...unread);
  }
  output.sort((a, b) => {
    const time = Date.parse(a.sourceTs) - Date.parse(b.sourceTs);
    return time
      || plan.topologicalOrder.indexOf(a.node.id) - plan.topologicalOrder.indexOf(b.node.id)
      || a.sourceKey.localeCompare(b.sourceKey);
  });
  return { rows: output, checkpointsResumed };
}

/** Bounded one-shot producer. Writes lifecycle shadow tables only; worker remains separate. */
export async function produceXauusdProgressiveShadowBatch(
  pool: Pool,
  config: ProgressiveShadowProducerConfig,
): Promise<ProgressiveShadowProducerResult> {
  const spec = config.plan === "confirmed_bos"
    ? XAUUSD_LIQUIDITY_CONFIRMED_BOS_SHADOW_V2
    : XAUUSD_LIQUIDITY_REVERSAL_SHADOW_V2;
  const plan = compileProgressivePlan(spec);
  const empty: ProgressiveShadowProducerResult = {
    planHash: plan.planHash, rowsRead: 0, candidatesMatched: 0, instancesCreated: 0,
    eventsInserted: 0, eventsDuplicate: 0, checkpointsAdvanced: 0,
    checkpointsResumed: 0, ignoredReasons: {},
  };
  if (!config.enabled) return empty;
  if (config.mode !== "shadow" || config.symbol !== "XAUUSD") throw new Error("Progressive producer must remain XAUUSD shadow-only");
  await registerProgressivePlan(pool, plan);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transactionalPool = client as unknown as Pool;
    const source = await readProgressiveShadowRows(transactionalPool, plan, config);
    const candidates = source.rows.flatMap(({ node, row }) => {
      const candidate = adaptProgressiveFeatureRow(node, row);
      return candidate ? [candidate] : [];
    });
    const existing = await client.query(
      `SELECT state_json FROM progressive_setup_instance
       WHERE plan_hash=$1 AND symbol=$2 AND status='active'
       FOR UPDATE`,
      [plan.planHash, config.symbol],
    );
    const initialStates = existing.rows.map((row) => row.state_json as ProgressiveSetupState);
    const coordinated = coordinateProgressiveCandidates(plan, candidates, initialStates, config.until);
    let instancesCreated = 0;
    for (const state of coordinated.states) {
      const existed = initialStates.some((item) => item.setupInstanceId === state.setupInstanceId);
      await createProgressiveInstance(transactionalPool, plan, state.setupInstanceId, state.symbol);
      if (!existed) instancesCreated += 1;
    }
    let eventsInserted = 0;
    let eventsDuplicate = 0;
    for (const event of coordinated.emittedEvents) {
      const result = await enqueueProgressiveEvent(transactionalPool, event);
      if (result.inserted) eventsInserted += 1; else eventsDuplicate += 1;
    }
    let checkpointsAdvanced = 0;
    for (const nodeId of plan.topologicalOrder) {
      const latest = source.rows.filter((item) => item.node.id === nodeId).at(-1);
      if (!latest) continue;
      await client.query(
        `INSERT INTO progressive_shadow_checkpoint (
           plan_hash,node_id,symbol,source_feature,source_tf,last_source_ts,last_source_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (plan_hash,node_id,symbol) DO UPDATE SET
           source_feature=EXCLUDED.source_feature, source_tf=EXCLUDED.source_tf,
           last_source_ts=EXCLUDED.last_source_ts, last_source_key=EXCLUDED.last_source_key,
           updated_at=now()`,
        [plan.planHash, latest.node.id, config.symbol, latest.node.feature,
          latest.node.tf, latest.sourceTs, latest.sourceKey],
      );
      checkpointsAdvanced += 1;
    }
    await client.query("COMMIT");
    return {
      planHash: plan.planHash, rowsRead: source.rows.length, candidatesMatched: candidates.length,
      instancesCreated, eventsInserted, eventsDuplicate, checkpointsAdvanced,
      checkpointsResumed: source.checkpointsResumed, ignoredReasons: coordinated.ignoredReasons,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
