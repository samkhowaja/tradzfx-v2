/**
 * Feature DAG Runner.
 * Executes features in topological order, with caching and incremental support.
 */

import { createHash } from "node:crypto";
import type { Pool } from "@tm/shared";
import type {
  FeatureDefinition,
  FeatureOutputs,
  Candle,
  TimeFrame,
} from "@tm/shared";
import { getCandleTableForTf, filterWeekdayCandles, isTradableInstant, recordProducerRun, getRecentCandles, getRegistryPipSize } from "@tm/shared";

import { FeatureDAG, globalDAG } from "./graph";
import { FeatureCache } from "./cache";
import { evaluateProducerInvariant, getProducerOutputMode } from "./producerInvariant";
import { updateLifecycleForSymbol } from "../lifecycleUpdater";
import { recordZoneOutcomes } from "../features/zone";

/** Empty output shapes handed to features when a dependency has no rows — keeps
 * producers from crashing on undefined dep access (the `undefined.map` class). */
const DEP_EMPTY_OUTPUT: Record<string, unknown> = {
  features_atr: { values: [] },
  features_pivot: { pivots: [] },
  features_structure: { events: [] },
  features_sweep: { sweeps: [] },
  features_bias: { direction: "neutral", confidence: 0, score: 0 },
  features_htf_bias: { direction: "neutral", confidence: 0, score: 0 },
};

export interface RunOptions {
  symbol: string;
  tf: TimeFrame;
  endTs: Date;
  requestedFeatures: string[];
  lookbackBars?: number;
  skipCache?: boolean;
  batchInserts?: boolean;
  batchSize?: number;
  skipLifecycle?: boolean;
  /** Bypass forward-only onEvent optimization for exact historical hole repair. */
  skipEventGate?: boolean;
  /**
   * Skip the producer postflight invariant (output_anchor_stale etc.). The
   * invariant is a LIVE-freshness guard: it fails when a dense feature's
   * recomputed output anchor is older than the source clock. During a historical
   * backfill that re-touches already-populated dense deps (e.g. recomputing
   * features_atr while backfilling an onEvent feature like features_sweep), the
   * dep's output anchor is legitimately older than the live edge, so the
   * invariant is a false positive. Backfills pass this to avoid aborting bars.
   */
  skipInvariant?: boolean;
  /** Live runs should use a short window; backfills can widen it. */
  lifecycleLookbackDays?: number;
  lifecycleLimit?: number;
}

/**
 * Build the content-addressed cache input hash for a feature computation.
 *
 * SK-57: the feature's engine_ver (`feature.version`) is part of the key so that
 * an engine bump automatically busts stale `feature_cache` entries. Previously the
 * key was `(feature_name, hashInput, symbol, tf, ts)` — identical inputs across a
 * version bump collided, so the cache returned the PRE-bump output and the runner
 * short-circuited compute+persist of the corrected row (this is why ATR v1.1.0 →
 * v1.2.0 needed a manual `skipCache:true` recompute). With the version in the key, a
 * bump yields a cache miss → recompute → persist of the new engine_ver row.
 */
export function buildCacheInputHash(
  engineVer: string,
  contentHash: string,
  symbol: string,
  tf: string,
  endTs: Date
): string {
  return `${engineVer}:${contentHash}:${symbol}:${tf}:${endTs.toISOString()}`;
}
/**
 * Dense feature rows serialize without their own timestamp. Anchor those rows
 * to the newest candle actually read, not the caller's wall-clock endTs.
 */
export function resolveFeatureRowTs(rawTs: unknown, sourceMaxTs: Date): Date {
  return rawTs instanceof Date ? rawTs : sourceMaxTs;
}

export function buildOrderBlockLogicalId(
  symbol: string,
  tf: string,
  row: Record<string, unknown>
): Buffer | null {
  const formationTs = row.formation_ts;
  const sourceEventTs = row.source_event_ts;
  const sourceEventType = row.source_event_type;
  const sourceEventDirection = row.source_event_direction;
  const sourceEventLevel = row.source_event_level;
  if (
    !(formationTs instanceof Date) ||
    !(sourceEventTs instanceof Date) ||
    typeof sourceEventType !== "string" ||
    typeof sourceEventDirection !== "string" ||
    typeof sourceEventLevel !== "number" ||
    !Number.isFinite(sourceEventLevel)
  ) {
    return null;
  }
  const parts = [
    "features_order_block",
    "logical-id-v1",
    symbol,
    tf,
    formationTs.toISOString(),
    sourceEventTs.toISOString(),
    sourceEventType,
    sourceEventDirection,
    sourceEventLevel.toString(),
  ];
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(Buffer.from(String(Buffer.byteLength(part)), "ascii"));
    hash.update(":");
    hash.update(part, "utf8");
  }
  return hash.digest();
}

/** Keep forward-only event optimization enabled unless exact repair opts out. */
export function shouldApplyEventGate(
  computePolicy: FeatureDefinition<unknown, unknown>["computePolicy"],
  skipEventGate = false
): boolean {
  return computePolicy === "onEvent" && !skipEventGate;
}

export interface PersistOutcome {
  rows_seen: number;
  rows_attempted: number;
  rows_deduped: number;
  rows_inserted: number;
  rows_rejected: number;
  status: "done" | "error";
  error_message: string | null;
}

/**
 * SK-62: derive the truthful producer-run ledger fields for one batch persist.
 *
 * A batch INSERT is atomic: if it throws, ZERO rows persisted (the whole statement
 * rolls back). The old code logged the error and STILL recorded `status='done'` with
 * `rows_inserted = rowsAttempted` — so a fully-rejected batch looked perfectly healthy
 * ("done masks per-row rejections"). This helper makes the outcome explicit:
 *   - insertError != null  -> rows_inserted=0, rows_rejected=rowsAttempted, status='error'
 *   - success            -> rows_inserted=rowCount (default rowsAttempted),
 *                           rows_rejected = rowsAttempted - rows_inserted (>= 0)
 * Intra-batch PK duplicates dropped before the INSERT are reported as rows_deduped
 * (not rejections): rows_seen - rows_attempted.
 */
export function computePersistOutcome(
  rowsSeen: number,
  rowsAttempted: number,
  rowCount: number | null,
  insertError: string | null
): PersistOutcome {
  const rowsDeduped = Math.max(0, rowsSeen - rowsAttempted);
  if (insertError) {
    return {
      rows_seen: rowsSeen,
      rows_attempted: rowsAttempted,
      rows_deduped: rowsDeduped,
      rows_inserted: 0,
      rows_rejected: rowsAttempted,
      status: "error",
      error_message: insertError,
    };
  }
  const rowsInserted = Math.max(0, rowCount ?? rowsAttempted);
  return {
    rows_seen: rowsSeen,
    rows_attempted: rowsAttempted,
    rows_deduped: rowsDeduped,
    rows_inserted: rowsInserted,
    rows_rejected: Math.max(0, rowsAttempted - rowsInserted),
    status: "done",
    error_message: null,
  };
}

export function assertPersistSucceeded(tableName: string, outcome: PersistOutcome): void {
  if (outcome.status === "error") {
    throw new Error(
      `${tableName} persistence failed: ${outcome.error_message ?? "unknown error"}`
    );
  }
}

export async function resolveDensePostflightAnchor(
  pool: Pick<Pool, "query">,
  tableName: string,
  symbol: string,
  tf: string,
  sourceMaxTs: Date,
  bufferedOutputMaxTs: Date | null
): Promise<Date | null> {
  if (
    bufferedOutputMaxTs &&
    bufferedOutputMaxTs.getTime() >= sourceMaxTs.getTime()
  ) {
    return bufferedOutputMaxTs;
  }
  const persisted = await pool.query(
    `SELECT MAX(ts) AS max_ts FROM ${tableName}
      WHERE symbol = $1 AND tf = $2 AND ts <= $3`,
    [symbol, tf, sourceMaxTs]
  );
  const persistedMaxTs = persisted.rows[0]?.max_ts;
  return persistedMaxTs ? new Date(persistedMaxTs as string) : bufferedOutputMaxTs;
}

export class DAGRunner {
  private cache: FeatureCache;
  private tableColumnsCache = new Map<string, string[]>();
  private candlesCache = new Map<string, Candle[]>();
  private pendingInserts = new Map<string, Record<string, unknown>[]>();
  private pendingRunAnchors = new Map<string, { symbol: string; tf: string; sourceMinTs: Date; sourceMaxTs: Date; version: string }>();
  private defaultBatchSize = 1000;
  /**
   * Tracks last-computed candle MAX(ts) per feature per (symbol, tf).
   * Used by onEvent features to skip execution when input candles unchanged
   * since last run. (Audit item #5)
   */
  private featureLastCandleTs = new Map<string, number>();
  /** When true, the producer postflight invariant is not enforced (backfills). */
  private skipInvariant = false;

  private getFeatureKey(feature: string, symbol: string, tf: string): string {
    return `${feature}:${symbol}:${tf}`;
  }

  constructor(
    private pool: Pool,
    private dag: FeatureDAG = globalDAG
  ) {
    this.cache = new FeatureCache(pool);
  }

  async flush(): Promise<void> {
    for (const [tableName, rows] of this.pendingInserts) {
      const anchor = this.pendingRunAnchors.get(tableName);
      const outcome = rows.length > 0
        ? await this.insertRows(tableName, rows)
        : computePersistOutcome(0, 0, 0, null);
      if (anchor) {
        await this.recordFeatureExecution(tableName, anchor.version, anchor.symbol, anchor.tf, anchor.sourceMinTs, anchor.sourceMaxTs, rows, outcome, this.skipInvariant);
      }
      rows.length = 0;
    }
    this.pendingRunAnchors.clear();
  }

  private tablePKCache = new Map<string, string[]>();

  private async getTableColumns(tableName: string): Promise<string[]> {
    if (this.tableColumnsCache.has(tableName)) {
      return this.tableColumnsCache.get(tableName)!;
    }
    try {
      const { rows } = await this.pool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
        [tableName]
      );
      const columns = rows.map((r) => r.column_name as string);
      this.tableColumnsCache.set(tableName, columns);
      return columns;
    } catch {
      // Fallback: assume standard columns
      return ["symbol", "tf", "ts", "engine_ver", "input_hash"];
    }
  }

  private async getTablePK(tableName: string): Promise<string[]> {
    if (this.tablePKCache.has(tableName)) {
      return this.tablePKCache.get(tableName)!;
    }
    try {
      const { rows } = await this.pool.query(
        `SELECT kcu.column_name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
          WHERE tc.table_schema = 'public'
            AND tc.table_name = $1
            AND tc.constraint_type = 'PRIMARY KEY'
          ORDER BY kcu.ordinal_position`,
        [tableName]
      );
      const pk = rows.map((r) => r.column_name as string);
      this.tablePKCache.set(tableName, pk);
      return pk;
    } catch {
      return ["symbol", "tf", "ts"];
    }
  }

  async run(opts: RunOptions): Promise<FeatureOutputs> {
    this.candlesCache.clear();
    this.skipInvariant = opts.skipInvariant ?? false;
    const sorted = this.dag.sort(opts.symbol, opts.tf, opts.requestedFeatures);
    if (opts.batchInserts) {
      await Promise.all(sorted.map((f) => this.getTableColumns(f.name)));
    }
    const results: FeatureOutputs = {};

    for (const feature of sorted) {
      const input = await this.buildInput(feature, opts, results);
      const candles = (input.candles ?? []) as Candle[];
      if (candles.length === 0) {
        console.warn(
          `[engine] No weekday candles for ${opts.symbol} ${opts.tf} at ${opts.endTs.toISOString()}, skipping`
        );
        return results;
      }

      // onEvent skips: if feature only recomputes when input candles change
      // (computePolicy === "onEvent"), check if new candle data exists since
      // last-computed row. Exact historical hole repair must bypass this
      // forward-only optimization because a newer row does not fill an older gap.
      if (shouldApplyEventGate(feature.computePolicy, opts.skipEventGate)) {
        const maxCandleTs = candles.reduce(
          (max, c) => (c.ts.getTime() > max ? c.ts.getTime() : max),
          0
        );
        const fk = this.getFeatureKey(feature.name, opts.symbol, opts.tf);
        let lastTs = this.featureLastCandleTs.get(fk);
        if (lastTs === undefined) {
          try {
            const { rows } = await this.pool.query(
              `SELECT MAX(ts) as max_ts FROM ${feature.name}
               WHERE symbol = $1 AND tf = $2`,
              [opts.symbol, opts.tf]
            );
            lastTs = rows[0]?.max_ts
              ? new Date(rows[0].max_ts as string).getTime()
              : 0;
          } catch {
            lastTs = 0; // table may not exist yet
          }
          this.featureLastCandleTs.set(fk, lastTs);
        }
        if (maxCandleTs <= lastTs) {
          // Candles haven't advanced since last compute; skip
          if (lastTs > 0) {
            // Load cached output from DB so downstream deps get data
            const { rows } = await this.pool.query(
              `SELECT * FROM ${feature.name}
               WHERE symbol = $1 AND tf = $2 AND ts = (SELECT MAX(ts) FROM ${feature.name} WHERE symbol = $1 AND tf = $2)`,
              [opts.symbol, opts.tf]
            );
            if (rows.length > 0) {
              results[feature.name] = rows[0] as Record<string, unknown>;
              continue;
            }
          }
          // No prior row exists; fall through to compute
        }
      }

      // Include symbol/tf/endTs in the input hash so context-sensitive features
      // (e.g. HTF bias) do not collide across symbols or timestamps. engine_ver
      // (feature.version) is included so an engine bump busts stale cache entries
      // (SK-57) — see buildCacheInputHash.
      const inputHash = opts.skipCache
        ? `bulk:${opts.symbol}:${opts.tf}:${opts.endTs.toISOString()}`
        : buildCacheInputHash(
            feature.version,
            feature.hashInput(input),
            opts.symbol,
            opts.tf,
            opts.endTs
          );

      // Try cache unless disabled
      if (!opts.skipCache) {
        const cached = await this.cache.get(feature.name, inputHash);
        if (cached !== null) {
          results[feature.name] = cached;
          // Update lastCandleTs for onEvent features on cache hit
          if (feature.computePolicy === "onEvent" && candles.length > 0) {
            const maxTs = candles.reduce(
              (max, c) => (c.ts.getTime() > max ? c.ts.getTime() : max), 0
            );
            this.featureLastCandleTs.set(
              this.getFeatureKey(feature.name, opts.symbol, opts.tf),
              maxTs
            );
          }
          continue;
        }
      }

      // Compute (allow async features, e.g. HTF bias that queries the DB)
      const start = performance.now();
      const output = await Promise.resolve(
        feature.compute(input, {
          tf: opts.tf,
          pool: this.pool,
          symbol: opts.symbol,
          endTs: opts.endTs,
        })
      );
      const latency = performance.now() - start;

      const outputHash = opts.skipCache ? "" : feature.hashOutput(output);

      // Persist
      if (opts.batchInserts) {
        const sourceMaxTs = candles[candles.length - 1].ts;
        this.stage(feature, opts, output, inputHash, sourceMaxTs);
        this.pendingRunAnchors.set(feature.name, {
          symbol: opts.symbol,
          tf: opts.tf,
          sourceMinTs: candles[0].ts,
          sourceMaxTs,
          version: feature.version,
        });
        const rows = this.pendingInserts.get(feature.name);
        const batchSize = opts.batchSize ?? this.defaultBatchSize;
        if (rows && rows.length >= batchSize) {
          const outcome = await this.insertRows(feature.name, rows);
          const anchor = this.pendingRunAnchors.get(feature.name)!;
          await this.recordFeatureExecution(feature.name, feature.version, anchor.symbol, anchor.tf, anchor.sourceMinTs, anchor.sourceMaxTs, rows, outcome, this.skipInvariant);
          rows.length = 0;
          this.pendingRunAnchors.delete(feature.name);
        }
      } else {
        await this.persist(feature, opts, output, inputHash, outputHash, candles);
      }
      if (!opts.skipCache) {
        await this.cache.set(feature.name, inputHash, output, outputHash);
      }

      results[feature.name] = output;

      // Update lastCandleTs for onEvent tracking after successful persist
      if (feature.computePolicy === "onEvent" && candles.length > 0) {
        const maxTs = candles.reduce(
          (max, c) => (c.ts.getTime() > max ? c.ts.getTime() : max), 0
        );
        this.featureLastCandleTs.set(
          this.getFeatureKey(feature.name, opts.symbol, opts.tf),
          maxTs
        );
      }

      // Record completed zone outcomes for continuous learning. Kept outside
      // the feature compute so the feature remains pure and testable.
      if (feature.name === "features_zone") {
        const zoneOutput = output as { zones: any[] };
        try {
          await recordZoneOutcomes(
            this.pool,
            opts.symbol,
            opts.tf,
            zoneOutput.zones,
            (input.candles as Candle[]) ?? []
          );
        } catch (err: any) {
          console.warn(`[engine] Failed to record zone outcomes:`, err.message);
        }
      }

      if (latency > 100) {
        console.warn(
          `[engine] Slow feature: ${feature.name} took ${latency.toFixed(1)}ms`
        );
      }
    }

    // Persist any batched rows before refreshing lifecycle so the refresh sees
    // the latest feature rows.
    await this.flush();

    // Refresh lifecycle columns for all features that were just computed.
    // Backfill callers can skip this per-bar refresh and run it once at the end.
    if (!opts.skipLifecycle) {
      try {
        await updateLifecycleForSymbol(this.pool, opts.symbol, {
          asOf: opts.endTs,
          lookbackDays: opts.lifecycleLookbackDays ?? 10,
          limit: opts.lifecycleLimit ?? 10000,
        });
      } catch (err: any) {
        console.error(
          `[engine] Lifecycle refresh failed for ${opts.symbol}:`,
          err.message
        );
      }
    }

    return results;
  }

  /**
   * Load the latest persisted row for a dependency feature from the DB. Used when
   * a targeted backfill requests only a downstream feature (e.g. features_sweep)
   * whose dense dependencies (features_atr/pivot/structure) are already fully
   * populated — recomputing the whole closure per bar is wasteful. Returns
   * undefined if the table/row is missing so the feature can fall back to its own
   * internal guards.
   */
  private async loadPersistedDep(
    dep: string,
    symbol: string,
    tf: string,
    endTs: Date
  ): Promise<Record<string, unknown> | undefined> {
    try {
      const { rows } = await this.pool.query(
        `SELECT * FROM ${dep}
         WHERE symbol = $1 AND tf = $2 AND ts <= $3
         ORDER BY ts DESC LIMIT 1`,
        [symbol, tf, endTs]
      );
      if (rows.length === 0) return undefined;
      return rows[0] as Record<string, unknown>;
    } catch {
      return undefined; // table may not exist yet
    }
  }

  private async buildInput(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    results: FeatureOutputs
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {};

    // Add dependency outputs. If a dependency was already computed in this run
    // (it was requested or is an upstream of another requested feature), use it.
    // Otherwise, if it is already persisted in the DB (e.g. a dense feature fully
    // backfilled earlier) and this is a targeted backfill that only requested a
    // downstream feature, load the latest persisted row instead of recomputing
    // the entire dependency closure — a huge speedup for onEvent backfills.
    for (const dep of feature.dependencies) {
      if (results[dep] !== undefined) {
        input[dep] = results[dep];
        continue;
      }
      const loaded = await this.loadPersistedDep(dep, opts.symbol, opts.tf, opts.endTs);
      // Never hand a feature an undefined dependency: producers dereference dep
      // outputs with `.map()`/property access and crash the whole DAG run
      // (`undefined.map` class, e.g. liquidityPools@1d on sparse history).
      input[dep] = loaded ?? DEP_EMPTY_OUTPUT[dep];
    }

    // Add raw candles for all features (compute + hashInput need them)
    input.candles = await this.fetchCandles(
      opts.symbol,
      opts.tf,
      opts.endTs,
      opts.lookbackBars ?? 500
    );

    // Add reference-symbol candles for cross-asset features
    if (feature.referenceSymbols && feature.referenceSymbols.length > 0) {
      const referenceCandles: Record<string, Candle[]> = {};
      const refLookback = Math.max(5000, opts.lookbackBars ?? 500);
      for (const refSymbol of feature.referenceSymbols) {
        referenceCandles[refSymbol] = await this.fetchCandles(
          refSymbol,
          opts.tf,
          opts.endTs,
          refLookback
        );
      }
      input.referenceCandles = referenceCandles;
    }

    // Add higher-timeframe candles for features that reason across TFs
    if (feature.referenceTimeFrames && feature.referenceTimeFrames.length > 0) {
      const higherTfCandles: Record<TimeFrame, Candle[]> = {} as Record<TimeFrame, Candle[]>;
      const htfLookback = opts.lookbackBars ?? 500;
      for (const htf of feature.referenceTimeFrames) {
        higherTfCandles[htf] = await this.fetchCandles(
          opts.symbol,
          htf,
          opts.endTs,
          htfLookback
        );
      }
      input.higherTfCandles = higherTfCandles;
    }

    return input;
  }

  private async fetchCandles(
    symbol: string,
    tf: TimeFrame,
    endTs: Date,
    count: number
  ): Promise<Candle[]> {
    const key = `${symbol}|${tf}|${endTs.toISOString()}|${count}`;
    const cached = this.candlesCache.get(key);
    if (cached) return cached;

    if (process.env.TM_ENGINE_CANDLE_SOURCE !== "0") {
      // SK-08 (post-SK-10): DEFAULT. Count-based, gap-tolerant read via candleSource.
      // Cagg fast path, deterministic 1m-rollup fallback only when a tradable bar is
      // genuinely missing or the cagg lags endTs. Preserves tick_count (ATR
      // sparse_bucket). Parity-verified byte-identical to the legacy query on a
      // complete window. Set TM_ENGINE_CANDLE_SOURCE=0 to use the legacy direct path
      // (kill switch).
      const series = await getRecentCandles(this.pool, symbol, tf, endTs, count, {
        allowRealtimeFallback: true,
      });
      const candles = filterWeekdayCandles(series, symbol);
      this.candlesCache.set(key, candles);
      return candles;
    }

    const table = getCandleTableForTf(tf);
    // tick_count exists on the 5m/15m/1h/4h caggs but not on candles_1m or
    // candles_1d_utc; select it only where present so 1m/1d fetches don't error.
    // NOTE (SK-08): legacy direct path, reached only when TM_ENGINE_CANDLE_SOURCE=0.
    const tickCol = tf === "1m" || tf === "1d" ? "" : ", tick_count";
    const { rows } = await this.pool.query(
      `SELECT symbol, ts, o, h, l, c, v${tickCol}
       FROM ${table}
       WHERE symbol = $1 AND ts <= $2
       ORDER BY ts DESC
       LIMIT $3`,
      [symbol, endTs, count]
    );

    const candles = filterWeekdayCandles(
      rows
        .map(
          (r): Candle => ({
            symbol: r.symbol,
            ts: new Date(r.ts),
            o: parseFloat(r.o),
            h: parseFloat(r.h),
            l: parseFloat(r.l),
            c: parseFloat(r.c),
            v: r.v ? parseInt(r.v, 10) : undefined,
            spread: r.spread ? parseFloat(r.spread) : undefined,
            digits: r.digits ? parseInt(r.digits, 10) : undefined,
            tickCount: r.tick_count != null ? parseInt(r.tick_count, 10) : undefined,
          })
        )
        .reverse(),
      symbol
    );

    this.candlesCache.set(key, candles);
    return candles;
  }

  /**
   * Tables whose geometry columns (top / bottom) are part of the PK and must be
   * rounded to pip precision to prevent ATR-buffer drift from creating duplicate rows.
   */
  private static readonly GEOMETRY_TABLES = new Set([
    "features_zone",
    "features_zone_retest",
    "features_ifvg",
    "features_order_block",
  ]);

  /**
   * Round a price value to the nearest pip for the given symbol.
   * Uses the shared registry so every producer agrees on units.
   */
  private static roundToPip(value: number, symbol: string): number {
    const pipSize = getRegistryPipSize(symbol);
    if (!pipSize || pipSize <= 0) return value;
    return Math.round(value / pipSize) * pipSize;
  }

  private buildRows(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    output: unknown,
    inputHash: string,
    sourceMaxTs: Date
  ): Record<string, unknown>[] {
    const rawRows = feature.serialize(output);
    if (rawRows.length === 0) return [];

    const tableName = feature.name;
    const tableColumns = this.tableColumnsCache.get(tableName);
    if (!tableColumns) return [];

    const isGeometryTable = DAGRunner.GEOMETRY_TABLES.has(tableName);
    const symbol = opts.symbol;

    const allowWeekend = process.env.TM_FEATURE_ALLOW_WEEKEND === "1";
    const rows: Record<string, unknown>[] = [];
    for (const rawRow of rawRows) {
      const row: Record<string, unknown> = {};
      for (const col of tableColumns) {
        if (col === "symbol") {
          row[col] = (rawRow as Record<string, unknown>).symbol ?? symbol;
        } else if (col === "tf") {
          row[col] = (rawRow as Record<string, unknown>).tf ?? opts.tf;
        } else if (col === "ts") {
          row[col] = resolveFeatureRowTs(
            (rawRow as Record<string, unknown>).ts,
            sourceMaxTs
          );
        } else if (col === "engine_ver") {
          row[col] = feature.version;
        } else if (col === "input_hash") {
          row[col] = inputHash;
        } else if (col === "lineage_state") {
          row[col] = "trusted_current";
        } else if (col === "canonical_version") {
          row[col] = process.env.TM_CANONICAL_VERSION ?? "canonical-v1";
        } else if (col === "eligibility_model_version") {
          row[col] = process.env.TM_ELIGIBILITY_MODEL_VERSION ?? "eligibility-v1";
        } else if (col === "broker_policy_version") {
          row[col] = process.env.TM_BROKER_POLICY_VERSION ?? "policy-v1";
        } else if (col === "detector_version") {
          row[col] = process.env.TM_CANDLE_DETECTOR_VERSION ?? "detector-v3";
        } else if (col === "validator_version") {
          row[col] = process.env.TM_CANDLE_VALIDATOR_VERSION ?? "validator-v1";
        } else if (col === "input_end_ts") {
          row[col] = sourceMaxTs;
        } else if (col === "generated_at") {
          row[col] = new Date();
        } else if (col === "logical_id" && tableName === "features_order_block") {
          row[col] = buildOrderBlockLogicalId(symbol, opts.tf, rawRow);
        } else if (isGeometryTable && (col === "top" || col === "bottom")) {
          // RC-5 / 6-B: round geometry columns to pip-precision so the same
          // logical zone always produces the same PK regardless of ATR-buffer drift.
          const v = (rawRow as Record<string, unknown>)[col];
          row[col] = typeof v === "number" ? DAGRunner.roundToPip(v, symbol) : v;
        } else {
          row[col] = (rawRow as Record<string, unknown>)[col];
        }
      }
      // Feature timestamps represent candle completion/knowledge boundaries.
      // Accept a boundary when either the instant itself or the immediately
      // preceding market instant is tradable. This preserves Sunday-open rows
      // and Friday/daily-maintenance close evidence without admitting rows
      // wholly inside a closed interval.
      const rowTs = row.ts as Date;
      const closesTradableInterval = isTradableInstant(new Date(rowTs.getTime() - 1), symbol);
      if (!allowWeekend && !isTradableInstant(rowTs, symbol) && !closesTradableInterval) {
        continue;
      }
      rows.push(row);
    }
    return rows;
  }

  private async insertRows(
    tableName: string,
    rows: Record<string, unknown>[]
  ): Promise<PersistOutcome> {
    if (rows.length === 0) return computePersistOutcome(0, 0, 0, null);
    const pk = await this.getTablePK(tableName);
    const seen = new Set<string>();
    const uniqueRows = rows.filter((row) => {
      const key = pk.length > 0 ? pk.map((c) => String(row[c])).join("|") : JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (uniqueRows.length === 0) return computePersistOutcome(rows.length, 0, 0, null);
    const columns = Object.keys(uniqueRows[0]);
    const placeholders = uniqueRows
      .map(
        (_, i) =>
          `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(", ")})`
      )
      .join(", ");

    const values = uniqueRows.flatMap((row) => {
      return columns.map((col) => {
        const v = row[col];
        if (v instanceof Date) return v.toISOString();
        if (v === null || v === undefined) return null;
        if (Buffer.isBuffer(v)) return v;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
        if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
        return v;
      });
    });

    const conflictClause =
      pk.length > 0
        ? `ON CONFLICT (${pk.join(", ")}) DO UPDATE SET ${columns
            .filter((c) => !pk.includes(c))
            .map((c) => `${c} = EXCLUDED.${c}`)
            .join(", ")}`
        : "ON CONFLICT DO NOTHING";

    // SK-62: track the REAL persist outcome so a failed batch is not ledgered as
    // status='done' with rows_inserted=attempted. A batch INSERT is atomic, so on
    // throw zero rows persisted (the old code logged the error and still reported
    // success — "done masks per-row rejections").
    const rowsSeen = rows.length;
    const rowsAttempted = uniqueRows.length;
    let rowCount: number | null = null;
    let insertError: string | null = null;
    try {
      const res = await this.pool.query(
        `INSERT INTO ${tableName} (${columns.join(", ")})
         VALUES ${placeholders}
         ${conflictClause}`,
        values
      );
      rowCount = typeof res.rowCount === "number" ? res.rowCount : null;
    } catch (err: any) {
      insertError = err?.message ?? String(err);
      console.error(`[engine] Failed to persist ${tableName}:`, insertError);
    }
    const outcome = computePersistOutcome(rowsSeen, rowsAttempted, rowCount, insertError);
    if (outcome.rows_rejected > 0) {
      console.warn(
        `[engine] ${tableName} persist rejected ${outcome.rows_rejected}/${rowsAttempted} rows` +
          (insertError ? ` (${insertError})` : "")
      );
    }

    return outcome;
  }

  private async recordFeatureExecution(
    tableName: string,
    version: string,
    symbol: string,
    tf: string,
    sourceMinTs: Date,
    sourceMaxTs: Date,
    rows: Record<string, unknown>[],
    outcome: PersistOutcome,
    skipInvariant = false
  ): Promise<void> {
    let outputMaxTs: Date | null = null;
    for (const row of rows) {
      const value = row.ts;
      const ts = value instanceof Date ? value : value ? new Date(String(value)) : null;
      if (ts && (!outputMaxTs || ts > outputMaxTs)) outputMaxTs = ts;
    }
    const mode = getProducerOutputMode(tableName);
    // Batch flushes can end with no in-memory rows when an earlier threshold
    // flush already persisted the expected dense anchor, or when an idempotent
    // repair recomputes an existing row. Postflight must inspect persisted truth;
    // judging only the final buffer creates a false output_anchor_missing error.
    if (mode === "dense" && outcome.status === "done") {
      outputMaxTs = await resolveDensePostflightAnchor(
        this.pool,
        tableName,
        symbol,
        tf,
        sourceMaxTs,
        outputMaxTs
      );
    }
    const invariant = evaluateProducerInvariant({
      mode,
      sourceMaxTs,
      outputMaxTs,
      executionSucceeded: outcome.status === "done",
    });
    const status = invariant.passed ? "done" : "error";
    await recordProducerRun(this.pool, {
      producer: "engine",
      feature_table: tableName,
      symbol,
      tf,
      source_min_ts: sourceMinTs,
      source_max_ts: sourceMaxTs,
      rows_seen: outcome.rows_seen,
      rows_inserted: outcome.rows_inserted,
      watermark_ts: outputMaxTs,
      producer_version: version,
      status,
      error_message: outcome.error_message ?? (invariant.passed ? null : `producer invariant failed: ${invariant.reason}`),
      quality_json: {
        ...outcome,
        output_mode: mode,
        expected_anchor_ts: sourceMaxTs.toISOString(),
        output_anchor_ts: outputMaxTs?.toISOString() ?? null,
        invariant_passed: invariant.passed,
        invariant_reason: invariant.reason,
      },
    });
    // Persistence failure is never an optional invariant. Backfills may skip the
    // dense edge assertion while reconstructing history, but they must still
    // fail when an attempted batch did not reach the database.
    assertPersistSucceeded(tableName, outcome);
    if (!invariant.passed && !skipInvariant) {
      throw new Error(`${tableName} producer invariant failed: ${invariant.reason}`);
    }
  }

  private stage(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    output: unknown,
    inputHash: string,
    sourceMaxTs: Date
  ): void {
    if (!this.tableColumnsCache.has(feature.name)) return;
    const rows = this.buildRows(feature, opts, output, inputHash, sourceMaxTs);
    const existing = this.pendingInserts.get(feature.name);
    if (existing) {
      existing.push(...rows);
    } else {
      this.pendingInserts.set(feature.name, rows);
    }
  }

  private async persist(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    output: unknown,
    inputHash: string,
    _outputHash: string,
    candles: Candle[]
  ): Promise<void> {
    const tableName = feature.name;
    await this.getTableColumns(tableName);
    const sourceMaxTs = candles[candles.length - 1].ts;
    const rows = this.buildRows(feature, opts, output, inputHash, sourceMaxTs);
    const outcome = await this.insertRows(tableName, rows);
    await this.recordFeatureExecution(
      tableName,
      feature.version,
      opts.symbol,
      opts.tf,
      candles[0].ts,
      candles[candles.length - 1].ts,
      rows,
      outcome,
      opts.skipInvariant ?? false
    );
  }

}
