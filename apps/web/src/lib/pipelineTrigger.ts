/**
 * Pipeline Trigger.
 * Hooks into bar ingestion to run the live execution pipeline
 * when a new 15m candle closes.
 *
 * Phase 0 enhancement: Runs the V2 feature engine BEFORE strategy evaluation
 * to ensure features_* tables are fresh. If the engine fails, strategy evaluation
 * still proceeds but the feature freshness gate may block the signal.
 */

import { getPool } from "@tm/shared";
import {
  getOrCreateFeatureConfigSnapshot,
  getOrCreateStrategySettingsSnapshot,
  getOrCreateLiveDeployment,
  getActiveLiveDeployments,
} from "@tm/shared";
import { compileStrategy } from "@tm/strategies";
import { loadStrategyFromDB } from "@tm/strategies";
import { runLiveExecution } from "./liveRunner";
import { DAGRunner, globalDAG } from "@tm/engine";

// In-memory tracking of last processed 15m boundary per symbol
const lastProcessed = new Map<string, number>();

function get15mBucket(ts: Date): number {
  const d = new Date(ts);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
  return d.getTime();
}

export interface TriggerResult {
  symbol: string;
  triggered: boolean;
  reason?: string;
  orderId?: string;
}

// Cache compiled strategy per spec ID
const compiledCache = new Map<string, ReturnType<typeof compileStrategy>>();

async function getCompiledStrategy(strategyId: string) {
  if (!compiledCache.has(strategyId)) {
    const pool = getPool();
    const spec = await loadStrategyFromDB(pool, strategyId);
    if (!spec) {
      throw new Error(`Strategy not found in DB: ${strategyId}`);
    }
    compiledCache.set(strategyId, compileStrategy(spec));
  }
  return compiledCache.get(strategyId)!;
}

/**
 * Run the V2 feature engine for a symbol across all relevant timeframes.
 * This ensures features_* tables are fresh before strategy evaluation.
 */
async function runFeatureEngine(
  symbol: string,
  endTs: Date
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  const pool = getPool();
  const runner = new DAGRunner(pool as any, globalDAG);

  // Timeframes used by current and planned strategies
  const timeframes: Array<"1m" | "5m" | "15m" | "1h" | "4h" | "1d"> = [
    "1m",
    "5m",
    "15m",
    "1h",
    "4h",
    "1d",
  ];

  // All registered features
  const allFeatures = globalDAG.getFeatureNames();

  try {
    for (const tf of timeframes) {
      await runner.run({
        symbol,
        tf,
        endTs,
        requestedFeatures: allFeatures,
        lookbackBars: 500,
      });
    }

    const latencyMs = performance.now() - start;
    return { ok: true, latencyMs };
  } catch (err: any) {
    const latencyMs = performance.now() - start;
    console.error(
      `[pipelineTrigger] Feature engine failed for ${symbol}:`,
      err.message
    );
    return { ok: false, latencyMs, error: err.message };
  }
}

async function runStrategyPipeline(
  symbol: string,
  latestTs: Date,
  strategyId: string
): Promise<TriggerResult> {
  const pool = getPool();

  // Load compiled strategy once; we need the spec for snapshots and the SQL for execution.
  let compiled: ReturnType<typeof compileStrategy>;
  try {
    compiled = await getCompiledStrategy(strategyId);
  } catch (err: any) {
    console.error(`[pipelineTrigger] Strategy load failed for ${symbol}/${strategyId}:`, err.message);
    return { symbol, triggered: false, reason: `strategy_error: ${err.message}` };
  }

  // Snapshot the feature DAG and strategy settings used for this run.
  // These snapshots make every signal/order reproducible later.
  let deploymentId: string | undefined;
  try {
    const featureSnapshotId = await getOrCreateFeatureConfigSnapshot(pool, globalDAG, {
      name: "v2-default",
      engineVersion: "2.0.0",
    });
    const strategySnapshotId = await getOrCreateStrategySettingsSnapshot(pool, compiled.spec);
    const deployment = await getOrCreateLiveDeployment(
      pool,
      strategyId,
      strategySnapshotId,
      featureSnapshotId,
      compiled.spec.live?.mode === "live" ? "live" : "paper"
    );
    deploymentId = deployment.deploymentId;
  } catch (err: any) {
    console.error(`[pipelineTrigger] Snapshot/deployment setup failed for ${symbol}/${strategyId}:`, err.message);
    // Continue without deployment; live_signal/order won't be written.
  }

  // Run the live pipeline
  try {
    const latestSignalSQL = compiled.latestSignalSQL(symbol);

    const result = await runLiveExecution({
      symbol,
      strategySpec: compiled.spec,
      latestSignalSQL,
      deploymentId,
    });

    if (result.orderCreated) {
      console.log(`[pipelineTrigger] Order created for ${symbol}/${strategyId}: ${result.orderId}`);
      return { symbol, triggered: true, orderId: result.orderId };
    } else {
      return {
        symbol,
        triggered: true,
        reason: result.reason ?? "no_order",
      };
    }
  } catch (err: any) {
    console.error(
      `[pipelineTrigger] Pipeline failed for ${symbol}/${strategyId}:`,
      err.message
    );
    return { symbol, triggered: false, reason: `error: ${err.message}` };
  }
}

async function getDefaultActiveStrategyId(pool: ReturnType<typeof getPool>): Promise<string | undefined> {
  const { rows } = await pool.query(
    `SELECT id FROM strategy_specs WHERE is_active = true AND mode = 'live' ORDER BY id LIMIT 1`
  );
  return rows[0]?.id ?? undefined;
}

/**
 * Call this after inserting new M1 candles.
 * If the latest candle crosses a 15m boundary, trigger the live pipeline
 * for a single strategy. When no strategyId is provided, the first active
 * live strategy is used (top-3 live specs: doyle_sd, orb_classic, watukushay_no1).
 */
export async function checkAndTriggerPipeline(
  symbol: string,
  strategyId?: string
): Promise<TriggerResult> {
  const pool = getPool();

  let resolvedStrategyId = strategyId;
  if (!resolvedStrategyId) {
    resolvedStrategyId = await getDefaultActiveStrategyId(pool);
    if (!resolvedStrategyId) {
      return { symbol, triggered: false, reason: "no_active_live_strategy" };
    }
  }

  // Get the latest candle timestamp
  const { rows } = await pool.query(
    `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );

  if (rows.length === 0) {
    return { symbol, triggered: false, reason: "no_candles" };
  }

  const latestTs = new Date(rows[0].ts);
  const bucket = get15mBucket(latestTs);
  const last = lastProcessed.get(symbol) ?? 0;

  // Only trigger once per 15m bucket
  if (bucket <= last) {
    return { symbol, triggered: false, reason: "already_processed" };
  }

  lastProcessed.set(symbol, bucket);

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${latestTs.toISOString()}`
  );

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  const engineResult = await runFeatureEngine(symbol, latestTs);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  return runStrategyPipeline(symbol, latestTs, resolvedStrategyId);
}

/**
 * Trigger the live pipeline for every active live_deployment for a symbol.
 * The V2 feature engine is run once, then each active strategy is evaluated.
 */
export async function checkAndTriggerAllActive(symbol: string): Promise<TriggerResult[]> {
  const pool = getPool();

  // Get the latest candle timestamp
  const { rows } = await pool.query(
    `SELECT ts FROM candles_1m WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );

  if (rows.length === 0) {
    return [{ symbol, triggered: false, reason: "no_candles" }];
  }

  const latestTs = new Date(rows[0].ts);
  const bucket = get15mBucket(latestTs);
  const last = lastProcessed.get(symbol) ?? 0;

  // Only trigger once per 15m bucket
  if (bucket <= last) {
    return [{ symbol, triggered: false, reason: "already_processed" }];
  }

  lastProcessed.set(symbol, bucket);

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${latestTs.toISOString()} (all active)`
  );

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  const engineResult = await runFeatureEngine(symbol, latestTs);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  const active = await getActiveLiveDeployments(pool);

  const results: TriggerResult[] = [];
  if (active.length === 0) {
    // Fallback: if no deployment has been created yet, run the first active live strategy.
    const fallbackId = await getDefaultActiveStrategyId(pool);
    if (!fallbackId) {
      return [{ symbol, triggered: false, reason: "no_active_live_strategy" }];
    }

    const result = await runStrategyPipeline(symbol, latestTs, fallbackId);
    results.push(result);
  } else {
    for (const deployment of active) {
      // Strategy spec filters.symbols handles symbol eligibility downstream.
      const result = await runStrategyPipeline(symbol, latestTs, deployment.strategyId);
      results.push(result);
    }
  }

  return results;
}
