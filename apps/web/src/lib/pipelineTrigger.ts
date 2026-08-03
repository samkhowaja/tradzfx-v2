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
 *
 * Phase 2b enhancement: Data-clock anchored execution. Engine endTs and strategy
 * evaluationTs pin to latest candle ts (market.candles_1m_canonical MAX(ts))
 * instead of wall clock NOW(). Compiler time filters use MAX(ts) from the data-
 * clock table. Bucket acquisition (which candle close triggered the run) still
 * uses wall clock. This ensures live and backtest evaluation see identical
 * feature/strategy state for the same data window.
 */

import {
  getPool,
  timeBucket,
  getRedisClient,
  acquirePipelineBucket,
  getFeaturePipelineSymbol,
  type Pool,
} from "@tm/shared";
import {
  getOrCreateCompiledStrategySnapshot,
  getOrCreateFeatureConfigSnapshot,
  getOrCreateStrategySettingsSnapshot,
  getOrCreateLiveDeployment,
} from "@tm/shared";
import {
  COMPILER_CONTRACT_VERSION,
  FEATURE_REGISTRY_CONTRACT_VERSION,
  compileStrategy,
  resolveSourceRevision,
  restoreCompiledStrategy,
} from "@tm/strategies";
import type { StrategySpec, TimeFrame } from "@tm/shared";
import crypto from "crypto";
import { runLiveExecution } from "./liveRunner";
import {
  DAGRunner,
  globalDAG,
  resolveFeatureProfileRuns,
  updateLifecycleForSymbol,
} from "@tm/engine";
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
  specHash: string;
}

// Small in-process cache for compiled strategies. The source of truth for
// invalidation is the spec content hash (JSON-stable serialization), not
// updatedAt — spec changes without version bump still need fresh SQL.
// (Audit item #8)
const compiledMemory = new Map<string, CompiledMemoryEntry>();
const COMPILED_MEMORY_MAX = 100;

/** SHA-256 of stable-JSON'd spec. Detects ANY spec content change. */
function computeSpecHash(spec: StrategySpec): string {
  return crypto.createHash("sha256").update(JSON.stringify(spec)).digest("hex");
}

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
  const { spec } = loaded.variant;
  const DATA_CLOCK_TABLE = "market.candles_1m_canonical";

  // 1. In-process cache keyed by specHash
  const specHash = computeSpecHash(spec);
  const mem = compiledMemory.get(variantId);
  if (mem && mem.specHash === specHash) {
    return mem.compiled;
  }

  // 2. Try Redis (key = tm:compiled:<specHash> so spec changes = automatic miss)
  let sql: string | undefined;
  const redis = await getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(`tm:compiled:${specHash}`);
      if (raw) {
        const cached = JSON.parse(raw);
        if (typeof cached.sql === "string") {
          sql = cached.sql;
          // #9C: Warn if cached payload has a different dataClockTable or mode
          // than the current runtime — cache hit may be stale for the caller.
          if (cached.dataClockTable && cached.dataClockTable !== DATA_CLOCK_TABLE) {
            console.warn(
              `[pipelineTrigger] 🟡 Cache mismatch for ${variantId}: ` +
              `cached dataClockTable="${cached.dataClockTable}", current="${DATA_CLOCK_TABLE}"`
            );
          }
          if (cached.mode && cached.mode !== "live") {
            console.warn(
              `[pipelineTrigger] 🟡 Cache mismatch for ${variantId}: ` +
              `cached mode="${cached.mode}", current="live"`
            );
          }
        }
      }
    } catch (err: any) {
      console.warn(`[pipelineTrigger] Redis compiled-strategy read failed for ${variantId}:`, err.message);
    }
  }

  // 3. Compile if not cached
  if (!sql) {
    const compiled = compileStrategy(spec, { trustStoredLifecycle: true, dataClockTable: DATA_CLOCK_TABLE });
    sql = compiled.sql;
    if (redis) {
      try {
        await redis.setEx(
          `tm:compiled:${specHash}`,
          3600,
          JSON.stringify({ sql, spec, dataClockTable: DATA_CLOCK_TABLE })
        );
      } catch (err: any) {
        console.warn(`[pipelineTrigger] Redis compiled-strategy write failed for ${variantId}:`, err.message);
      }
    }
  }

  const compiled = restoreCompiledStrategy(spec, sql, DATA_CLOCK_TABLE);

  // Evict oldest if necessary
  if (compiledMemory.size >= COMPILED_MEMORY_MAX) {
    const first = compiledMemory.keys().next().value;
    if (first !== undefined) compiledMemory.delete(first);
  }
  compiledMemory.set(variantId, { compiled, specHash });
  return compiled;
}

interface FeatureRun {
  tf: TimeFrame;
  features: string[];
}

function getLiveLookbackBars(tf: TimeFrame): number {
  // Must cover max MA period (250) plus headroom for SMA/EMA.
  // filterWeekdayCandles removes weekend bars, so 250 raw bars may yield
  // only ~178 usable 1h bars — making SMA 250 (period=250) silently skip.
  // Factor ~1.4x to guarantee 250 usable candles after weekend filtering.
  switch (tf) {
    case "1m":
      return 400;
    case "5m":
      return 350;
    case "15m":
      return 400;
    case "1h":
      return 400;
    case "4h":
      return 350;
    case "1d":
      return 350;
    default:
      return 350;
  }
}

async function getUniverseFeatureRuns(
  pool: Pool,
  symbol: string
): Promise<FeatureRun[] | null> {
  const entry = await getFeaturePipelineSymbol(pool, symbol);
  if (!entry?.enabled) return null;
  return resolveFeatureProfileRuns(
    entry.requiredFeatureProfile,
    entry.profileVersion,
    entry.requiredTimeframes
  );
}

/**
 * Run V2 feature engine for universe-configured timeframes and feature profile.
 * Uses batched inserts and tight live lookback to keep 15m pipeline fast.
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
  variantId: string,
  evaluationTs?: Date
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
    const pitCompiled = compileStrategy(compiled.spec, {
      mode: "pit",
      trustStoredLifecycle: false,
      asOfParameter: 3,
    });
    const sourceSpecHash = computeSpecHash(compiled.spec);
    const compiledSnapshotId = await getOrCreateCompiledStrategySnapshot(pool, {
      strategySnapshotId,
      strategyId: variantId,
      compilerVersion: COMPILER_CONTRACT_VERSION,
      registryVersion: FEATURE_REGISTRY_CONTRACT_VERSION,
      sourceRevision: resolveSourceRevision(),
      sourceSpecHash,
      pitSignalSql: pitCompiled.signalAtSQL(),
    });
    const deployment = await getOrCreateLiveDeployment(
      pool,
      variantId,
      strategySnapshotId,
      featureSnapshotId,
      compiled.spec.live?.mode === "live" ? "live" : "paper",
      undefined,
      compiledSnapshotId,
    );
    deploymentId = deployment.deploymentId;
  } catch (err: any) {
    console.error(`[pipelineTrigger] Snapshot/deployment setup failed for ${symbol}/${variantId}:`, err.message);
    return {
      symbol,
      triggered: false,
      reason: `provenance_error: ${err.message}`,
    };
  }

  // Run the live pipeline only after immutable provenance is durable.
  try {
    const latestSignalSQL = compiled.latestSignalSQL();

    const result = await runLiveExecution({
      symbol,
      strategySpec: compiled.spec,
      latestSignalSQL,
      deploymentId,
      evaluationTs,
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

  const variantLoad = await loadVariantWithVersion(pool, resolvedVariantId);
  if (!variantLoad) {
    return { symbol, triggered: false, reason: "strategy_variant_not_found" };
  }

  const featureRuns = await getUniverseFeatureRuns(pool, symbol);
  if (!featureRuns) {
    return { symbol, triggered: false, reason: "feature_universe_disabled_or_missing" };
  }

  // Get canonical latest candle ts (only to confirm data exists, not as pipeline anchor).
  const { rows } = await pool.query(
    `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );

  if (rows.length === 0) {
    return { symbol, triggered: false, reason: "no_candles" };
  }

  const latestCandleTs = new Date(rows[0].ts);
  const now = new Date();
  const bucket = get15mBucket(now);

  // Distributed bucket acquisition replaces the process-local Map.
  const acquired = await acquirePipelineBucket(pool, symbol, bucket);
  if (!acquired) {
    return { symbol, triggered: false, reason: "already_processed" };
  }

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${now.toISOString()} (candle ${latestCandleTs.toISOString()})`
  );

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  // Feature engine endTs = data-clock (latest candle ts) for live/backtest parity.
  // Lifecycle asOf stays at candle ts to avoid marking zones invalidated in the future.
  const engineResult = await runFeatureEngine(symbol, latestCandleTs, featureRuns);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  // ── Phase 0b (P0-C, skeleton SK-24): best-effort lifecycle nudge. The heavy
  // scan runs on the scheduled maintenance pool (refresh-lifecycle.js,
  // statement_timeout=0); here we cap the inline call at 25s so the 60s web
  // pool can never freeze trading on a runaway lifecycle query.
  try {
    const lifecycleWork = updateLifecycleForSymbol(pool, symbol, {
      asOf: latestCandleTs,
      lookbackDays: 2,
      limit: 500,
    });
    const budget = new Promise<"budget">((resolve) =>
      setTimeout(() => resolve("budget"), 25_000)
    );
    const raced = await Promise.race([lifecycleWork, budget]);
    if (raced === "budget") {
      console.warn(
        `[pipelineTrigger] Lifecycle refresh for ${symbol} exceeded 25s live budget; deferring to scheduled maintenance`
      );
    } else {
      const totalUpdated = raced.reduce((s, r) => s + r.rowsUpdated, 0);
      console.log(
        `[pipelineTrigger] Lifecycle refresh for ${symbol}: ${totalUpdated} rows updated`
      );
    }
  } catch (err: any) {
    console.warn(
      `[pipelineTrigger] Lifecycle refresh failed for ${symbol}: ${err.message}`
    );
  }

  return runStrategyPipeline(symbol, latestCandleTs, resolvedVariantId, latestCandleTs);
}

/**
 * Trigger the live pipeline for every active live_deployment for a symbol.
 * The V2 feature engine is run once, then each active strategy is evaluated.
 */
export async function checkAndTriggerAllActive(symbol: string): Promise<TriggerResult[]> {
  if (process.env.TM_DISABLE_FEATURE_JOBS === "true") {
    console.log("[pipelineTrigger] Skipped: TM_DISABLE_FEATURE_JOBS=true");
    return [{ symbol, triggered: false, reason: "feature_jobs_disabled" }];
  }

  const pool = getPool();

  // Get canonical latest candle ts (only to confirm data exists, not as pipeline anchor).
  const { rows } = await pool.query(
    `SELECT ts FROM market.candles_1m_canonical WHERE symbol = $1 ORDER BY ts DESC LIMIT 1`,
    [symbol]
  );

  if (rows.length === 0) {
    return [{ symbol, triggered: false, reason: "no_candles" }];
  }

  const latestCandleTs = new Date(rows[0].ts);
  const now = new Date();
  const bucket = get15mBucket(now);

  const acquired = await acquirePipelineBucket(pool, symbol, bucket);
  if (!acquired) {
    return [{ symbol, triggered: false, reason: "already_processed" }];
  }

  console.log(
    `[pipelineTrigger] 15m boundary detected for ${symbol} @ ${now.toISOString()} (candle ${latestCandleTs.toISOString()}, all active)`
  );

  // Feature production belongs to canonical universe, independent from strategy activation.
  const featureRuns = await getUniverseFeatureRuns(pool, symbol);
  if (!featureRuns) {
    return [{ symbol, triggered: false, reason: "feature_universe_disabled_or_missing" }];
  }

  const active = await loadActiveVariants(pool, { symbol });

  // ── Phase 0: Run V2 feature engine BEFORE strategy evaluation ──
  const engineResult = await runFeatureEngine(symbol, latestCandleTs, featureRuns);
  if (engineResult.ok) {
    console.log(
      `[pipelineTrigger] Feature engine completed for ${symbol} in ${engineResult.latencyMs.toFixed(1)}ms`
    );
  } else {
    console.warn(
      `[pipelineTrigger] Feature engine failed for ${symbol} — proceeding with potentially stale features`
    );
  }

  // Run all active variant pipelines in parallel — they are fully independent
  // (separate compiled SQL, separate signals, separate gate evaluations).
  // Fallback variants are handled after Promise.all.
  const results: TriggerResult[] = await Promise.all(
    active.map((variant) =>
      runStrategyPipeline(symbol, latestCandleTs, variant.variantId, latestCandleTs)
    )
  );

  // Fallback path: if no variants existed, the single-variant path above
  // already populated featureRuns but we still need to evaluate it.
  if (active.length === 0) {
    const fallbackId = await getDefaultActiveVariantForSymbol(pool, symbol);
    if (fallbackId) {
      const result = await runStrategyPipeline(symbol, latestCandleTs, fallbackId, latestCandleTs);
      results.push(result);
    }
  }

  return results;
}

