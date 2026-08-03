import type { Pool } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import type {
  ProgressiveLifecycleEvent,
  ProgressiveReduceResult,
  ProgressiveSetupState,
} from "./lifecycleTypes";
import { createProgressiveSetupState, reduceProgressiveSetup } from "./reducer";
import type { ProgressivePlan } from "./types";

export interface EnqueueResult {
  inserted: boolean;
  payloadHash: string;
}

export interface ApplyEventResult extends ProgressiveReduceResult {
  inboxStatus: "applied" | "ignored";
}

export interface ClaimedProgressiveEvent {
  eventId: string;
  planHash: string;
  claimToken: string;
  attemptCount: number;
}

function terminalTimestamps(state: ProgressiveSetupState): [string | null, string | null, string | null] {
  return [
    state.status === "entered" ? state.updatedAt : null,
    state.status === "invalidated" ? state.updatedAt : null,
    state.status === "expired" ? state.updatedAt : null,
  ];
}

export async function createProgressiveInstance(
  pool: Pool,
  plan: ProgressivePlan,
  setupInstanceId: string,
  symbol: string,
): Promise<ProgressiveSetupState> {
  const state = createProgressiveSetupState(plan, setupInstanceId, symbol);
  const createdAt = new Date().toISOString();
  const persisted = { ...state, createdAt, updatedAt: createdAt };
  const { rows } = await pool.query(
    `INSERT INTO progressive_setup_instance (
       setup_instance_id, strategy_id, strategy_version, plan_hash, symbol,
       side, status, terminal_node_id, state_json, revision, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$11)
     ON CONFLICT (setup_instance_id) DO NOTHING
     RETURNING state_json`,
    [setupInstanceId, plan.strategyId, plan.strategyVersion, plan.planHash, symbol,
      persisted.side, persisted.status, persisted.terminalNodeId, JSON.stringify(persisted), persisted.revision, createdAt],
  );
  if (rows[0]?.state_json) return rows[0].state_json as ProgressiveSetupState;
  const existing = await pool.query(
    `SELECT state_json, plan_hash, symbol FROM progressive_setup_instance WHERE setup_instance_id = $1`,
    [setupInstanceId],
  );
  if (!existing.rows[0]) throw new Error("Progressive setup instance insert returned no row");
  if (existing.rows[0].plan_hash !== plan.planHash || existing.rows[0].symbol !== symbol) {
    throw new Error(`Progressive setup instance identity collision: ${setupInstanceId}`);
  }
  return existing.rows[0].state_json as ProgressiveSetupState;
}

export async function enqueueProgressiveEvent(pool: Pool, event: ProgressiveLifecycleEvent): Promise<EnqueueResult> {
  const payloadHash = hashProgressiveValue(event);
  const { rows } = await pool.query(
    `INSERT INTO progressive_setup_event_inbox (
       event_id, setup_instance_id, plan_hash, symbol, event_type, node_id,
       occurred_at, payload_json, payload_hash
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [event.id, event.setupInstanceId, event.planHash, event.symbol, event.type,
      "nodeId" in event ? event.nodeId ?? null : null, event.occurredAt, JSON.stringify(event), payloadHash],
  );
  if (rows.length) return { inserted: true, payloadHash };
  const existing = await pool.query(
    `SELECT payload_hash FROM progressive_setup_event_inbox WHERE event_id = $1`,
    [event.id],
  );
  if (!existing.rows[0]) throw new Error("Progressive event conflict lookup returned no row");
  if (existing.rows[0].payload_hash !== payloadHash) {
    throw new Error(`Progressive event identity collision: ${event.id}`);
  }
  return { inserted: false, payloadHash };
}

export async function applyProgressiveEvent(
  pool: Pool,
  plan: ProgressivePlan,
  eventId: string,
  claimToken?: string,
): Promise<ApplyEventResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inboxResult = await client.query(
      `SELECT payload_json, processing_status, claim_token
       FROM progressive_setup_event_inbox
       WHERE event_id = $1
       FOR UPDATE`,
      [eventId],
    );
    if (!inboxResult.rows[0]) throw new Error(`Progressive event not found: ${eventId}`);
    if (claimToken && inboxResult.rows[0].claim_token !== claimToken) {
      throw new Error(`Progressive event claim lost: ${eventId}`);
    }
    if (inboxResult.rows[0].processing_status !== "pending") {
      throw new Error(`Progressive event already processed: ${eventId}`);
    }
    const event = inboxResult.rows[0].payload_json as ProgressiveLifecycleEvent;
    const instanceResult = await client.query(
      `SELECT state_json FROM progressive_setup_instance
       WHERE setup_instance_id = $1
       FOR UPDATE`,
      [event.setupInstanceId],
    );
    if (!instanceResult.rows[0]) throw new Error(`Progressive setup instance not found: ${event.setupInstanceId}`);
    const state = instanceResult.rows[0].state_json as ProgressiveSetupState;
    const reduced = reduceProgressiveSetup(state, event, { plan });
    let inboxStatus: "applied" | "ignored" = reduced.transition ? "applied" : "ignored";

    if (reduced.transition && event.type === "evidence") {
      const planNode = plan.nodes.find((candidate) => candidate.id === event.nodeId);
      if (!planNode) throw new Error(`Progressive plan node not found: ${event.nodeId}`);
      if (planNode.consumption === "exclusive_setup") {
        const identity = event.identity;
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
          [`${identity.feature}:${identity.symbol}:${identity.tf}:${identity.sourceTs}:${identity.sourceKey}`],
        );
        const consumed = await client.query(
          `SELECT 1 FROM progressive_setup_node
           WHERE consumption_policy='exclusive_setup' AND status='satisfied'
             AND source_feature=$1 AND source_symbol=$2 AND source_tf=$3
             AND source_ts=$4 AND source_key=$5 AND setup_instance_id<>$6
           LIMIT 1`,
          [identity.feature, identity.symbol, identity.tf, identity.sourceTs,
            identity.sourceKey, event.setupInstanceId],
        );
        if (consumed.rows.length) {
          inboxStatus = "ignored";
          await client.query(
            `UPDATE progressive_setup_event_inbox SET
               processing_status='ignored', ignored_reason='exclusive_evidence_consumed',
               transition_fingerprint=NULL, claim_token=NULL, claimed_at=NULL,
               claim_expires_at=NULL, processed_at=now()
             WHERE event_id=$1`,
            [eventId],
          );
          await client.query("COMMIT");
          return { state, transition: null, duplicate: false,
            ignoredReason: "exclusive_evidence_consumed", inboxStatus };
        }
      }
    }

    if (reduced.transition) {
      const [enteredAt, invalidatedAt, expiredAt] = terminalTimestamps(reduced.state);
      await client.query(
        `UPDATE progressive_setup_instance SET
           side=$2, status=$3, terminal_node_id=$4, state_json=$5::jsonb,
           revision=$6, updated_at=$7, entered_at=$8, invalidated_at=$9, expired_at=$10
         WHERE setup_instance_id=$1`,
        [event.setupInstanceId, reduced.state.side, reduced.state.status, reduced.state.terminalNodeId,
          JSON.stringify(reduced.state), reduced.state.revision, reduced.state.updatedAt,
          enteredAt, invalidatedAt, expiredAt],
      );
      for (const node of Object.values(reduced.state.nodes)) {
        const identity = node.evidence?.identity;
        const planNode = plan.nodes.find((candidate) => candidate.id === node.nodeId);
        if (!planNode) throw new Error(`Progressive plan node not found: ${node.nodeId}`);
        await client.query(
          `INSERT INTO progressive_setup_node (
             setup_instance_id,node_id,consumption_policy,status,evidence_json,evidence_hash,
             source_feature,source_symbol,source_tf,source_ts,source_key,
             occurred_at,revision,updated_at
           ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           ON CONFLICT (setup_instance_id,node_id) DO UPDATE SET
             consumption_policy=EXCLUDED.consumption_policy, status=EXCLUDED.status,
             evidence_json=EXCLUDED.evidence_json, evidence_hash=EXCLUDED.evidence_hash,
             source_feature=EXCLUDED.source_feature, source_symbol=EXCLUDED.source_symbol,
             source_tf=EXCLUDED.source_tf, source_ts=EXCLUDED.source_ts,
             source_key=EXCLUDED.source_key, occurred_at=EXCLUDED.occurred_at,
             revision=EXCLUDED.revision, updated_at=EXCLUDED.updated_at`,
          [event.setupInstanceId, node.nodeId, planNode.consumption, node.status,
            node.evidence ? JSON.stringify(node.evidence) : null, node.evidence?.evidenceHash ?? null,
            identity?.feature ?? null, identity?.symbol ?? null, identity?.tf ?? null,
            identity?.sourceTs ?? null, identity?.sourceKey ?? null,
            node.evidence?.occurredAt ?? null, node.revision, reduced.state.updatedAt],
        );
      }
      const transition = reduced.transition;
      await client.query(
        `INSERT INTO progressive_setup_transition (
           setup_instance_id,sequence,event_id,occurred_at,node_id,previous_status,
           next_status,reason,evidence_hash,transition_fingerprint
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [transition.setupInstanceId, transition.sequence, transition.eventId,
          transition.occurredAt, transition.nodeId, transition.previousStatus,
          transition.nextStatus, transition.reason, transition.evidenceHash,
          transition.transitionFingerprint],
      );
    }

    await client.query(
      `UPDATE progressive_setup_event_inbox SET
         processing_status=$2, ignored_reason=$3, transition_fingerprint=$4,
         claim_token=NULL, claimed_at=NULL, claim_expires_at=NULL, processed_at=now()
       WHERE event_id=$1`,
      [eventId, inboxStatus, reduced.ignoredReason, reduced.transition?.transitionFingerprint ?? null],
    );
    await client.query("COMMIT");
    return { ...reduced, inboxStatus };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function claimProgressiveEvents(
  pool: Pool,
  batchSize: number,
  leaseSeconds = 60,
): Promise<ClaimedProgressiveEvent[]> {
  const { rows } = await pool.query(
    `WITH candidates AS (
       SELECT event_id
       FROM progressive_setup_event_inbox
       WHERE processing_status = 'pending'
         AND (claim_expires_at IS NULL OR claim_expires_at <= now())
       ORDER BY occurred_at ASC, event_id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE progressive_setup_event_inbox inbox SET
       claim_token = gen_random_uuid()::text,
       claimed_at = now(),
       claim_expires_at = now() + ($2 * interval '1 second'),
       attempt_count = attempt_count + 1
     FROM candidates
     WHERE inbox.event_id = candidates.event_id
     RETURNING inbox.event_id, inbox.plan_hash, inbox.claim_token, inbox.attempt_count`,
    [batchSize, leaseSeconds],
  );
  return rows.map((row) => ({
    eventId: row.event_id as string,
    planHash: row.plan_hash as string,
    claimToken: row.claim_token as string,
    attemptCount: row.attempt_count as number,
  }));
}

export async function recordProgressiveEventFailure(
  pool: Pool,
  eventId: string,
  claimToken: string,
  error: unknown,
  maxAttempts: number,
): Promise<"pending" | "error" | "claim_lost"> {
  const message = error instanceof Error ? error.message : String(error);
  const { rows } = await pool.query(
    `UPDATE progressive_setup_event_inbox SET
       processing_status = CASE WHEN attempt_count >= $4 THEN 'error' ELSE 'pending' END,
       error_text = left($3, 4000),
       claim_token = NULL,
       claimed_at = NULL,
       claim_expires_at = NULL,
       processed_at = CASE WHEN attempt_count >= $4 THEN now() ELSE NULL END
     WHERE event_id = $1
       AND processing_status = 'pending'
       AND claim_token = $2
     RETURNING processing_status`,
    [eventId, claimToken, message, maxAttempts],
  );
  return rows[0]?.processing_status as "pending" | "error" | undefined ?? "claim_lost";
}
