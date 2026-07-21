/**
 * Live Runner.
 * Orchestrates the full live execution pipeline:
 *   1. Run strategy SQL to find signals
 *   2. Evaluate DecisionGraph gates
 *   3. If all gates pass → call createOrder callback
 */

import crypto from "node:crypto";
import type { Pool, Queryable, SetupEvaluationSnapshot } from "@tm/shared";
import type { StrategySpec, Signal, DecisionTrace, LiveExecutionConfig, TimeFrame } from "@tm/shared";
import { checkSmallAccountGate, CANDLE_TABLE_BY_TF, assertProducerFresh, ACTIVE_ORDER_STATUSES } from "@tm/shared";
import {
  getDefaultFreshnessMinutes,
  getDefaultLookbackBars,
  isEventFeature,
  isLevelFeature,
  extractRequiredFeatures,
} from "@tm/strategies";
import {
  notifySignal,
  notifyOrderCreated,
  notifyOrderRejected,
  notifyQualityRejected,
} from "./notify";
import { evaluateSetup, type SetupEvaluation } from "@tm/setup-engine";
import { DecisionGraph } from "./decisionGraph";
import { buildOrderInput } from "./orderExecutor";
import { evaluateExecutionQuality } from "./qualityEngine";
import { createVolatilityGate } from "./gates/volatilityGate";
import { createSessionGate } from "./gates/sessionGate";
import { createPortfolioHeatGate } from "./gates/portfolioHeatGate";
import { createSpreadGate } from "./gates/spreadGate";
import { createFamilyPositionGate } from "./gates/familyPositionGate";
import { createRateLimitGate } from "./gates/rateLimitGate";
import { createDailyLossGate } from "./gates/dailyLossGate";
import { createDailyWinGate } from "./gates/dailyWinGate";
import { appendSignalCandidate } from "./candidateAudit";

/**
 * In-memory cache for market_volatility_profile rows.
 *
 * Profile data is updated nightly by run-nightly-calibration and is
 * read-heavy (fetched once per trigger cycle per (symbol, session)).
 * The cache avoids a DB round trip every cycle while keeping the data
 * fresh enough.
 *
 * TTL defaults to 1 hour (3_600_000ms); set VOLATILITY_PROFILE_CACHE_TTL_MS
 * to override. Setting to 0 disables caching.
 */
const volatilityProfileCache = new Map<string, { data: Record<string, number>; expiresAt: number }>();
const VOLATILITY_PROFILE_CACHE_TTL = Number(process.env.VOLATILITY_PROFILE_CACHE_TTL_MS ?? 3_600_000);

function getCachedVolatilityProfile(
  pool: Queryable,
  symbol: string,
  tf: string,
  session: string
): Promise<Record<string, number> | null> {
  const key = `${symbol}:${tf}:${session}`;
  const cached = volatilityProfileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }
  return fetchAndCacheVolatilityProfile(pool, symbol, tf, session, key);
}

async function fetchAndCacheVolatilityProfile(
  pool: Queryable,
  symbol: string,
  tf: string,
  session: string,
  key: string
): Promise<Record<string, number> | null> {
  try {
    const { rows: vp } = await pool.query(
      `SELECT p05, p25, p50, p75, p95, p99 FROM market_volatility_profile
       WHERE symbol = $1 AND tf = $2 AND period = 5 AND session = $3
       ORDER BY lookback_days DESC LIMIT 1`,
      [symbol, tf, session]
    );
    if (vp.length > 0) {
      const data = Object.fromEntries(
        Object.entries(vp[0]).map(([k, v]) => [k, Number(v)])
      );
      if (VOLATILITY_PROFILE_CACHE_TTL > 0) {
        volatilityProfileCache.set(key, { data, expiresAt: Date.now() + VOLATILITY_PROFILE_CACHE_TTL });
      }
      return data;
    }
  } catch {
    // profile table missing or mocked out: gate falls back to absolute pip ceilings
  }
  return null;
}

class PipelineRejectionError extends Error {
  constructor(public result: LiveRunResult) {
    super(result.reason ?? "pipeline_rejected");
  }
}

export interface LiveRunOptions {
  symbol: string;
  strategySpec: StrategySpec;
  /** Compiled strategy SQL that returns the latest signal for the symbol */
  latestSignalSQL: string;
  pool: Pool;
  /** Optional: override live config (e.g. from environment) */
  liveOverrides?: Partial<LiveExecutionConfig>;
  /**
   * Active provenance-backed deployment ID. Mandatory for non-evaluation runs;
   * canonical live_signal/live_order lineage is part of order commit.
   */
  deploymentId?: string;
  /**
   * Timestamp of pipeline evaluation. Used instead of Date.now() for stale_data
   * and stale_signal checks so that a short ingestion lag does not cause
   * false-positive rejections. Set to the wall-clock endTs passed to the feature
   * engine. Defaults to Date.now() for backward compat.
   */
  evaluationTs?: Date;
  /** Optional third SQL parameter for historical signal-at evaluation. */
  signalAsOfParameter?: Date;
  /** Evaluate canonical decision path but always roll back and create no order. */
  evaluationOnly?: boolean;
  /** Callback to create an order. Return the order ID. */
  createOrder: (
    input: {
      symbol: string;
      strategy_id: string;
      variant_id?: string;
      family_id?: string;
      side: "buy" | "sell";
      entry_type: "market" | "limit" | "stop";
      entry_price: number;
      stop_loss: number;
      take_profit: number;
      lot_size: number;
      risk_reward: number;
      trade_mode: "live" | "paper";
      expires_at: Date;
      entry_zone_pips: number | null;
      trace_run_id: string;
      signal_fingerprint?: string;
    },
    client?: Queryable
  ) => Promise<{ id: string }>;
}

export interface LiveRunResult {
  trace: DecisionTrace;
  signal?: Signal;
  liveSignalId?: string;
  orderCreated?: boolean;
  orderId?: string;
  liveOrderId?: string;
  reason?: string;
  /** Order candidate built by evaluation-only mode; never persisted. */
  orderCandidate?: Record<string, unknown>;
  setupSnapshot?: SetupEvaluationSnapshot;
  qualityDecision?: import("./qualityEngine").QualityDecision;
}

interface SignalWithSource extends Signal {
  source: Record<string, unknown>;
}

/** Fetch the latest signal using the compiled strategy SQL */
async function fetchLatestSignal(
  pool: Queryable,
  sql: string,
  params: unknown[],
  strategyId: string
): Promise<SignalWithSource | null> {
  const { rows } = await pool.query(sql, params);

  if (rows.length === 0) return null;

  const r = rows[0];

  // Validate required fields
  if (!r.side || !r.entry_price || !r.stop_loss || !r.take_profit) {
    return null;
  }

  const entryType = r.entry_type ?? "market";
  if (entryType !== "market" && entryType !== "limit" && entryType !== "stop") {
    return null;
  }

  const entryPrice = parseFloat(r.entry_price);
  const stopLoss = parseFloat(r.stop_loss);
  const takeProfit = parseFloat(r.take_profit);

  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(stopLoss) ||
    !Number.isFinite(takeProfit) ||
    entryPrice <= 0 ||
    stopLoss <= 0 ||
    takeProfit <= 0
  ) {
    console.warn(`[liveRunner] Invalid risk levels for ${r.symbol}:`, r);
    return null;
  }

  if (entryPrice === stopLoss) {
    console.warn(`[liveRunner] Zero SL distance for ${r.symbol}:`, r);
    return null;
  }

  if (r.side === "buy") {
    if (stopLoss >= entryPrice || takeProfit <= entryPrice) {
      console.warn(`[liveRunner] Invalid long risk geometry for ${r.symbol}:`, r);
      return null;
    }
  } else if (r.side === "sell") {
    if (stopLoss <= entryPrice || takeProfit >= entryPrice) {
      console.warn(`[liveRunner] Invalid short risk geometry for ${r.symbol}:`, r);
      return null;
    }
  }

  return {
    symbol: r.symbol,
    strategyId: r.strategy_id ?? strategyId ?? "unknown",
    side: r.side,
    entryType,
    entryPrice,
    stopLoss,
    takeProfit,
    ts: new Date(r.ts),
    confidence: 70,
    source: r as Record<string, unknown>,
  };
}

function computeSignalFingerprint(signal: SignalWithSource): string {
  const payload = [
    signal.symbol,
    signal.strategyId,
    signal.side,
    signal.entryPrice.toFixed(10),
    signal.stopLoss.toFixed(10),
    signal.takeProfit.toFixed(10),
  ].join("|");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function hashSpec(spec: StrategySpec): string {
  return crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

async function findRecentDuplicate(
  pool: Queryable,
  fingerprint: string,
  cooldownMinutes: number,
  asOf: Date
): Promise<{ status: string; created_at: Date } | null> {
  const { rows } = await pool.query(
    `SELECT status, created_at
     FROM orders
     WHERE signal_fingerprint = $1
       AND status IN ('pending', 'filled', 'rejected', 'expired', 'closed')
       AND created_at >= $3::timestamptz - ($2 || ' minutes')::interval
       AND created_at <= $3::timestamptz
     ORDER BY created_at DESC
     LIMIT 1`,
    [fingerprint, String(cooldownMinutes), asOf]
  );
  return rows[0] ?? null;
}

/** Total realized P&L across closed orders at the evaluation edge. */
async function getTotalRealizedPnl(db: Queryable, asOf: Date): Promise<number> {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(realized_pnl), 0)::double precision AS total
     FROM orders
     WHERE status = 'closed' AND closed_at <= $1`,
    [asOf]
  );
  return Number(rows[0]?.total ?? 0);
}

/**
 * Insert a live_signal row inside the current transaction. Uses a SAVEPOINT
 * so that a unique-violation on the fingerprint dedup index (idx_live_signal_dedup_v2)
 * does NOT abort the entire transaction — it is caught and treated as a dedup-RETRY
 * signal (caller should handle accordingly).
 *
 * Three outcomes:
 *   a) INSERT succeeds → returns the new signal_id.
 *   b) Primary (deployment_id, symbol, ts, strategy_id, side) dedup → returns
 *      the existing signal_id (ON CONFLICT DO NOTHING + re-select).
 *   c) Fingerprint index 23505 → ROLLBACK TO SAVEPOINT, returns null (caller
 *      treats as "in-flight duplicate, skip gracefully").
 */
async function insertLiveSignal(
  pool: Queryable,
  deploymentId: string,
  signal: SignalWithSource,
  fingerprint: string
): Promise<string | null> {
  // SAVEPOINT scoped to this INSERT so a 23505 on the fingerprint dedup index
  // does not poison the outer transaction (audit §3.5.3 / #10).
  await pool.query("SAVEPOINT live_signal_insert");
  try {
    const { rows } = await pool.query<{ signal_id: string }>(
      `WITH inserted AS (
         INSERT INTO live_signal (
           deployment_id, symbol, ts, strategy_id, side, entry_type,
           entry_price, stop_loss, take_profit, confidence, source_json, signal_fingerprint
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (deployment_id, symbol, ts, strategy_id, side) DO NOTHING
         RETURNING signal_id
       )
       SELECT signal_id FROM inserted
       UNION ALL
       SELECT signal_id FROM live_signal
        WHERE deployment_id = $1 AND symbol = $2 AND ts = $3
          AND strategy_id = $4 AND side = $5
       LIMIT 1`,
      [
        deploymentId,
        signal.symbol,
        signal.ts,
        signal.strategyId,
        signal.side,
        signal.entryType,
        signal.entryPrice,
        signal.stopLoss,
        signal.takeProfit,
        signal.confidence ?? null,
        signal.source,
        fingerprint,
      ],
    );
    const signalId = rows[0]?.signal_id;
    if (!signalId) throw new Error("canonical live_signal persistence returned no identity");
    await pool.query("RELEASE SAVEPOINT live_signal_insert");
    return signalId;
  } catch (err: any) {
    // Code 23505 = unique violation on the fingerprint dedup index.
    // Roll back just this INSERT and return null — caller will treat as
    // graceful dedup-skip instead of aborting the whole transaction.
    if (err?.code === "23505") {
      await pool.query("ROLLBACK TO SAVEPOINT live_signal_insert");
      return null;
    }
    // RELEASE the savepoint before re-throwing so the outer transaction
    // is clean — a plain error (not 23505) still aborts the outer txn.
    await pool.query("RELEASE SAVEPOINT live_signal_insert").catch(() => {});
    throw err;
  }
}

async function updateLiveSignalTrace(
  pool: Queryable,
  signalId: string,
  traceRunId: string
): Promise<void> {
  await pool.query(
    `UPDATE live_signal SET gate_trace_run_id = $1 WHERE signal_id = $2`,
    [traceRunId, signalId],
  );
}

async function logSignalRejection(
  pool: Queryable,
  deploymentId: string | undefined,
  input: {
    symbol: string;
    strategyId: string;
    side?: "buy" | "sell";
    ts?: Date;
    reason: string;
    fingerprint?: string;
  }
): Promise<void> {
  if (!deploymentId) return;
  try {
    await pool.query(
      `INSERT INTO live_signal_rejection (
         deployment_id, symbol, strategy_id, side, ts, reason, signal_fingerprint
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        deploymentId,
        input.symbol,
        input.strategyId,
        input.side ?? null,
        input.ts ?? new Date(),
        input.reason,
        input.fingerprint ?? null,
      ]
    );
  } catch (err: any) {
    console.warn(`[liveRunner] failed to log signal rejection: ${err.message}`);
  }
}

async function insertLiveOrder(
  pool: Queryable,
  signalId: string,
  deploymentId: string,
  orderInput: {
    symbol: string;
    strategy_id: string;
    side: "buy" | "sell";
    entry_type: "market" | "limit" | "stop";
    entry_price: number;
    stop_loss: number;
    take_profit: number;
    lot_size: number;
    risk_reward: number;
    trade_mode: "live" | "paper";
    expires_at: Date;
    entry_zone_pips: number | null;
  },
  legacyOrderId: string
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO live_order (
       signal_id, deployment_id, symbol, strategy_id, side, entry_type,
       entry_price, stop_loss, take_profit, lot_size, risk_reward,
       trade_mode, expires_at, legacy_order_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING order_id`,
    [
      signalId,
      deploymentId,
      orderInput.symbol,
      orderInput.strategy_id,
      orderInput.side,
      orderInput.entry_type,
      orderInput.entry_price,
      orderInput.stop_loss,
      orderInput.take_profit,
      orderInput.lot_size,
      orderInput.risk_reward,
      orderInput.trade_mode,
      orderInput.expires_at,
      legacyOrderId,
    ],
  );
  return rows[0].order_id;
}

export async function runLivePipeline(opts: LiveRunOptions): Promise<LiveRunResult> {
  const {
    symbol, strategySpec, latestSignalSQL, pool, liveOverrides, deploymentId,
    createOrder, evaluationTs, signalAsOfParameter, evaluationOnly = false,
  } = opts;
  const now = evaluationTs ?? new Date();
  const effectiveDeploymentId = evaluationOnly ? undefined : deploymentId;

  // 0. Wall-clock staleness guard (step 0 — independent of evaluationTs).
  // When ingestion stalls, evaluationTs freezes at the last candle ts and the
  // stale-data breaker (0a) compares against that frozen value — age is ~0.
  // This guard uses Date.now() to detect the true ingestion lag.
  // Block when the latest 1m candle is older than 2× the trigger interval (30m).
  // The query uses absolute MAX(ts) with no WHERE filter on ts <= now so we
  // read the true data edge, not the evaluation-anchored edge.
  {
    const wallClockNow = Date.now();
    try {
      const { rows: wallRows } = await pool.query(
        `SELECT MAX(ts) as max_ts FROM market.candles_1m_canonical WHERE symbol = $1`,
        [symbol]
      );
      if (wallRows[0]?.max_ts) {
        const dataEdgeTs = new Date(wallRows[0].max_ts).getTime();
        const ingestionLagMinutes = (wallClockNow - dataEdgeTs) / 60_000;
        // 2× trigger interval (15m trigger → 30m threshold) with a 5m floor
        // for fast-pulse triggers. Ensures brief ingestion hiccups don't
        // false-positive but a stalled feed is caught well before the next
        // daily candle.
        const WALL_CLOCK_STALENESS_THRESHOLD_MINUTES = 30;
        if (ingestionLagMinutes > WALL_CLOCK_STALENESS_THRESHOLD_MINUTES) {
          const reason =
            `wall_clock_stale_data: latest 1m candle is ${ingestionLagMinutes.toFixed(1)} min old ` +
            `(wall-clock edge ${dataEdgeTs}, evaluationTs ${now.toISOString()})`;
          await logSignalRejection(pool, effectiveDeploymentId, { symbol, strategyId: strategySpec.id, reason });
          return {
            trace: {
              runId: crypto.randomUUID(),
              symbol,
              strategyId: strategySpec.id,
              ts: new Date(wallClockNow),
              nodes: [
                {
                  nodeId: "wall_clock_stale_data",
                  nodeType: "gate",
                  passed: false,
                  reason,
                  latencyMs: 0,
                },
              ],
            },
            reason,
          };
        }
      }
    } catch (err: any) {
      // Fail-open on DB error — don't block trading because we can't confirm
      // staleness. Log prominently so ops is aware the guard is offline.
      console.warn(
        `[liveRunner] Wall-clock staleness guard query failed for ${symbol}: ${err.message} — ` +
        `proceeding without wall-clock protection`
      );
    }
  }

  // 0a. Global stale-data circuit breaker: if the newest candle (1m, plus the
  // strategy's entry tf) is older than a tf-aware threshold, block signal
  // generation immediately. This is the stale_market_data signal, kept distinct
  // from stale_state_feature (0b) so ops can tell ingestion lag from a dead
  // feature engine.
  const CANDLE_MAX_AGE_MINUTES: Record<TimeFrame, number> = {
    "1m": 10,
    "5m": 15,
    "15m": 25,
    "1h": 75,
    "4h": 300,
    "1d": 1500,
  };
  const candleTfsToCheck = new Set<TimeFrame>(["1m"]);
  const entryTf = strategySpec.entry?.[0]?.tf as TimeFrame | undefined;
  if (entryTf) candleTfsToCheck.add(entryTf);
  for (const tf of candleTfsToCheck) {
    const latestTs = await fetchLatestCandleTs(pool, symbol, tf, now);
    if (!latestTs) continue;
    const candleAgeMinutes = (now.getTime() - latestTs.getTime()) / 60_000;
    const maxAge = CANDLE_MAX_AGE_MINUTES[tf] ?? 15;
    if (candleAgeMinutes > maxAge) {
      const reason = `stale_data: latest ${tf} candle is ${candleAgeMinutes.toFixed(1)} min old`;
      await logSignalRejection(pool, effectiveDeploymentId, { symbol, strategyId: strategySpec.id, reason });
      return {
        trace: {
          runId: crypto.randomUUID(),
          symbol,
          strategyId: strategySpec.id,
          ts: now,
          nodes: [
            {
              nodeId: "stale_data",
              nodeType: "gate",
              passed: false,
              reason,
              latencyMs: 0,
            },
          ],
        },
        reason,
      };
    }
  }

  // 0b. Feature freshness guard — check all features the strategy needs
  const freshness = await checkFeatureFreshness(pool, symbol, strategySpec, now, !evaluationOnly);
  if (!freshness.ok) {
    await logSignalRejection(pool, effectiveDeploymentId, {
      symbol,
      strategyId: strategySpec.id,
      reason: freshness.reason ?? "feature_freshness",
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: now,
        nodes: [
          {
            nodeId: "feature_freshness",
            nodeType: "gate",
            passed: false,
            reason: freshness.reason,
            latencyMs: freshness.latencyMs,
          },
        ],
      },
      reason: freshness.reason,
    };
  }

  // 1. Fetch latest signal using compiled strategy SQL (parameterized: $1=symbol, $2=ttl interval)
  const maxAgeMin = strategySpec.live?.signalTtlMinutes ?? 15;
  const signalParams: unknown[] = [symbol, `${maxAgeMin} minutes`];
  if (signalAsOfParameter) signalParams.push(signalAsOfParameter);
  const signal = await fetchLatestSignal(pool, latestSignalSQL, signalParams, strategySpec.id);
  if (signal && strategySpec.familyId) {
    signal.familyId = strategySpec.familyId;
  }

  if (!signal) {
    await logSignalRejection(pool, effectiveDeploymentId, {
      symbol,
      strategyId: strategySpec.id,
      reason: "no_signal",
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: now,
        nodes: [],
      },
      reason: "no_signal",
    };
  }

  // 1b. Reject stale signals so we do not re-trade a setup from hours ago
  const signalAgeMinutes =
    (now.getTime() - signal.ts.getTime()) / 60_000;
  const maxSignalAgeMinutes = strategySpec.live?.signalTtlMinutes ?? 15;
  if (signalAgeMinutes > maxSignalAgeMinutes) {
    const reason = `stale_signal: age=${signalAgeMinutes.toFixed(1)}min > max=${maxSignalAgeMinutes}min`;
    await logSignalRejection(pool, effectiveDeploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason,
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: new Date(),
        nodes: [],
      },
      signal,
      reason,
    };
  }

  // 1c. Signal fingerprint + cooldown deduplication.
  const fingerprint = computeSignalFingerprint(signal);
  const cooldownMinutes = strategySpec.live?.cooldownMinutes ?? 30;

  // Live execution without immutable deployment provenance is forbidden. Replay
  // evaluation remains deployment-optional because it always rolls back.
  if (!evaluationOnly && !effectiveDeploymentId) {
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: now,
        nodes: [],
      },
      signal,
      orderCreated: false,
      reason: "provenance_required: active deployment missing",
    };
  }

  // Serialize the critical section: risk reads, live_signal insert, gate trace,
  // small-account check, setup eval, quality check, and order insert all happen
  // inside one transaction while holding the global risk_state row.
  let liveSignalId: string | undefined;
  let trace: DecisionTrace | undefined;
  let orderInput: any;
  let order: { id: string } | undefined;
  let liveOrderId: string | undefined;
  let result: LiveRunResult;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Per-symbol row lock — differs from migration 097 which seeded only a
    // 'global' row. We create per-symbol rows on first access so concurrent
    // pipeline runs on different symbols are NOT serialized (only same-symbol
    // executions wait). Migration 210 backfills any existing risk_state rows.
    await client.query(
      `INSERT INTO risk_state (scope) VALUES ($1) ON CONFLICT DO NOTHING`,
      [symbol]
    );
    await client.query(
      "SELECT 1 FROM risk_state WHERE scope = $1 FOR UPDATE",
      [symbol]
    );

    const duplicate = await findRecentDuplicate(client, fingerprint, cooldownMinutes, now);
    if (duplicate) {
      const reason = `duplicate_signal: cooldown=${cooldownMinutes}min`;
      throw new PipelineRejectionError({
        trace: {
          runId: crypto.randomUUID(),
          symbol,
          strategyId: strategySpec.id,
          ts: now,
          nodes: [
            {
              nodeId: "signal_dedup",
              nodeType: "gate",
              passed: false,
              reason: `duplicate_signal: same fingerprint rejected/closed ${duplicate.status} at ${duplicate.created_at.toISOString()}`,
              latencyMs: 0,
            },
          ],
        },
        signal,
        orderCreated: false,
        reason,
      });
    }

    // 1a. Canonical signal identity is mandatory for live execution. Any
    // persistence error aborts transaction before legacy order creation.
    // Returns null if the fingerprint dedup index caught a duplicate (23505
    // on idx_live_signal_dedup_v2) — the SAVEPOINT rolled back only the INSERT
    // so the outer transaction is clean and we gracefully reject.
    if (effectiveDeploymentId) {
      liveSignalId = (await insertLiveSignal(client, effectiveDeploymentId, signal, fingerprint)) ?? undefined;
      if (!liveSignalId) {
        throw new PipelineRejectionError({
          trace: {
            runId: crypto.randomUUID(),
            symbol,
            strategyId: strategySpec.id,
            ts: now,
            nodes: [
              {
                nodeId: "signal_dedup",
                nodeType: "gate",
                passed: false,
                reason: `fingerprint_dedup: identical signal already recorded for this symbol/strategy (${fingerprint.slice(0, 12)}…)`,
                latencyMs: 0,
              },
            ],
          },
          signal,
          orderCreated: false,
          reason: "fingerprint_dedup: unique index caught in-flight duplicate",
        });
      }
    }

    // 2. Build DecisionGraph from strategy gates. Evaluation-only replay keeps
    // identical graph logic but disables trace persistence.
    const graph = new DecisionGraph(client, !evaluationOnly);

    const gateMap: Record<string, (params: any) => any> = {
      volatility: createVolatilityGate,
      session: createSessionGate,
      portfolioHeat: createPortfolioHeatGate,
      spread: createSpreadGate,
      familyPosition: createFamilyPositionGate,
      rateLimit: createRateLimitGate,
      dailyLoss: createDailyLossGate,
      dailyWin: createDailyWinGate,
    };

    for (const gateConfig of strategySpec.gates) {
      const gateFactory = gateMap[gateConfig.name];
      if (!gateFactory) {
        throw new Error(
          `[liveRunner] Unknown gate '${gateConfig.name}' in spec '${strategySpec.id}' — ` +
          `typo'd gate names silently vanish, creating a false sense of protection. ` +
          `Valid gates: ${Object.keys(gateMap).join(", ")}`
        );
      }
      const gate = gateFactory(gateConfig.params);
      graph.addNode({
        id: gateConfig.id ?? gateConfig.name,
        type: "gate",
        gate,
        children: [],
      });
    }

    // 3. Fetch latest features for gate evaluation
    const features = await fetchLatestFeatures(client, symbol, signal.ts, strategySpec);

    // 3b. Fetch recent orders at the evaluation edge for rate-limit and daily
    // P&L gates, plus active orders for portfolio heat gate.
    const { rows: recentRows } = await client.query(
      `SELECT id, symbol, strategy_id, variant_id, family_id, side, entry_type, entry_price, stop_loss, take_profit,
              status, fill_price, close_price, outcome, outcome_r, realized_pnl,
              created_at, filled_at, closed_at
       FROM orders
       WHERE created_at >= $1::timestamptz - INTERVAL '24 hours'
         AND created_at <= $1::timestamptz`,
      [now],
    );

    const mapOrder = (r: any) => ({
      id: r.id,
      symbol: r.symbol,
      strategyId: r.strategy_id,
      familyId: r.family_id ?? undefined,
      side: r.side,
      entryType: r.entry_type,
      entryPrice: parseFloat(r.entry_price),
      stopLoss: parseFloat(r.stop_loss),
      takeProfit: parseFloat(r.take_profit),
      status: r.status,
      fillPrice: r.fill_price ? parseFloat(r.fill_price) : undefined,
      closePrice: r.close_price ? parseFloat(r.close_price) : undefined,
      outcome: r.outcome,
      outcomeR: r.outcome_r ? parseFloat(r.outcome_r) : undefined,
      realizedPnl: r.realized_pnl ? parseFloat(r.realized_pnl) : undefined,
      createdAt: new Date(r.created_at),
      filledAt: r.filled_at ? new Date(r.filled_at) : undefined,
      closedAt: r.closed_at ? new Date(r.closed_at) : undefined,
    });

    const recentOrders = recentRows.map(mapOrder);
    const activeOrders = recentOrders.filter((o) =>
      (ACTIVE_ORDER_STATUSES as readonly string[]).includes(o.status)
    );

    // 4. Evaluate gates with real feature data
    const ctx = {
      symbol,
      ts: signal.ts,
      features,
      signal,
      activeOrders,
      recentOrders,
      pool: client,
    };

    trace = await graph.evaluate(ctx);

    // 4b. Attach gate trace to persisted live signal
    if (liveSignalId) {
      await updateLiveSignalTrace(client, liveSignalId, trace.runId);
    }

    // 5. Check if all gates passed
    const allPassed = trace.nodes.every((n) => n.passed);

    if (!allPassed) {
      const failed = trace.nodes.filter((n) => !n.passed);
      const reason = `gates_failed: ${failed.map((f) => f.nodeId).join(", ")}`;
      throw new PipelineRejectionError({
        trace,
        signal,
        orderCreated: false,
        liveSignalId,
        reason,
      });
    }

    // 6. Small-account safety guard (V1-inspired position manager).
    //    Enforces max positions per symbol / total, daily loss limit,
    //    cooldown, and consecutive-loss circuit breaker. Use the spec's live
    //    config so multi-pair strategies can allow concurrent positions.
    const smallAccountGate = await checkSmallAccountGate(client, symbol, {
      maxPositionsPerSymbol: strategySpec.live?.maxPositionsPerSymbol,
      maxPositionsTotal: strategySpec.live?.maxPositionsTotal,
      cooldownMinutes: strategySpec.live?.cooldownMinutes,
      accountBalance: strategySpec.live?.accountBalance,
    }, now);
    if (!smallAccountGate.ok) {
      throw new PipelineRejectionError({
        trace,
        signal,
        orderCreated: false,
        liveSignalId,
        reason: smallAccountGate.reason ?? "small_account_gate",
      });
    }

    // 7. Build setup evaluation snapshot for calibration/audit
    let setupSnapshot: SetupEvaluationSnapshot | undefined;
    try {
      const primaryTf =
        strategySpec.entry?.[0]?.tf ??
        strategySpec.setup?.find(
          (c) => c.feature === "features_bias" || c.feature === "features_htf_bias"
        )?.tf ??
        ("15m" as TimeFrame);
      const setupEval = await evaluateSetup(client, {
        symbol,
        tf: primaryTf,
        asOf: signal.ts,
        direction: signal.side === "buy" ? "long" : "short",
      });
      setupSnapshot = {
        symbol: setupEval.symbol,
        tf: setupEval.tf,
        ts: new Date(setupEval.timestamp),
        grade: setupEval.grade,
        direction: setupEval.direction,
        confidence: setupEval.confidence,
        entryZone: setupEval.entryZone,
        stopLoss: setupEval.stopLoss,
        takeProfit: setupEval.takeProfit,
        riskReward: setupEval.riskReward,
        evidence: setupEval.evidence,
        warnings: setupEval.warnings,
        blockReasons: setupEval.blockReasons,
      };
    } catch (err: any) {
      // Fail-closed: if setup evaluation throws (DB error, missing data, grader
      // crash), block the order rather than proceeding ungraded. A setup that
      // cannot be evaluated is not safe to trade. (#3.5.8c)
      console.error(`[liveRunner] ❌ setup evaluation failed for ${symbol}/${strategySpec.id}: ${err.message}`);
      throw new PipelineRejectionError({
        trace,
        signal,
        orderCreated: false,
        liveSignalId,
        reason: `setup_evaluation_failed: ${err.message}`,
      });
    }

    // 8. Block orders with a BLOCK setup grade
    if (setupSnapshot?.grade === "BLOCK") {
      const reason = `setup_blocked: ${setupSnapshot.blockReasons?.join(", ") ?? "setup grade BLOCK"}`;
      throw new PipelineRejectionError({
        trace,
        signal,
        orderCreated: false,
        liveSignalId,
        reason,
      });
    }

    // 9. Pre-trade execution quality: decide market, limit, or reject based on
    // current price vs. signal entry. This prevents bad fills like the USDCHF
    // trade where the market had already moved 10 pips away.
    const quality = await evaluateExecutionQuality(client, { ...signal, ts: now }, strategySpec);
    if (quality.action === "reject") {
      throw new PipelineRejectionError({
        trace,
        signal,
        orderCreated: false,
        liveSignalId,
        setupSnapshot,
        qualityDecision: quality,
        reason: `quality_rejected: ${quality.reason}`,
      });
    }

    // 10. Create order
    const profitSizingEnabled =
      strategySpec.live?.useProfitLotSizing ||
      process.env.SMALL_ACCOUNT_PROFIT_LOT_SIZING === "true" ||
      process.env.SMALL_ACCOUNT_PROFIT_LOT_SIZING === "1";
    const effectiveOverrides: Partial<LiveExecutionConfig> | undefined =
      profitSizingEnabled
        ? {
            ...liveOverrides,
            useProfitLotSizing: true,
            realizedProfit: await getTotalRealizedPnl(client, now),
          }
        : liveOverrides;

    orderInput = buildOrderInput(
      signal,
      strategySpec,
      trace.runId,
      effectiveOverrides,
      setupSnapshot,
      quality
    );
    orderInput.signal_fingerprint = fingerprint;

    if (evaluationOnly) {
      result = {
        trace,
        signal,
        orderCreated: true,
        orderCandidate: orderInput,
        setupSnapshot,
        qualityDecision: quality,
      };
      await client.query("ROLLBACK");
    } else {
      order = await createOrder(orderInput, client);

      // 10b. Canonical order lineage and legacy order share transaction. Missing
      // identity or insert failure rolls both records back; execution fails closed.
      if (!effectiveDeploymentId || !liveSignalId) {
        throw new Error("canonical order lineage unavailable");
      }
      liveOrderId = await insertLiveOrder(
        client,
        liveSignalId,
        effectiveDeploymentId,
        orderInput,
        order.id,
      );

      result = {
        trace,
        signal,
        orderCreated: true,
        orderId: order.id,
        liveSignalId,
        liveOrderId,
        setupSnapshot,
        qualityDecision: quality,
      };

      await client.query("COMMIT");
    }
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});

    if (err instanceof PipelineRejectionError) {
      result = err.result;
      const reason = result.reason ?? "rejected";
      await logSignalRejection(pool, effectiveDeploymentId, {
        symbol,
        strategyId: strategySpec.id,
        side: signal.side,
        ts: signal.ts,
        reason,
        fingerprint,
      });
    } else {
      if (!evaluationOnly) await notifyOrderRejected(
        signal.symbol,
        signal.side,
        strategySpec.name ?? strategySpec.id,
        err.message
      );
      await logSignalRejection(pool, effectiveDeploymentId, {
        symbol,
        strategyId: strategySpec.id,
        side: signal.side,
        ts: signal.ts,
        reason: `order_creation_failed: ${err.message}`,
        fingerprint,
      });
      result = {
        trace: trace ?? {
          runId: crypto.randomUUID(),
          symbol,
          strategyId: strategySpec.id,
          ts: new Date(),
          nodes: [],
        },
        signal,
        orderCreated: false,
        liveSignalId,
        reason: `order_creation_failed: ${err.message}`,
      };
    }
  } finally {
    client.release();
  }

  // Notifications and audit side effects happen only after a live commit.
  if (!evaluationOnly && liveSignalId && result.orderCreated) {
    await notifySignal(
      signal.symbol,
      signal.side,
      strategySpec.name ?? strategySpec.id,
      signal.entryPrice,
      signal.stopLoss,
      signal.takeProfit
    );
  }

  if (!evaluationOnly && result.orderCreated && orderInput && order) {
    await notifyOrderCreated(
      orderInput.symbol,
      orderInput.side,
      strategySpec.name ?? strategySpec.id,
      orderInput.trade_mode ?? "paper",
      orderInput.entry_price,
      orderInput.stop_loss,
      orderInput.take_profit,
      orderInput.lot_size,
      orderInput.executionInstruction?.executionStrategy
    );
  }

  if (!evaluationOnly && result.reason?.startsWith("quality_rejected")) {
    await notifyQualityRejected(
      signal.symbol,
      signal.side,
      strategySpec.name ?? strategySpec.id,
      result.reason.replace("quality_rejected: ", "") ?? "unknown"
    );
  }

  if (!evaluationOnly) appendSignalCandidate({
    strategy_id: strategySpec.id,
    symbol: signal.symbol,
    tf: null,
    ts: signal.ts,
    side: signal.side,
    entry_price: signal.entryPrice,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    bias_direction: (signal.source?.bias_direction as string | undefined) ?? null,
    setup_family: strategySpec.setupFamily ?? strategySpec.familyId ?? null,
    setup_grade: result.orderCreated ? "PASS" : "REJECTED",
    setup_block_reasons: result.reason ? [result.reason] : null,
    gate_results: result.trace?.nodes ?? null,
    decision_stage: result.orderCreated ? "executed" : "rejected",
    decision_reason: result.reason ?? null,
    feature_snapshot: signal.source ?? null,
    fingerprint,
    dedup_check_result: result.reason?.startsWith("duplicate_signal") ? "duplicate" : "not_duplicate",
    engine_version: "liveRunner",
    spec_hash: hashSpec(strategySpec),
    source: "live",
  });

  return result;
}

/**
 * Feature freshness guard (semantic-aware).
 *
 * The guard detects a DEAD feature pipeline, not whether a strategy condition is
 * currently satisfied (that is the setup evaluator's job). Semantics come from
 * the feature registry (single source of truth):
 *   - state/distribution (latest_as_of / sample_distribution): written every
 *     candle, so MAX(ts) must be within the per-tf freshness window
 *     (bias/atr/session/spread/pricing). A dead engine -> stale_state_feature.
 *   - event (candidate_set): sparse by nature. As long as market data is alive
 *     (circuit breaker 0a) the detector is eligible; absence of an event is
 *     correct behaviour, never staleness. The guard never blocks event features.
 *   - level (active_window): zones/OBs/iFVGs persist long after they form. The
 *     table is data-fresh if the level engine has written within a lookback-
 *     scaled window; absence of an *active* level at the signal instant is a
 *     setup condition (setup_blocked / no_signal), not a staleness rejection.
 *
 * Replaces the previous flat `maxAgeMinutes = 5` MAX(ts) check that falsely
 * flagged every level formed more than 5 minutes ago as stale.
 */
const TF_MINUTES: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

async function fetchLatestCandleTs(
  pool: Queryable,
  symbol: string,
  tf: TimeFrame,
  asOf: Date
): Promise<Date | null> {
  const table = CANDLE_TABLE_BY_TF[tf];
  if (!table) return null;
  try {
    const { rows } = await pool.query(
      `SELECT MAX(ts) as max_ts FROM ${table} WHERE symbol = $1 AND ts <= $2`,
      [symbol, asOf]
    );
    return rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
  } catch {
    return null;
  }
}

export interface FeatureFreshnessInput {
  featureName: string;
  tf: TimeFrame;
  featureMaxTs: Date | null;
  now: number;
}

export interface FeatureFreshnessDecision {
  ok: boolean;
  reason?: string;
}

/**
 * Pure per-feature freshness decision (no I/O). Exported for unit tests and so
 * checkFeatureFreshness stays a thin orchestration loop over DB results.
 */
export function evaluateFeatureFreshness({
  featureName,
  tf,
  featureMaxTs,
  now,
}: FeatureFreshnessInput): FeatureFreshnessDecision {
  // Event features are sparse by design: eligibility tracks market data (0a),
  // so the guard never blocks on the last-event row.
  if (isEventFeature(featureName)) {
    return { ok: true };
  }

  if (isLevelFeature(featureName)) {
    if (!featureMaxTs) {
      return {
        ok: false,
        reason: `stale_state_feature: ${featureName}@${tf}(level table empty)`,
      };
    }
    const lookbackBars = getDefaultLookbackBars(featureName, tf);
    const windowMin = lookbackBars * (TF_MINUTES[tf] ?? 15);
    const ageMinutes = (now - featureMaxTs.getTime()) / 60000;
    if (ageMinutes > windowMin) {
      return {
        ok: false,
        reason: `stale_state_feature: ${featureName}@${tf}(level engine ${ageMinutes.toFixed(0)}min > ${windowMin}min)`,
      };
    }
    return { ok: true };
  }

  // state / distribution: per-tf freshness window from the registry.
  const maxAge = getDefaultFreshnessMinutes(featureName, tf);
  if (maxAge === undefined) {
    // No contracted freshness (feature not in registry) -> pass, don't block.
    return { ok: true };
  }
  if (!featureMaxTs) {
    return { ok: false, reason: `stale_state_feature: ${featureName}@${tf}(no_data)` };
  }
  const ageMinutes = (now - featureMaxTs.getTime()) / 60000;
  if (ageMinutes > maxAge) {
    return {
      ok: false,
      reason: `stale_state_feature: ${featureName}@${tf}(age ${ageMinutes.toFixed(1)}min > ${maxAge}min)`,
    };
  }
  return { ok: true };
}

async function checkFeatureFreshness(
  pool: Queryable,
  symbol: string,
  strategySpec: StrategySpec,
  evaluationTs?: Date,
  checkProducerLedger = true
): Promise<{ ok: boolean; reason?: string; latencyMs: number }> {
  const start = performance.now();

  // Shared extraction: same (feature@tf) pairs as the pipeline trigger's
  // feature engine scheduler — single source of truth.
  const required = extractRequiredFeatures(strategySpec);

  const now = evaluationTs ?? new Date();
  const nowMs = now instanceof Date ? now.getTime() : Date.now();
  const problems: string[] = [];

  // Batch all per-table MAX(ts) lookups into ONE query instead of N separate
  // round-trips. Feature/tf values are drawn from the registry — controlled
  // code, not user input — so string interpolation is safe.
  const tableQueries = [...required].map((key) => {
    const [featureName, tf] = key.split("@");
    return `SELECT '${featureName}'::text AS feature_name, '${tf}'::text AS tf, MAX(ts) AS max_ts FROM ${featureName} WHERE symbol = $1 AND tf = '${tf}' AND ts <= $2`;
  });
  if (tableQueries.length > 0) {
    try {
      const { rows: freshnessRows } = await pool.query(tableQueries.join(" UNION ALL "), [symbol, now]);
      for (const row of freshnessRows) {
        const featureName = row.feature_name as string;
        const tf = row.tf as TimeFrame;
        const featureMaxTs = row.max_ts ? new Date(row.max_ts) : null;
        const decision = evaluateFeatureFreshness({ featureName, tf, featureMaxTs, now: nowMs });
        if (!decision.ok && decision.reason) problems.push(decision.reason);
      }
    } catch (err: any) {
      console.warn(`[liveRunner] Batched freshness query failed: ${err.message}`);
    }
  }

  // P0-C (skeleton SK-36/52): producer SLA cross-check. Level features also
  // verify lifecycle_refresh_state (catches the XAUUSD death-spiral where the
  // level table's MAX(ts) looked fresh while invalidation was weeks stale);
  // state features verify the engine producer ledger. Defaults to WARN during
  // rollout so a not-yet-populated ledger cannot halt live trading; set
  // TM_PRODUCER_STALE_ACTION=block to enforce (skeleton §7 acceptance).
  //
  // Level features check BOTH the engine producer (feature rows are computed)
  // AND the lifecycle producer (invalidations are refreshed). A missing engine
  // run means no fresh levels were created; a missing lifecycle run means stale
  // levels are not cleaned up — either makes level-based signals unreliable.
  const LEVEL_PRODUCER_MAX_AGE_MIN = 30;
  const STATE_PRODUCER_MAX_AGE_MIN = 10;
  const producerAction = (process.env.TM_PRODUCER_STALE_ACTION ?? "warn").toLowerCase();
  const producerProblems: string[] = [];
  for (const key of checkProducerLedger ? required : []) {
    const [featureName, tfRaw] = key.split("@");
    const tf = tfRaw as TimeFrame;
    if (isEventFeature(featureName)) continue; // sparse: tracked by candle freshness
    const level = isLevelFeature(featureName);

    // Level features: check BOTH engine (row creation) and lifecycle (invalidation).
    if (level) {
      for (const { producer, label } of [
        { producer: "engine" as const, label: "engine" },
        { producer: "lifecycle" as const, label: "lifecycle" },
      ]) {
        try {
          const res = await assertProducerFresh(pool, {
            symbol,
            feature_table: featureName,
            tf,
            maxAgeMinutes: LEVEL_PRODUCER_MAX_AGE_MIN,
            producer,
            crossCheckLifecycle: producer === "lifecycle",
          });
          if (!res.fresh && res.reason) producerProblems.push(`${label}:${res.reason}`);
        } catch (err: any) {
          console.warn(
            `[liveRunner] Producer freshness skipped for ${featureName}@${tf} (${producer}): ${err.message}`
          );
        }
      }
    } else {
      // State features: check engine producer only.
      try {
        const res = await assertProducerFresh(pool, {
          symbol,
          feature_table: featureName,
          tf,
          maxAgeMinutes: STATE_PRODUCER_MAX_AGE_MIN,
          producer: "engine",
          crossCheckLifecycle: false,
        });
        if (!res.fresh && res.reason) producerProblems.push(res.reason);
      } catch (err: any) {
        console.warn(
          `[liveRunner] Producer freshness skipped for ${featureName}@${tf}: ${err.message}`
        );
      }
    }
  }
  if (producerProblems.length > 0) {
    const msg = producerProblems.join("; ");
    if (producerAction === "block") {
      problems.push(msg);
    } else {
      console.warn(`[liveRunner] PRODUCER_STALE (warn-only): ${msg}`);
    }
  }

  const latencyMs = performance.now() - start;

  if (problems.length > 0) {
    return {
      ok: false,
      reason: problems.join("; "),
      latencyMs,
    };
  }

  return { ok: true, latencyMs };
}

function featureTf(
  featureName: string,
  spec: StrategySpec,
  defaultTf: TimeFrame
): TimeFrame {
  for (const item of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (item.feature === featureName && item.tf) return item.tf;
  }
  return defaultTf;
}

/** Fetch latest feature values from DB for gate evaluation */
async function fetchLatestFeatures(
  pool: Queryable,
  symbol: string,
  ts: Date,
  spec: StrategySpec
): Promise<Record<string, unknown>> {
  const features: Record<string, unknown> = {};

  // ATR
  const atrTf = featureTf("features_atr", spec, "15m");
  const { rows: atrRows } = await pool.query(
    `SELECT period, COALESCE(effective_value, value) AS value FROM features_atr
     WHERE symbol = $1 AND ts <= $2 AND tf = $3
     ORDER BY ts DESC, period ASC`,
    [symbol, ts, atrTf]
  );
  if (atrRows.length > 0) {
    features["features_atr"] = {
      values: atrRows.map((r) => ({ period: r.period, value: parseFloat(r.value) })),
    };
  }

  // Session
  const { rows: sessionRows } = await pool.query(
    `SELECT session, utc_hour FROM features_session
     WHERE symbol = $1 AND ts <= $2
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
  );
  if (sessionRows.length > 0) {
    features["features_session"] = {
      session: sessionRows[0].session,
      utcHour: sessionRows[0].utc_hour,
    };

    // P0-B2 (V3 BUG-3.1): symbol/session ATR distribution so a percentile vol
    // policy is asset-class-safe. The gate now defaults to p95 when no explicit
    // ceiling is configured, so we always fetch the profile when a volatility
    // gate exists. Miss -> gate falls back to absolute pip ceilings (if any) or
    // passes (no ceiling resolved).
    const vg = (spec.gates ?? []).find(
      (g: any) => (g.id ?? g.name) === "volatility_gate" || g.name === "volatility"
    ) as any;
    if (vg) {
      const atrTfForVol = featureTf("features_atr", spec, "5m");
      const profile = await getCachedVolatilityProfile(pool, symbol, atrTfForVol, sessionRows[0].session);
      if (profile) {
        features["market_volatility_profile"] = profile;
      }
    }
  }

  // Direction state (Direction Arbiter) — only when the volatility gate opts into
  // regime-aware relaxation. Miss -> gate treats it as absent (no relax = today's
  // behavior), so disabled specs pay nothing.
  const vgDs = (spec.gates ?? []).find(
    (g: any) => (g.id ?? g.name) === "volatility_gate" || g.name === "volatility"
  ) as any;
  const rr = vgDs?.params?.regimeRelax;
  if (rr?.enabled) {
    const dsTf = rr.tf ?? featureTf("features_direction_state", spec, "1h");
    try {
      const { rows: dsRows } = await pool.query(
        `SELECT direction, regime, agreement, bias_direction, htf_direction, htf_state, confidence, reason
         FROM features_direction_state
         WHERE symbol = $1 AND ts <= $2 AND tf = $3
         ORDER BY ts DESC LIMIT 1`,
        [symbol, ts, dsTf]
      );
      if (dsRows.length > 0) {
        const r = dsRows[0];
        features["features_direction_state"] = {
          direction: r.direction,
          regime: r.regime,
          agreement: r.agreement === true || r.agreement === "t",
          biasDirection: r.bias_direction,
          htfDirection: r.htf_direction,
          htfState: r.htf_state,
          confidence: r.confidence != null ? Number(r.confidence) : undefined,
          reason: r.reason,
        };
      }
    } catch {
      // table missing or mocked out: gate treats as no direction_state (no relax)
    }
  }

  // Spread (always 1m source)
  const spreadTf = featureTf("features_spread", spec, "1m");
  const { rows: spreadRows } = await pool.query(
    `SELECT spread, samples FROM features_spread
     WHERE symbol = $1 AND ts <= $2 AND tf = $3
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts, spreadTf]
  );
  if (spreadRows.length > 0) {
    features["features_spread"] = {
      spread: parseFloat(spreadRows[0].spread),
      samples: parseInt(spreadRows[0].samples, 10),
    };
  }

  // Pricing
  const pricingTf = featureTf("features_pricing", spec, "15m");
  const { rows: pricingRows } = await pool.query(
    `SELECT position, in_ote, ote_low, ote_high FROM features_pricing
     WHERE symbol = $1 AND ts <= $2 AND tf = $3
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts, pricingTf]
  );
  if (pricingRows.length > 0) {
    features["features_pricing"] = {
      position: pricingRows[0].position,
      inOte: pricingRows[0].in_ote,
      oteLow: parseFloat(pricingRows[0].ote_low),
      oteHigh: parseFloat(pricingRows[0].ote_high),
    };
  }

  // Bias
  const biasTf = featureTf("features_bias", spec, "15m");
  const { rows: biasRows } = await pool.query(
    `SELECT direction, confidence, reason FROM features_bias
     WHERE symbol = $1 AND ts <= $2 AND tf = $3
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts, biasTf]
  );
  if (biasRows.length > 0) {
    features["features_bias"] = {
      direction: biasRows[0].direction,
      confidence: biasRows[0].confidence,
      reason: biasRows[0].reason,
    };
  }

  // Displacement
  const dispTf = featureTf("features_displacement", spec, "15m");
  const { rows: dispRows } = await pool.query(
    `SELECT grade, direction, body_pct FROM features_displacement
     WHERE symbol = $1 AND ts <= $2 AND tf = $3
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts, dispTf]
  );
  if (dispRows.length > 0) {
    features["features_displacement"] = {
      grade: dispRows[0].grade,
      direction: dispRows[0].direction,
      bodyPct: parseFloat(dispRows[0].body_pct),
    };
  }

  // Structure: fetch every active event at the most recent timestamp,
  // not just one. LIMIT 1 silently dropped multi-event state.
  const structureTf = featureTf("features_structure", spec, "15m");
  const { rows: structRows } = await pool.query(
    `WITH latest AS (
       SELECT ts FROM features_structure
       WHERE symbol = $1 AND ts <= $2 AND tf = $3 AND invalidated_at IS NULL
       ORDER BY ts DESC LIMIT 1
     )
     SELECT s.event_type, s.direction, s.level, s.invalidated_at
     FROM features_structure s
     JOIN latest l ON s.ts = l.ts
     WHERE s.symbol = $1 AND s.tf = $3 AND s.invalidated_at IS NULL`,
    [symbol, ts, structureTf]
  );
  if (structRows.length > 0) {
    features["features_structure"] = {
      events: structRows.map((r) => ({
        eventType: r.event_type,
        direction: r.direction,
        level: parseFloat(r.level),
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at) : undefined,
      })),
    };
  }

  // Zone: fetch every active zone at the most recent timestamp.
  const zoneTf = featureTf("features_zone", spec, "15m");
  const { rows: zoneRows } = await pool.query(
    `WITH latest AS (
       SELECT ts FROM features_zone
       WHERE symbol = $1 AND ts <= $2 AND tf = $3
         AND mitigated_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY ts DESC LIMIT 1
     )
     SELECT z.zone_kind, z.top, z.bottom, z.fill_pct, z.tapped, z.mitigated_at, z.invalidated_at
     FROM features_zone z
     JOIN latest l ON z.ts = l.ts
     WHERE z.symbol = $1 AND z.tf = $3
       AND z.mitigated_at IS NULL
       AND z.invalidated_at IS NULL`,
    [symbol, ts, zoneTf]
  );
  if (zoneRows.length > 0) {
    features["features_zone"] = {
      zones: zoneRows.map((r) => ({
        zoneKind: r.zone_kind,
        top: parseFloat(r.top),
        bottom: parseFloat(r.bottom),
        fillPct: parseFloat(r.fill_pct),
        tapped: r.tapped,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at) : undefined,
      })),
    };
  }

  // iFVG: fetch every currently-active (open) iFVG formed on/before the anchor.
  // `features_ifvg.ts` is the formation (createdAt) time per the registry contract,
  // so all open rows satisfy ts <= anchor; select them directly (no snapshot-ts
  // grouping — that pattern only worked when ts was the evaluation anchor).
  const ifvgTf = featureTf("features_ifvg", spec, "15m");
  const { rows: ifvgRows } = await pool.query(
    `SELECT i.direction, i.top, i.bottom, i.fill_pct, i.tapped, i.mitigated_at, i.invalidated_at
     FROM features_ifvg i
     WHERE i.symbol = $1 AND i.tf = $3 AND i.ts <= $2
       AND i.mitigated_at IS NULL
       AND i.invalidated_at IS NULL
     ORDER BY i.ts DESC`,
    [symbol, ts, ifvgTf]
  );
  if (ifvgRows.length > 0) {
    features["features_ifvg"] = {
      ifvgs: ifvgRows.map((r) => ({
        direction: r.direction,
        top: parseFloat(r.top),
        bottom: parseFloat(r.bottom),
        fillPct: parseFloat(r.fill_pct),
        tapped: r.tapped,
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at) : undefined,
      })),
    };
  }

  // Order block: fetch every active order block at the most recent timestamp.
  const obTf = featureTf("features_order_block", spec, "15m");
  const { rows: obRows } = await pool.query(
    `WITH latest AS (
       SELECT ts FROM features_order_block
       WHERE symbol = $1 AND ts <= $2 AND tf = $3
         AND mitigated_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY ts DESC LIMIT 1
     )
     SELECT o.ob_kind, o.degree, o.top, o.bottom, o.body_top, o.body_bottom,
            o.formation_ts, o.age_bars, o.is_fresh, o.strength_score,
            o.fill_pct, o.mitigated_at, o.invalidated_at
     FROM features_order_block o
     JOIN latest l ON o.ts = l.ts
     WHERE o.symbol = $1 AND o.tf = $3
       AND o.mitigated_at IS NULL
       AND o.invalidated_at IS NULL`,
    [symbol, ts, obTf]
  );
  if (obRows.length > 0) {
    features["features_order_block"] = {
      orderBlocks: obRows.map((r) => ({
        obKind: r.ob_kind,
        degree: r.degree,
        top: parseFloat(r.top),
        bottom: parseFloat(r.bottom),
        bodyTop: r.body_top ? parseFloat(r.body_top) : undefined,
        bodyBottom: r.body_bottom ? parseFloat(r.body_bottom) : undefined,
        formationTs: r.formation_ts ? new Date(r.formation_ts) : undefined,
        ageBars: r.age_bars,
        isFresh: r.is_fresh,
        strengthScore: parseFloat(r.strength_score),
        fillPct: parseFloat(r.fill_pct),
        mitigatedAt: r.mitigated_at ? new Date(r.mitigated_at) : undefined,
        invalidatedAt: r.invalidated_at ? new Date(r.invalidated_at) : undefined,
      })),
    };
  }

  return features;
}
