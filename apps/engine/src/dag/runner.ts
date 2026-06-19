/**
 * Feature DAG Runner.
 * Executes features in topological order, with caching and incremental support.
 */

import type { Pool } from "@tm/shared";
import type {
  FeatureDefinition,
  FeatureOutputs,
  Candle,
  TimeFrame,
} from "@tm/shared";

const CANDLE_TABLE_BY_TF: Record<TimeFrame, string> = {
  "1m": "candles_1m",
  "5m": "candles_5m",
  "15m": "candles_15m",
  "1h": "candles_1h",
  "4h": "candles_4h",
  "1d": "candles_1d_utc",
};

export function getCandleTableForTf(tf: TimeFrame): string {
  return CANDLE_TABLE_BY_TF[tf] ?? "candles_1m";
}
import { FeatureDAG, globalDAG } from "./graph";
import { FeatureCache } from "./cache";
import { updateLifecycleForSymbol } from "../lifecycleUpdater";

export interface RunOptions {
  symbol: string;
  tf: TimeFrame;
  endTs: Date;
  requestedFeatures: string[];
  lookbackBars?: number;
  skipCache?: boolean;
  batchInserts?: boolean;
  batchSize?: number;
}

export class DAGRunner {
  private cache: FeatureCache;
  private tableColumnsCache = new Map<string, string[]>();
  private candlesCache = new Map<string, Candle[]>();
  private pendingInserts = new Map<string, Record<string, unknown>[]>();
  private defaultBatchSize = 1000;

  constructor(
    private pool: Pool,
    private dag: FeatureDAG = globalDAG
  ) {
    this.cache = new FeatureCache(pool);
  }

  async flush(): Promise<void> {
    for (const [tableName, rows] of this.pendingInserts) {
      if (rows.length === 0) continue;
      await this.insertRows(tableName, rows);
      rows.length = 0;
    }
  }

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

  async run(opts: RunOptions): Promise<FeatureOutputs> {
    this.candlesCache.clear();
    const sorted = this.dag.sort(opts.symbol, opts.tf, opts.requestedFeatures);
    if (opts.batchInserts) {
      await Promise.all(sorted.map((f) => this.getTableColumns(f.name)));
    }
    const results: FeatureOutputs = {};

    for (const feature of sorted) {
      const input = await this.buildInput(feature, opts, results);
      // Include symbol/tf/endTs in the input hash so context-sensitive features
      // (e.g. HTF bias) do not collide across symbols or timestamps.
      const inputHash = opts.skipCache
        ? `bulk:${opts.symbol}:${opts.tf}:${opts.endTs.toISOString()}`
        : `${feature.hashInput(input)}:${opts.symbol}:${opts.tf}:${opts.endTs.toISOString()}`;

      // Try cache unless disabled
      if (!opts.skipCache) {
        const cached = await this.cache.get(feature.name, inputHash);
        if (cached !== null) {
          results[feature.name] = cached;
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
        this.stage(feature, opts, output, inputHash);
        const rows = this.pendingInserts.get(feature.name);
        const batchSize = opts.batchSize ?? this.defaultBatchSize;
        if (rows && rows.length >= batchSize) {
          await this.insertRows(feature.name, rows);
          rows.length = 0;
        }
      } else {
        await this.persist(feature, opts, output, inputHash, outputHash);
      }
      if (!opts.skipCache) {
        await this.cache.set(feature.name, inputHash, outputHash);
      }

      results[feature.name] = output;

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
    try {
      await updateLifecycleForSymbol(this.pool, opts.symbol, {
        asOf: opts.endTs,
        lookbackDays: 10,
        limit: 10000,
      });
    } catch (err: any) {
      console.error(
        `[engine] Lifecycle refresh failed for ${opts.symbol}:`,
        err.message
      );
    }

    return results;
  }

  private async buildInput(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    results: FeatureOutputs
  ): Promise<Record<string, unknown>> {
    const input: Record<string, unknown> = {};

    // Add dependency outputs
    for (const dep of feature.dependencies) {
      input[dep] = results[dep];
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

    const table = getCandleTableForTf(tf);
    const { rows } = await this.pool.query(
      `SELECT symbol, ts, o, h, l, c, v
       FROM ${table}
       WHERE symbol = $1 AND ts <= $2
       ORDER BY ts DESC
       LIMIT $3`,
      [symbol, endTs, count]
    );

    const candles = rows
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
        })
      )
      .reverse();

    this.candlesCache.set(key, candles);
    return candles;
  }

  private buildRows(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    output: unknown,
    inputHash: string
  ): Record<string, unknown>[] {
    const rawRows = feature.serialize(output);
    if (rawRows.length === 0) return [];

    const tableName = feature.name;
    const tableColumns = this.tableColumnsCache.get(tableName);
    if (!tableColumns) return [];

    const rows: Record<string, unknown>[] = [];
    for (const rawRow of rawRows) {
      const row: Record<string, unknown> = {};
      for (const col of tableColumns) {
        if (col === "symbol") {
          row[col] = (rawRow as Record<string, unknown>).symbol ?? opts.symbol;
        } else if (col === "tf") {
          row[col] = (rawRow as Record<string, unknown>).tf ?? opts.tf;
        } else if (col === "ts") {
          const v = (rawRow as Record<string, unknown>).ts;
          row[col] = v instanceof Date ? v : opts.endTs;
        } else if (col === "engine_ver") {
          row[col] = feature.version;
        } else if (col === "input_hash") {
          row[col] = inputHash;
        } else {
          row[col] = (rawRow as Record<string, unknown>)[col];
        }
      }
      rows.push(row);
    }
    return rows;
  }

  private async insertRows(
    tableName: string,
    rows: Record<string, unknown>[]
  ): Promise<void> {
    if (rows.length === 0) return;
    const columns = Object.keys(rows[0]);
    const placeholders = rows
      .map(
        (_, i) =>
          `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(", ")})`
      )
      .join(", ");

    const values = rows.flatMap((row) => {
      return columns.map((col) => {
        const v = row[col];
        if (v instanceof Date) return v.toISOString();
        if (v === null || v === undefined) return null;
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
        return v;
      });
    });

    try {
      await this.pool.query(
        `INSERT INTO ${tableName} (${columns.join(", ")})
         VALUES ${placeholders}
         ON CONFLICT DO NOTHING`,
        values
      );
    } catch (err: any) {
      console.error(`[engine] Failed to persist ${tableName}:`, err.message);
    }
  }

  private stage(
    feature: FeatureDefinition<any, any>,
    opts: RunOptions,
    output: unknown,
    inputHash: string
  ): void {
    if (!this.tableColumnsCache.has(feature.name)) return;
    const rows = this.buildRows(feature, opts, output, inputHash);
    if (rows.length === 0) return;
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
    _outputHash: string
  ): Promise<void> {
    const tableName = feature.name;
    const tableColumns = await this.getTableColumns(tableName);
    const rows = this.buildRows(feature, opts, output, inputHash);
    await this.insertRows(tableName, rows);
  }
}
