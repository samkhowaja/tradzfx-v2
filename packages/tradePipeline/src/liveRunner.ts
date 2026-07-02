/**
 * Live Runner.
 * Orchestrates the full live execution pipeline:
 *   1. Run strategy SQL to find signals
 *   2. Evaluate DecisionGraph gates
 *   3. If all gates pass → call createOrder callback
 */

import crypto from "node:crypto";
import type { Pool, SetupEvaluationSnapshot } from "@tm/shared";
import type { StrategySpec, Signal, DecisionTrace, LiveExecutionConfig, TimeFrame } from "@tm/shared";
import { checkSmallAccountGate, CANDLE_TABLE_BY_TF } from "@tm/shared";
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

export interface LiveRunOptions {
  symbol: string;
  strategySpec: StrategySpec;
  /** Compiled strategy SQL that returns the latest signal for the symbol */
  latestSignalSQL: string;
  pool: Pool;
  /** Optional: override live config (e.g. from environment) */
  liveOverrides?: Partial<LiveExecutionConfig>;
  /** Active deployment snapshot ID. If provided, live_signal / live_order rows are written. */
  deploymentId?: string;
  /** Callback to create an order. Return the order ID. */
  createOrder: (input: {
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
  }) => Promise<{ id: string }>;
}

export interface LiveRunResult {
  trace: DecisionTrace;
  signal?: Signal;
  liveSignalId?: string;
  orderCreated?: boolean;
  orderId?: string;
  liveOrderId?: string;
  reason?: string;
}

interface SignalWithSource extends Signal {
  source: Record<string, unknown>;
}

/** Fetch the latest signal using the compiled strategy SQL */
async function fetchLatestSignal(
  pool: Pool,
  sql: string,
  strategyId: string
): Promise<SignalWithSource | null> {
  const { rows } = await pool.query(sql);

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

async function findRecentDuplicate(
  pool: Pool,
  fingerprint: string,
  cooldownMinutes: number
): Promise<{ status: string; created_at: Date } | null> {
  const { rows } = await pool.query(
    `SELECT status, created_at
     FROM orders
     WHERE signal_fingerprint = $1
       AND status IN ('rejected', 'expired', 'closed')
       AND created_at >= NOW() - ($2 || ' minutes')::interval
     ORDER BY created_at DESC
     LIMIT 1`,
    [fingerprint, String(cooldownMinutes)]
  );
  return rows[0] ?? null;
}

async function insertLiveSignal(
  pool: Pool,
  deploymentId: string,
  signal: SignalWithSource,
  fingerprint: string
): Promise<string | undefined> {
  const { rows } = await pool.query<{ signal_id: string }>(
    `INSERT INTO live_signal (
       deployment_id, symbol, ts, strategy_id, side, entry_type,
       entry_price, stop_loss, take_profit, confidence, source_json, signal_fingerprint
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (deployment_id, symbol, ts, strategy_id, side) DO NOTHING
     RETURNING signal_id`,
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
  return rows[0]?.signal_id;
}

async function updateLiveSignalTrace(
  pool: Pool,
  signalId: string,
  traceRunId: string
): Promise<void> {
  await pool.query(
    `UPDATE live_signal SET gate_trace_run_id = $1 WHERE signal_id = $2`,
    [traceRunId, signalId],
  );
}

async function logSignalRejection(
  pool: Pool,
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
  pool: Pool,
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
  const { symbol, strategySpec, latestSignalSQL, pool, liveOverrides, deploymentId, createOrder } = opts;

  // 0a. Global stale-data circuit breaker: if the newest 1m candle is older
  // than MAX_CANDLE_AGE_MINUTES, block signal generation immediately.
  const MAX_CANDLE_AGE_MINUTES = 10;
  const latest1mTs = await fetchLatestCandleTs(pool, symbol, "1m");
  if (latest1mTs) {
    const candleAgeMinutes = (Date.now() - latest1mTs.getTime()) / 60_000;
    if (candleAgeMinutes > MAX_CANDLE_AGE_MINUTES) {
      const reason = `stale_data: latest 1m candle is ${candleAgeMinutes.toFixed(1)} min old`;
      await logSignalRejection(pool, deploymentId, { symbol, strategyId: strategySpec.id, reason });
      return {
        trace: {
          runId: crypto.randomUUID(),
          symbol,
          strategyId: strategySpec.id,
          ts: new Date(),
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
  const freshness = await checkFeatureFreshness(pool, symbol, strategySpec);
  if (!freshness.ok) {
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      reason: freshness.reason ?? "feature_freshness",
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: new Date(),
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

  // 1. Fetch latest signal using compiled strategy SQL
  const signal = await fetchLatestSignal(pool, latestSignalSQL, strategySpec.id);
  if (signal && strategySpec.familyId) {
    signal.familyId = strategySpec.familyId;
  }

  if (!signal) {
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      reason: "no_signal",
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: new Date(),
        nodes: [],
      },
      reason: "no_signal",
    };
  }

  // 1b. Reject stale signals so we do not re-trade a setup from hours ago
  const signalAgeMinutes =
    (Date.now() - signal.ts.getTime()) / 60_000;
  const maxSignalAgeMinutes = strategySpec.live?.signalTtlMinutes ?? 15;
  if (signalAgeMinutes > maxSignalAgeMinutes) {
    const reason = `stale_signal: age=${signalAgeMinutes.toFixed(1)}min > max=${maxSignalAgeMinutes}min`;
    await logSignalRejection(pool, deploymentId, {
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
  const duplicate = await findRecentDuplicate(pool, fingerprint, cooldownMinutes);
  if (duplicate) {
    const reason = `duplicate_signal: cooldown=${cooldownMinutes}min`;
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason,
      fingerprint,
    });
    return {
      trace: {
        runId: crypto.randomUUID(),
        symbol,
        strategyId: strategySpec.id,
        ts: new Date(),
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
      reason,
    };
  }

  // 1a. Persist raw live signal when a deployment snapshot is active
  let liveSignalId: string | undefined;
  if (deploymentId) {
    try {
      liveSignalId = await insertLiveSignal(pool, deploymentId, signal, fingerprint);
      if (liveSignalId) {
        await notifySignal(
          signal.symbol,
          signal.side,
          strategySpec.name ?? strategySpec.id,
          signal.entryPrice,
          signal.stopLoss,
          signal.takeProfit
        );
      }
    } catch (err: any) {
      console.warn(`[liveRunner] failed to persist live_signal: ${err.message}`);
    }
  }

  // 2. Build DecisionGraph from strategy gates
  const graph = new DecisionGraph();

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
      console.warn(`[liveRunner] Unknown gate: ${gateConfig.name}`);
      continue;
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
  const features = await fetchLatestFeatures(pool, symbol, signal.ts, strategySpec);

  // 3b. Fetch recent orders (last 24h) for rate-limit and daily P&L gates,
  //      plus active orders for portfolio heat gate.
  const { rows: recentRows } = await pool.query(
    `SELECT id, symbol, strategy_id, variant_id, family_id, side, entry_type, entry_price, stop_loss, take_profit,
            status, fill_price, close_price, outcome, outcome_r, realized_pnl,
            created_at, filled_at, closed_at
     FROM orders
     WHERE created_at >= NOW() - INTERVAL '24 hours'`,
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
    ["pending", "sent", "filled"].includes(o.status)
  );

  // 4. Evaluate gates with real feature data
  const ctx = {
    symbol,
    ts: signal.ts,
    features,
    signal,
    activeOrders,
    recentOrders,
  };

  const trace = await graph.evaluate(ctx);

  // 4b. Attach gate trace to persisted live signal
  if (liveSignalId) {
    try {
      await updateLiveSignalTrace(pool, liveSignalId, trace.runId);
    } catch (err: any) {
      console.warn(`[liveRunner] failed to update live_signal trace: ${err.message}`);
    }
  }

  // 5. Check if all gates passed
  const allPassed = trace.nodes.every((n) => n.passed);

  if (!allPassed) {
    const failed = trace.nodes.filter((n) => !n.passed);
    const reason = `gates_failed: ${failed.map((f) => f.nodeId).join(", ")}`;
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason,
      fingerprint,
    });
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason,
    };
  }

  // 6. Small-account safety guard (V1-inspired position manager).
  //    Enforces max positions per symbol / total, daily loss limit,
  //    cooldown, and consecutive-loss circuit breaker. Use the spec's live
  //    config so multi-pair strategies can allow concurrent positions.
  const smallAccountGate = await checkSmallAccountGate(pool, symbol, {
    maxPositionsPerSymbol: strategySpec.live?.maxPositionsPerSymbol,
    maxPositionsTotal: strategySpec.live?.maxPositionsTotal,
    cooldownMinutes: strategySpec.live?.cooldownMinutes,
    accountBalance: strategySpec.live?.accountBalance,
  });
  if (!smallAccountGate.ok) {
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason: smallAccountGate.reason ?? "small_account_gate",
      fingerprint,
    });
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason: smallAccountGate.reason,
    };
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
    const setupEval = await evaluateSetup(pool, {
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
    console.warn(`[liveRunner] setup evaluation failed for ${symbol}:`, err.message);
  }

  // 8. Block orders with a BLOCK setup grade
  if (setupSnapshot?.grade === "BLOCK") {
    const reason = `setup_blocked: ${setupSnapshot.blockReasons?.join(", ") ?? "setup grade BLOCK"}`;
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason,
      fingerprint,
    });
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason,
    };
  }

  // 9. Pre-trade execution quality: decide market, limit, or reject based on
  // current price vs. signal entry. This prevents bad fills like the USDCHF
  // trade where the market had already moved 10 pips away.
  const quality = await evaluateExecutionQuality(pool, signal, strategySpec);
  if (quality.action === "reject") {
    await notifyQualityRejected(
      signal.symbol,
      signal.side,
      strategySpec.name ?? strategySpec.id,
      quality.reason ?? "unknown"
    );
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason: `quality_rejected: ${quality.reason}`,
      fingerprint,
    });
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason: `quality_rejected: ${quality.reason}`,
    };
  }

  // 10. Create order
  try {
    const orderInput = buildOrderInput(
      signal,
      strategySpec,
      trace.runId,
      liveOverrides,
      setupSnapshot,
      quality
    );
    (orderInput as any).signal_fingerprint = fingerprint;
    const order = await createOrder(orderInput);

    // 6b. Persist live order when a deployment snapshot is active
    let liveOrderId: string | undefined;
    if (deploymentId && liveSignalId) {
      try {
        liveOrderId = await insertLiveOrder(pool, liveSignalId, deploymentId, orderInput, order.id);
      } catch (err: any) {
        console.warn(`[liveRunner] failed to persist live_order: ${err.message}`);
      }
    }

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

    return {
      trace,
      signal,
      orderCreated: true,
      orderId: order.id,
      liveSignalId,
      liveOrderId,
    };
  } catch (err: any) {
    await notifyOrderRejected(
      signal.symbol,
      signal.side,
      strategySpec.name ?? strategySpec.id,
      err.message
    );
    await logSignalRejection(pool, deploymentId, {
      symbol,
      strategyId: strategySpec.id,
      side: signal.side,
      ts: signal.ts,
      reason: `order_creation_failed: ${err.message}`,
      fingerprint,
    });
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason: `order_creation_failed: ${err.message}`,
    };
  }
}

/**
 * Check whether all features required by a strategy are fresh (<5min old).
 * Extracts unique (feature, tf) pairs from the strategy spec and queries MAX(ts).
 */
const EVENT_FEATURES = new Set([
  "features_structure",
  "features_order_block",
  "features_ifvg",
  "features_sweep",
]);

async function fetchLatestCandleTs(
  pool: Pool,
  symbol: string,
  tf: TimeFrame
): Promise<Date | null> {
  const table = CANDLE_TABLE_BY_TF[tf];
  if (!table) return null;
  try {
    const { rows } = await pool.query(
      `SELECT MAX(ts) as max_ts FROM ${table} WHERE symbol = $1`,
      [symbol]
    );
    return rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
  } catch {
    return null;
  }
}

async function checkFeatureFreshness(
  pool: Pool,
  symbol: string,
  strategySpec: StrategySpec
): Promise<{ ok: boolean; reason?: string; latencyMs: number }> {
  const start = performance.now();

  // Extract every unique (feature, tf) pair from setup + entry + filters.
  // Using a Set keyed by "feature@tf" ensures strategies that reference the
  // same feature on multiple timeframes are all checked.
  const required = new Set<string>();

  for (const item of strategySpec.setup ?? []) {
    if (item.feature && item.tf) required.add(`${item.feature}@${item.tf}`);
  }
  for (const item of strategySpec.entry ?? []) {
    if (item.feature && item.tf) required.add(`${item.feature}@${item.tf}`);
  }

  // Also always check core features used by gates
  required.add("features_atr@15m");
  required.add("features_session@1m");
  required.add("features_spread@1m");

  const maxAgeMinutes = 5;
  const now = Date.now();
  const staleFeatures: string[] = [];

  for (const key of required) {
    const [featureName, tf] = key.split("@");
    // Skip if table doesn't exist (new migration not yet applied)
    try {
      const { rows } = await pool.query(
        `SELECT MAX(ts) as max_ts FROM ${featureName}
         WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );

      const featureMaxTs = rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;

      let referenceTs = featureMaxTs;
      if (EVENT_FEATURES.has(featureName)) {
        // Event-based features legitimately have no row when no event occurs.
        // Use the latest candle for the referenced TF as the freshness anchor.
        const candleTs = await fetchLatestCandleTs(pool, symbol, tf as TimeFrame);
        if (candleTs && (!referenceTs || candleTs.getTime() > referenceTs.getTime())) {
          referenceTs = candleTs;
        }
      }

      if (!referenceTs) {
        staleFeatures.push(`${featureName}@${tf}(no_data)`);
        continue;
      }

      const ageMinutes = (now - referenceTs.getTime()) / 60000;
      if (ageMinutes > maxAgeMinutes) {
        staleFeatures.push(`${featureName}@${tf}(${ageMinutes.toFixed(1)}min)`);
      }
    } catch (err: any) {
      // Table doesn't exist or other error — log but don't block
      console.warn(
        `[liveRunner] Freshness check skipped for ${featureName}: ${err.message}`
      );
    }
  }

  const latencyMs = performance.now() - start;

  if (staleFeatures.length > 0) {
    return {
      ok: false,
      reason: `stale_features: ${staleFeatures.join(", ")}`,
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
  pool: Pool,
  symbol: string,
  ts: Date,
  spec: StrategySpec
): Promise<Record<string, unknown>> {
  const features: Record<string, unknown> = {};

  // ATR
  const atrTf = featureTf("features_atr", spec, "15m");
  const { rows: atrRows } = await pool.query(
    `SELECT period, value FROM features_atr
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

  // iFVG: fetch every active iFVG at the most recent timestamp.
  const ifvgTf = featureTf("features_ifvg", spec, "15m");
  const { rows: ifvgRows } = await pool.query(
    `WITH latest AS (
       SELECT ts FROM features_ifvg
       WHERE symbol = $1 AND ts <= $2 AND tf = $3
         AND mitigated_at IS NULL
         AND invalidated_at IS NULL
       ORDER BY ts DESC LIMIT 1
     )
     SELECT i.direction, i.top, i.bottom, i.fill_pct, i.tapped, i.mitigated_at, i.invalidated_at
     FROM features_ifvg i
     JOIN latest l ON i.ts = l.ts
     WHERE i.symbol = $1 AND i.tf = $3
       AND i.mitigated_at IS NULL
       AND i.invalidated_at IS NULL`,
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
