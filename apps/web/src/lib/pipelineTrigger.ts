/**
 * Pipeline Trigger.
 * Hooks into bar ingestion to run the live execution pipeline
 * when a new 15m candle closes.
 *
 * Phase 0 enhancement: Runs the V2 feature engine BEFORE strategy evaluation
 * to ensure features_* tables are fresh. If the engine fails, strategy evaluation
 * still proceeds but the feature freshness gate may block the signal.
 *
 * Phase 2 enhancement: Replaced process-local Maps with distributed state
 * (PostgreSQL trigger checkpoint + Redis-backed compiled-strategy cache).
 */

import {
  getPool,
  timeBucket,
  getRedisClient,
  acquirePipelineBucket,
  type Pool,
} from "@tm/shared";
import {
  getOrCreateFeatureConfigSnapshot,
  getOrCreateStrategySettingsSnapshot,
  getOrCreateLiveDeployment,
} from "@tm/shared";
import { compileStrategy, restoreCompiledStrategy } from "@tm/strategies";
import type { StrategySpec, TimeFrame } from "@tm/shared";
import { runLiveExecution } from "./liveRunner";
import { DAGRunner, globalDAG, updateLifecycleForSymbol } from "@tm/engine";
import {
  loadVariantById,
  loadActiveVariants,
  getDefaultActiveVariantForSymbol,
  type LoadedVariant,
} from "./strategyVariantLoader";

function get15mBucket(ts: Date): number {
  return timeBucket(ts, "15m").getTime();
}

export interface TriggerResult {
  symbol: string;
  triggered: boolean;
  reason?: string;
  orderId?: string;
}

interface CompiledMemoryEntry {
  compiled: ReturnType<typeof compileStrategy>;
  updatedAt: string;
}

// Small in-process cache for compiled strategies. The source of truth for
// invalidation is the strategy spec's `updated_at` timestamp.
const compiledMemory = new Map<string, CompiledMemoryEntry>();
const COMPILED_MEMORY_MAX = 100;

async function loadVariantWithVersion(
  pool: Pool,
  variantId: string
): Promise<{ variant: LoadedVariant } | null> {
  const variant = await loadVariantById(pool, variantId);
  if (!variant) return null;
  return { variant };
}

async function getCompiledStrategy(variantId: string) {
  const pool = getPool();
  const loaded = await loadVariantWithVersion(pool, variantId);
  if (!loaded) {
    throw new Error(`Strategy variant not found in DB: ${variantId}`);
  }
  const { spec, version: updatedAt } = loaded.variant;

  // 1. In-process cache keyed by version
  const mem = compiledMemory.get(variantId);
  if (mem && mem.updatedAt === updatedAt) {
    return mem.compiled;
  }

  // 2. Try Redis
  let sql: string | undefined;
  const redis = await getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(`tm:compiled:${variantId}`);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached.updatedAt === updatedAt && typeof cached.sql === "string" && cached.spec) {
          sql = cached.sql;
        }
      }
    } catch (err: any) {
      console.warn(`[pipelineTrigger] Redis compiled-strategy read failed for ${variantId}:`, err.message);
    }
  }

  // 3. Compile if not cached
  if (!sql) {
    const compiled = compileStrategy(spec, { trustStoredLifecycle: true });
    sql = compiled.sql;
    if (redis) {
      try {
        await redis.setEx(
          `tm:compiled:${variantId}`,
          3600,
          JSON.stringify({ sql, spec, updatedAt })
        );
      } catch (err: any) {
        console.warn(`[pipelineTrigger] Redis compiled-strategy write failed for ${variantId}:`, err.message);
      }
    }
  }

  const compiled = restoreCompiledStrategy(spec, sql);

  // Evict oldest if necessary
  if (compiledMemory.size >= COMPILED_MEMORY_MAX) {
    const first = compiledMemory.keys().next().value;
    if (first !== undefined) compiledMemory.delete(first);
  }
  compiledMemory.set(variantId, { compiled, updatedAt });
  return compiled;
}

interface FeatureRun {
  tf: TimeFrame;
  features: string[];
}

function getLiveLookbackBars(tf: TimeFrame): number {
  // Live only needs enough bars to compute the latest feature value.
  switch (tf) {
    case "1m":
      return 100;
    case "5m":
      return 120;
    case "15m":
      return 200;
    case "1h":
      return 96;
    case "4h":
      return 60;
    case "1d":
      return 30;
    default:
      return 100;
  }
}

/**
 * Collect only the (feature, tf) pairs that a strategy actually references,
 * plus the core gate inputs. Avoids recomputing the entire DAG every 15m.
 */
function collectRequiredFeatureRuns(spec: StrategySpec): FeatureRun[] {
  const map = new Map<TimeFrame, Set<string>>();
  const add = (feature: string, tf: TimeFrame) => {
    if (!map.has(tf)) map.set(tf, new Set());
    map.get(tf)!.add(feature);
  };

  for (const cond of [...(spec.setup ?? []), ...(spec.entry ?? [])]) {
    if (cond.feature && cond.tf) add(cond.feature, cond.tf);
  }

  // Core gate inputs
  add("features_atr", "15m");
  add("features_session", "1m");
  add("features_spread", "1m");

  return Array.from(map.entries()).map(([tf, features]) => ({
    tf,
    features: Array.from(features),
  }));
}

function mergeFeatureRuns(runs: FeatureRun[]): FeatureRun[] {
  const map = new Map<TimeFrame, Set<string>>();
  for (const { tf, features } of runs) {
    if (!map.has(tf)) map.set(tf, new Set());
    for (const f of features) map.get(tf)!.add(f);
  }
  return Array.from(map.entries()).map(([tf, features]) => ({
    tf,
    features: Array.from(features),
  }));
}

/**
 * Run the V2 feature engine for a symbol across only the timeframes and
 * features required by the active strategy. Uses batched inserts and a tight
 * live lookback to keep the 15m pipeline fast.
 */
async function runFeatureEngine(
  symbol: string,
  endTs: Date,
  featureRuns: FeatureRun[]
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  const pool = getPool();
  const runner = new DAGRunner(pool as any, globalDAG);

  try {
    for (const { tf, features } of featureRuns) {
      await runner.run({
        symbol,
        tf,
        endTs,
        requestedFeatures: features,
        lookbackBars: getLiveLookbackBars(tf),
        batchInserts: true,
        batchSize: 1000,
        // Live runs compute lifecycle inside the feature modules against the
        // bounded lookback window. The DB-level incremental lifecycle refresh
        // is expensive for symbols with many open zones; skip it here so the
        // 15m pipeline stays fast. A periodic back-office refresh can keep older
        // rows up to date.
        skipLifecycle: true,
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
  variantId: string
): Promise<TriggerResult> {
  const pool = getPool();

  // Load compiled strategy once; we need the spec for snapshots and the SQL for execution.
  let compiled: ReturnType<typeof compileStrategy>;
  try {
    compiled = await getCompiledStrategy(variantId);
  } catch (err: any) {
    console.error(`[pipelineTrigger] Strategy variant load failed for ${symbol}/${variantId}:`, err.message);
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
      variantId,
      strategySnapshotId,
      featureSnapshotId,
      compiled.spec.live?.mode === "live" ? "live" : "paper"
    );
    deploymentId = deployment.deploymentId;
  } catch (err: any) {
    console.error(`[pipelineTrigger] Snapshot/deployment setup failed for ${symbol}/${variantId}:`, err.message);
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
      console.log(`[pipelineTrigger] Order created for ${symbol}/${variantId}: ${result.orderId}`);
      return { symbol, triggered: true, orderId: result.orderId };
    } else {
      console.log(`[pipelineTrigger] No order for ${symbol}/${variantId}: ${result.reason ?? "no_order"}`);
      return {
        symbol,
        triggered: true,
        reason: result.reason ?? "no_order",
      };
    }
  } catch (err: any) {
    console.error(
      `[pipelineTrigger] Pipeline failed for ${symbol}/${variantId}:`,
      err.message
    );
    return { symbol, triggered: false, reason: `error: ${err.message}` };
  }
}

/**
 * Call this after inserting new M1 candles.
 * If the latest candle crosses a 15m boundary, trigger the live pipeline
 * for a single variant. When no variantId is provided, the first active
 * variant that trades this symbol is used.
 */
export async function checkAndTriggerPipeline(
  symbol: string,
  variantId?: string
): Promise<TriggerResult> {
  const pool = getPool();

  let resolvedVariantId = variantId;
  if (!resolvedVariantId) {
    resolvedVariantId = await getDefaultActiveVariantForSymbol(pool, symbol);
    if (!resolvedVariantId) {
      return { symbol, triggered: false, reason: "no_active_variant_for_symbol" };
    }
  }

  // Load the spec early so the feature engine can compute only what this
  // variant needs.
  const variantLoad = await loadVariantWithVersion(pool, resolvedVariantId);
  if (!variantLoad) {
    return { symbol, triggered: false, reason: "strategy_variant_not_found" };
  }
  const featureRuns = collectRequiredFeatureRuns(variantLoad.variant.spec);

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

  // Distributed bucket acquisition replaces the process-local Map.
  const acquired = await acquirePipelineBucket(pool, symbol, bucket);
  if (!acquired) {
    return { symbol, triggered: false, reason: "already_processed" };
  }

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${latestTs.toISOString()}`
  );

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  const engineResult = await runFeatureEngine(symbol, latestTs, featureRuns);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  // ── Phase 0b: Incrementally refresh lifecycle columns for zones/OBs/etc. ──
  // Use a tight live window: we only need to invalidate rows from the current
  // session. The 10-day/1000-row default is for backfills and times out live.
  try {
    const lifecycleResult = await updateLifecycleForSymbol(pool, symbol, {
      asOf: latestTs,
      lookbackDays: 1,
      limit: 100,
    });
    const totalUpdated = lifecycleResult.reduce((s, r) => s + r.rowsUpdated, 0);
    console.log(
      `[pipelineTrigger] Lifecycle refresh for ${symbol}: ${totalUpdated} rows updated`
    );
  } catch (err: any) {
    console.warn(
      `[pipelineTrigger] Lifecycle refresh failed for ${symbol}: ${err.message}`
    );
  }

  return runStrategyPipeline(symbol, latestTs, resolvedVariantId);
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

  const acquired = await acquirePipelineBucket(pool, symbol, bucket);
  if (!acquired) {
    return [{ symbol, triggered: false, reason: "already_processed" }];
  }

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${latestTs.toISOString()} (all active)`
  );

  // Determine which variants are active for this symbol and compute the union
  // of features they require, so the engine only runs what is actually needed.
  const active = await loadActiveVariants(pool, { symbol });
  let featureRuns: FeatureRun[];

  if (active.length === 0) {
    const fallbackId = await getDefaultActiveVariantForSymbol(pool, symbol);
    if (!fallbackId) {
      return [{ symbol, triggered: false, reason: "no_active_variant_for_symbol" }];
    }
    const loaded = await loadVariantWithVersion(pool, fallbackId);
    if (!loaded) {
      return [{ symbol, triggered: false, reason: "strategy_variant_not_found" }];
    }
    featureRuns = collectRequiredFeatureRuns(loaded.variant.spec);
  } else {
    const allRuns = active.flatMap((v) => collectRequiredFeatureRuns(v.spec));
    featureRuns = mergeFeatureRuns(allRuns);
  }

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  const engineResult = await runFeatureEngine(symbol, latestTs, featureRuns);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  const results: TriggerResult[] = [];
  for (const variant of active) {
    // Strategy spec filters.symbols handles symbol eligibility downstream.
    const result = await runStrategyPipeline(symbol, latestTs, variant.variantId);
    results.push(result);
  }

  // Fallback path: if no variants existed, the single-variant path above
  // already populated featureRuns but we still need to evaluate it.
  if (active.length === 0) {
    const fallbackId = await getDefaultActiveVariantForSymbol(pool, symbol);
    if (fallbackId) {
      const result = await runStrategyPipeline(symbol, latestTs, fallbackId);
      results.push(result);
    }
  }

  return results;
}

