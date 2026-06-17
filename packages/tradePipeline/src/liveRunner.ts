/**
 * Live Runner.
 * Orchestrates the full live execution pipeline:
 *   1. Run strategy SQL to find signals
 *   2. Evaluate DecisionGraph gates
 *   3. If all gates pass → call createOrder callback
 */

import type { Pool } from "@tm/shared";
import type { StrategySpec, Signal, DecisionTrace, LiveExecutionConfig } from "@tm/shared";
import { checkSmallAccountGate } from "@tm/shared";
import { DecisionGraph } from "./decisionGraph";
import { buildOrderInput } from "./orderExecutor";
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
  sql: string
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

  return {
    symbol: r.symbol,
    strategyId: r.strategy_id ?? "unknown",
    side: r.side,
    entryType,
    entryPrice: parseFloat(r.entry_price),
    stopLoss: parseFloat(r.stop_loss),
    takeProfit: parseFloat(r.take_profit),
    ts: new Date(r.ts),
    confidence: 70,
    source: r as Record<string, unknown>,
  };
}

async function insertLiveSignal(
  pool: Pool,
  deploymentId: string,
  signal: SignalWithSource
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO live_signal (
       deployment_id, symbol, ts, strategy_id, side, entry_type,
       entry_price, stop_loss, take_profit, confidence, source_json
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
    ],
  );
  return rows[0].signal_id;
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

  // 0. Feature freshness guard — check all features the strategy needs
  const freshness = await checkFeatureFreshness(pool, symbol, strategySpec);
  if (!freshness.ok) {
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
  const signal = await fetchLatestSignal(pool, latestSignalSQL);

  if (!signal) {
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

  // 1a. Persist raw live signal when a deployment snapshot is active
  let liveSignalId: string | undefined;
  if (deploymentId) {
    try {
      liveSignalId = await insertLiveSignal(pool, deploymentId, signal);
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
  const features = await fetchLatestFeatures(pool, symbol, signal.ts);

  // 3b. Fetch recent orders (last 24h) for rate-limit and daily P&L gates,
  //      plus active orders for portfolio heat gate.
  const { rows: recentRows } = await pool.query(
    `SELECT id, symbol, strategy_id, side, entry_type, entry_price, stop_loss, take_profit,
            status, fill_price, close_price, outcome, outcome_r, realized_pnl,
            created_at, filled_at, closed_at
     FROM orders
     WHERE created_at >= NOW() - INTERVAL '24 hours'`,
  );

  const mapOrder = (r: any) => ({
    id: r.id,
    symbol: r.symbol,
    strategyId: r.strategy_id,
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
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason: `gates_failed: ${failed.map((f) => f.nodeId).join(", ")}`,
    };
  }

  // 6. Small-account safety guard (V1-inspired position manager).
  //    Enforces max 1 position per symbol / 1 total, daily loss limit,
  //    cooldown, and consecutive-loss circuit breaker.
  const smallAccountGate = await checkSmallAccountGate(pool, symbol);
  if (!smallAccountGate.ok) {
    return {
      trace,
      signal,
      orderCreated: false,
      liveSignalId,
      reason: smallAccountGate.reason,
    };
  }

  // 7. Create order
  try {
    const orderInput = buildOrderInput(signal, strategySpec, trace.runId, liveOverrides);
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

    return {
      trace,
      signal,
      orderCreated: true,
      orderId: order.id,
      liveSignalId,
      liveOrderId,
    };
  } catch (err: any) {
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
async function checkFeatureFreshness(
  pool: Pool,
  symbol: string,
  strategySpec: StrategySpec
): Promise<{ ok: boolean; reason?: string; latencyMs: number }> {
  const start = performance.now();

  // Extract unique (feature, tf) pairs from setup + entry + filters
  const required = new Map<string, string>(); // featureName -> tf

  for (const item of strategySpec.setup ?? []) {
    if (item.feature && item.tf) required.set(item.feature, item.tf);
  }
  for (const item of strategySpec.entry ?? []) {
    if (item.feature && item.tf) required.set(item.feature, item.tf);
  }

  // Also always check core features used by gates
  required.set("features_atr", "15m");
  required.set("features_session", "1m");

  const maxAgeMinutes = 5;
  const now = new Date();
  const staleFeatures: string[] = [];

  for (const [featureName, tf] of required) {
    // Skip if table doesn't exist (new migration not yet applied)
    try {
      const { rows } = await pool.query(
        `SELECT MAX(ts) as max_ts FROM ${featureName}
         WHERE symbol = $1 AND tf = $2`,
        [symbol, tf]
      );

      const maxTs = rows[0]?.max_ts ? new Date(rows[0].max_ts) : null;
      if (!maxTs) {
        staleFeatures.push(`${featureName}@${tf}(no_data)`);
        continue;
      }

      const ageMinutes = (now.getTime() - maxTs.getTime()) / 60000;
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

/** Fetch latest feature values from DB for gate evaluation */
async function fetchLatestFeatures(
  pool: Pool,
  symbol: string,
  ts: Date
): Promise<Record<string, unknown>> {
  const features: Record<string, unknown> = {};

  // ATR (use 15m — same tf as batch compute)
  const { rows: atrRows } = await pool.query(
    `SELECT period, value FROM features_atr
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC, period ASC`,
    [symbol, ts]
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

  // Pricing
  const { rows: pricingRows } = await pool.query(
    `SELECT position, in_ote, ote_low, ote_high FROM features_pricing
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
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
  const { rows: biasRows } = await pool.query(
    `SELECT direction, confidence, reason FROM features_bias
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
  );
  if (biasRows.length > 0) {
    features["features_bias"] = {
      direction: biasRows[0].direction,
      confidence: biasRows[0].confidence,
      reason: biasRows[0].reason,
    };
  }

  // Displacement
  const { rows: dispRows } = await pool.query(
    `SELECT grade, direction, body_pct FROM features_displacement
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
  );
  if (dispRows.length > 0) {
    features["features_displacement"] = {
      grade: dispRows[0].grade,
      direction: dispRows[0].direction,
      bodyPct: parseFloat(dispRows[0].body_pct),
    };
  }

  // Structure
  const { rows: structRows } = await pool.query(
    `SELECT event_type, direction, level FROM features_structure
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
  );
  if (structRows.length > 0) {
    features["features_structure"] = {
      events: structRows.map((r) => ({
        eventType: r.event_type,
        direction: r.direction,
        level: parseFloat(r.level),
      })),
    };
  }

  // Zone
  const { rows: zoneRows } = await pool.query(
    `SELECT zone_kind, top, bottom, fill_pct, tapped FROM features_zone
     WHERE symbol = $1 AND ts <= $2 AND tf = '15m'
     ORDER BY ts DESC LIMIT 1`,
    [symbol, ts]
  );
  if (zoneRows.length > 0) {
    features["features_zone"] = {
      zones: zoneRows.map((r) => ({
        zoneKind: r.zone_kind,
        top: parseFloat(r.top),
        bottom: parseFloat(r.bottom),
        fillPct: parseFloat(r.fill_pct),
        tapped: r.tapped,
      })),
    };
  }

  return features;
}
