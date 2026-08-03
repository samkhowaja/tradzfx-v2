/**
 * Strategy Compiler v2.
 * Uses "latest as of" semantics for multi-timeframe feature joining.
 * Cross-timeframe features are matched by symbol (not exact timestamp).
 */

import type { StrategySpec, StrategyCondition, TimeFrame, ProgressiveStep } from "@tm/shared";
import { TF_MS } from "@tm/shared";
import {
  buildEntryPriceSql,
  buildSlSql,
  buildTpSql,
} from "./riskCompiler";
import {
  buildFreshnessPredicate,
  buildLookbackInterval,
  buildLookbackIntervalForTf,
  buildPitLateral,
  buildOrbSessionScopedJoin,
  getDefaultFreshnessMinutes,
  getDefaultLookbackBars,
  getFeatureContract,
  isFvgZoneCondition,
} from "./sqlBuilder";

export interface CompileOptions {
  /** Compilation mode. */
  mode?: "live" | "pit";
  /** How far back to scan the bias anchor table in live mode (default 24h). */
  lookbackHours?: number;
  /** Backtest window start (PIT mode only). */
  from?: Date;
  /** Backtest window end (PIT mode only). */
  to?: Date;
  /** Restrict to a single symbol (PIT mode only). */
  symbol?: string;
  /**
   * When true, lifecycle freshness is checked against the stored
   * mitigated_at/invalidated_at columns instead of the expensive point-in-time
   * helper functions. Use this for live evaluation after lifecycle has been
   * refreshed; leave false for backtests.
   */
  trustStoredLifecycle?: boolean;
  /**
   * When true, return a query that reports stage counts (bias/setup/entry)
   * instead of the final signal SELECT. Used by the PIT backtest runner for
   * diagnostics and preflight.
   */
  debug?: boolean;
  /**
   * Data-clock anchor table. When set, time filters use MAX(ts) from this table
   * instead of NOW() so live evaluation sees the same data edge as backtest.
   * Typically "market.candles_1m_canonical".
   */
  dataClockTable?: string;
  /**
   * Parameter number containing an explicit evaluation timestamp. Replay uses
   * 3 for $3::timestamptz. Takes precedence over dataClockTable and NOW().
   */
  asOfParameter?: number;
  /**
   * Primary signal timeframe. Set by the backtester to enforce a one-bar fill
   * delay in market orders. When omitted, the signal tf is derived from the
   * spec's entry[0].tf or setup[0].tf.
   */
  signalTf?: TimeFrame;
}

export interface CompiledStrategy {
  spec: StrategySpec;
  sql: string;
  /** Parameters for the compiled SQL. Populated in PIT mode when symbol/from/to are supplied. */
  params?: unknown[];
  /** Table name for data-clock anchor. Empty string means no data-clock (use NOW()). */
  dataClockTable: string;
  /** Generate current-edge live-signal SQL. */
  latestSignalSQL: () => string;
  /** Generate historical signal SQL. $1=symbol, $2=TTL interval, $3=as-of. */
  signalAtSQL: () => string;
}

export class CompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompilerError";
  }
}

const QUARANTINED_FEATURES = new Set([
  "features_pivot", "features_structure", "features_sweep", "features_order_block",
  "features_bias", "features_direction_state", "features_zone_retest", "features_ifvg",
  "features_pricing", "features_push_pull", "features_liquidity_event_v2",
]);

const CLEAN_FEATURES = new Set([
  "features_atr", "features_session", "features_spread", "features_zone",
  "features_displacement", "features_moving_average", "features_candle_pattern",
]);

export function extractContaminatedFeatures(spec: StrategySpec): string[] {
  const conditions = [
    ...(spec.setup ?? []),
    ...(spec.entry ?? []),
    ...(spec.steps ?? []),
    ...(spec.progressiveSteps ?? []),
  ] as Array<{ feature?: string }>;
  return [...new Set(conditions
    .map((condition) => condition.feature)
    .filter((feature): feature is string => typeof feature === "string")
    .filter((feature) => QUARANTINED_FEATURES.has(feature) || !CLEAN_FEATURES.has(feature)))].sort();
}

function enforceFeatureContract(spec: StrategySpec): void {
  if (spec.featureContract !== "CLEAN_2026_07") return;
  const contaminated = extractContaminatedFeatures(spec);
  if (contaminated.length > 0) {
    throw new CompilerError(
      `CLEAN_2026_07 spec "${spec.name}" references contaminated features: ${contaminated.join(", ")}`
    );
  }
}

function validateTimeWindow(w: { utcStart: string; utcEnd: string }): { startMin: number; endMin: number } {
  const TIME_WINDOW_RE = /^\d{2}:\d{2}$/;
  if (!w || typeof w.utcStart !== "string" || typeof w.utcEnd !== "string") {
    throw new Error("Time window must have utcStart and utcEnd strings");
  }
  if (!TIME_WINDOW_RE.test(w.utcStart) || !TIME_WINDOW_RE.test(w.utcEnd)) {
    throw new Error(`Time window must match HH:MM, got ${w.utcStart}-${w.utcEnd}`);
  }
  const [sh, sm] = w.utcStart.split(":").map(Number);
  const [eh, em] = w.utcEnd.split(":").map(Number);
  if (sh < 0 || sh > 23 || eh < 0 || eh > 23) {
    throw new Error("Time window hours out of range");
  }
  if (sm < 0 || sm > 59 || em < 0 || em > 59) {
    throw new Error("Time window minutes out of range");
  }
  return { startMin: sh * 60 + sm, endMin: eh * 60 + em };
}

function timeWindowsToSql(spec: StrategySpec): string {
  const windows = spec.filters?.timeWindows ?? (spec.filters?.timeWindow ? [spec.filters.timeWindow] : []);
  if (!windows || windows.length === 0) return "";
  const clauses = windows.map((w) => {
    const { startMin, endMin } = validateTimeWindow(w);
    return `EXTRACT(HOUR FROM ts) * 60 + EXTRACT(MINUTE FROM ts) BETWEEN ${startMin} AND ${endMin}`;
  });
  return "  AND (" + clauses.join("\n    OR ") + ")";
}

/**
 * Extract simple column-equality filters from a predicate string so they can be
 * pushed into the latest_* CTE WHERE clause. This avoids scanning/sorting rows
 * that will be discarded by the predicate (e.g. `ma_type = 'sma' AND period = 15`).
 * Only literal right-hand sides are supported: numbers, single-quoted strings,
 * and boolean literals.
 */
function extractEqualityPushdowns(predicate: string): Array<{ column: string; literal: string }> {
  const filters: Array<{ column: string; literal: string }> = [];
  const seen = new Map<string, string>();
  // Match unqualified column = literal. The negative lookbehind skips identifiers
  // that are prefixed with a dot (e.g. features_bias.direction = ...), because
  // those belong to a different table and should not be pushed into this feature's
  // CTE. Literals can be strings, numbers, or booleans.
  const re = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?|true|false)(?=\s|$|\)|,|AND|OR|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(predicate)) !== null) {
    const column = m[1].toLowerCase();
    // Preserve case for string literals (e.g. 'DXY', 'NY') — only lowercase
    // numeric and boolean literals. String case matters in SQL equality.
    const literal = m[2].startsWith("'") ? m[2] : m[2].toLowerCase();
    if (!seen.has(column)) {
      seen.set(column, literal);
    } else if (seen.get(column) !== literal) {
      // Conflicting literals for the same column (e.g. direction = 'bullish' OR
      // direction = 'bearish'). Do not push this column down; the predicate logic
      // will handle it in the JOIN/WHERE clause.
      seen.set(column, "__CONFLICT__");
    }
  }
  for (const [column, literal] of seen.entries()) {
    if (literal !== "__CONFLICT__") {
      filters.push({ column, literal });
    }
  }
  return filters;
}


/**
 * Derive the effective signal timeframe from a strategy spec.
 *
 * Single source of truth for determining the primary evaluation TF.
 * Used by the backtester to enforce the one-bar fill delay (#3) and by
 * the compiler for data-clock resolution.
 *
 * Logic (priority order):
 *   1. Explicit signalTf in CompileOptions (set by the backtester)
 *   2. entry[0]?.tf — the first entry condition's timeframe
 *   3. steps ? steps[0]?.tf — the root progressive step's timeframe
 *   4. setup[0]?.tf — the first flat setup condition's timeframe
 *   5. Fallback: "15m"
 */
export function deriveSignalTf(spec: StrategySpec, opts?: CompileOptions): TimeFrame {
  if (opts?.signalTf) return opts.signalTf;
  if (spec.entry?.[0]?.tf) return spec.entry[0].tf as TimeFrame;
  if (spec.steps?.length && spec.steps[0].tf) return spec.steps[0].tf as TimeFrame;
  if (spec.setup?.length && spec.setup[0].tf) return spec.setup[0].tf as TimeFrame;
  return "15m";
}

/** Compile a strategy spec to SQL */
export function compileStrategy(spec: StrategySpec, opts: CompileOptions = {}): CompiledStrategy {
  enforceFeatureContract(spec);
  const dataClockTable = opts.dataClockTable ?? "";
  // Internal wave needs event chronology and structural risk geometry that the
  // independent-condition compiler cannot represent without temporal leakage.
  const sql = spec.signalSource === "internal_wave"
    ? compileInternalWaveSQL(spec, opts)
    : spec.steps?.length
      ? compileProgressiveSQL(spec, opts)
      : compileFullSQL(spec, opts);

  /**
   * Generate the live-signal SQL with parameterized placeholders.
   *   $1 = symbol
   *   $2 = signalTtlMinutes (interval)
   * Caller MUST pass [symbol, signalTtlMinutes] as query params.
   * This eliminates the SQL injection vector from string interpolation.
   *
   * When dataClockTable is set, wraps WITH data_clock AS (SELECT MAX(ts) FROM <table>)
   * so the outer filter uses data edge instead of NOW(). The inner sql already
   * references data_clock in its time filter subqueries.
   */
  const latestSignalSQL = () => {
    const maxAgeMin = spec.live?.signalTtlMinutes ?? 15;
    if (dataClockTable) {
      return `
WITH data_clock AS (
  SELECT MAX(ts) AS max_ts FROM ${dataClockTable}
),
signals AS (
${indent(sql, 2)}
)
SELECT *, '${spec.id}' as strategy_id
FROM signals
WHERE symbol = $1
  AND ts >= (SELECT max_ts FROM data_clock) - $2::interval
ORDER BY ts DESC
LIMIT 1
`;
    }
    return `
WITH signals AS (
${indent(sql, 2)}
)
SELECT *, '${spec.id}' as strategy_id
FROM signals
WHERE symbol = $1
  AND ts >= NOW() - $2::interval
ORDER BY ts DESC
LIMIT 1
`;
  };

  const signalAtSQL = () => buildSignalAtSQL(sql, spec.id);

  return { spec, sql, dataClockTable, latestSignalSQL, signalAtSQL };
}

function buildSignalAtSQL(sql: string, strategyId: string): string {
  return `
WITH signals AS (
${indent(sql, 2)}
)
SELECT *, '${strategyId}' as strategy_id
FROM signals
WHERE symbol = $1
  AND ts <= $3::timestamptz
  AND ts >= $3::timestamptz - $2::interval
ORDER BY ts DESC
LIMIT 1
`;
}

function buildLatestSignalSQL(sql: string, strategyId: string, signalTtlMinutes?: number, dataClockTable?: string): () => string {
  return () => {
    const maxAgeMin = signalTtlMinutes ?? 15;
    if (dataClockTable) {
      return `
WITH data_clock AS (
  SELECT MAX(ts) AS max_ts FROM ${dataClockTable}
),
signals AS (
${indent(sql, 2)}
)
SELECT *, '${strategyId}' as strategy_id
FROM signals
WHERE symbol = $1
  AND ts >= (SELECT max_ts FROM data_clock) - $2::interval
ORDER BY ts DESC
LIMIT 1
`;
    }
    return `
WITH signals AS (
${indent(sql, 2)}
)
SELECT *, '${strategyId}' as strategy_id
FROM signals
WHERE symbol = $1
  AND ts >= NOW() - $2::interval
ORDER BY ts DESC
LIMIT 1
`;
  };
}

/**
 * Reconstruct a CompiledStrategy from a cached spec and its pre-computed SQL.
 * This avoids re-running the compiler when loading a strategy from Redis.
 */
export function restoreCompiledStrategy(spec: StrategySpec, sql: string, dataClockTable?: string): CompiledStrategy {
  const dct = dataClockTable ?? "";
  return {
    spec,
    sql,
    dataClockTable: dct,
    latestSignalSQL: buildLatestSignalSQL(sql, spec.id, spec.live?.signalTtlMinutes, dct || undefined),
    signalAtSQL: () => buildSignalAtSQL(sql, spec.id),
  };
}

/**
 * Remove a raw `is_fresh = true|false` conjunct from a translated predicate.
 *
 * `is_fresh` is a mutable current-state flag: correct for live evaluation but a
 * look-ahead / survivorship leak in point-in-time backtests. In PIT mode the
 * compiler relies on the as-of lifecycle window emitted by buildFreshnessPredicate
 * instead, so the raw flag must be stripped. Handles an optional qualified alias
 * (`pit_x.is_fresh`, `b.is_fresh`) in leading, trailing, or standalone position.
 */
function stripIsFresh(pred: string): string {
  return pred
    .replace(/\s+AND\s+(?:[A-Za-z_]\w*\.)?is_fresh\s*=\s*(?:true|false)\b/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?is_fresh\s*=\s*(?:true|false)\s+AND\s+/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?is_fresh\s*=\s*(?:true|false)\b/gi, "1=1")
    .replace(/\(\s*\)/g, "(1=1)")
    .trim();
}

/**
 * Remove wall-clock lifecycle-derived attributes from a translated predicate
 * in PIT mode.
 *
 * `fill_pct` and `tapped` are stored columns that the SQL lifecycle functions
 * update as-of wall-clock time. Reading them in a PIT backtest leaks future
 * state (touches that occurred after the anchor timestamp). In PIT mode the
 * compiler relies on the as-of lifecycle window (buildFreshnessPredicate) for
 * validity, so these mutable attrs must be stripped. Handles qualified aliases
 * (`pit_x.fill_pct`, `b.tapped`) in leading, trailing, or standalone position.
 *
 * Supported forms:
 *   fill_pct <op> <value>
 *   fill_pct <op> <value>
 *   tapped = true|false
 *   tapped
 */
function stripLifecycleAttrs(pred: string): string {
  // Remove fill_pct comparisons: fill_pct < 0.8, fill_pct >= 0.5, fill_pct > 0, etc.
  let result = pred
    .replace(/\s+AND\s+(?:[A-Za-z_]\w*\.)?fill_pct\s*[<>=!]+\s*[0-9.]+/gi, "")
    .replace(/(?:[A-Za-z_]\w*\.)?fill_pct\s*[<>=!]+\s*[0-9.]+\s+AND\s+/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?fill_pct\s*[<>=!]+\s*[0-9.]+\b/gi, "1=1")
    // Remove tapped = true|false comparisons
    .replace(/\s+AND\s+(?:[A-Za-z_]\w*\.)?tapped\s*=\s*(?:true|false)\b/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?tapped\s*=\s*(?:true|false)\s+AND\s+/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?tapped\s*=\s*(?:true|false)\b/gi, "1=1")
    // Remove bare tapped (used as a boolean without comparison)
    .replace(/\s+AND\s+(?:[A-Za-z_]\w*\.)?tapped\b/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?tapped\s+AND\s+/gi, "")
    .replace(/\b(?:[A-Za-z_]\w*\.)?tapped\b/gi, "1=1")
    .replace(/\(\s*\)/g, "(1=1)")
    .trim();

  // Clean up duplicated 1=1 AND 1=1 patterns from multiple replacements
  result = result.replace(/1=1\s+AND\s+1=1/gi, "1=1");
  return result;
}

/**
 * Strip ALL wall-clock leaks from a translated predicate for PIT mode.
 * Combines stripIsFresh (is_fresh) and stripLifecycleAttrs (fill_pct, tapped)
 * so every PIT predicate call site applies both.
 */
function stripPitLeaks(pred: string): string {
  return stripLifecycleAttrs(stripIsFresh(pred));
}

/**
 * Topological sort of steps[] by dependsOn. Returns IDs in execution order.
 * Root steps (no dependsOn) first, then their children. Throws on cycle.
 */
export function topologicalSort(steps: ProgressiveStep[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const adj = new Map<string, string[]>();
  for (const s of steps) adj.set(s.id, s.dependsOn ?? []);

  function dfs(id: string, path: Set<string>) {
    if (path.has(id)) throw new Error(`Cycle detected: ${id} in ${[...path].join("->")}`);
    if (visited.has(id)) return;
    path.add(id);
    for (const dep of adj.get(id) ?? []) dfs(dep, path);
    path.delete(id);
    visited.add(id);
    result.push(id);
  }

  for (const s of steps) {
    if (!visited.has(s.id)) dfs(s.id, new Set());
  }
  return result;
}

/** Bias-producing features (shared by the flat and progressive compilers). */
const BIAS_FEATURES = ["features_bias", "features_htf_bias", "features_direction_state"];

/** Features that emit a direction column usable for signal-side derivation. */
const FEATURES_WITH_DIRECTION = new Set([
  ...BIAS_FEATURES,
  "features_push_pull",
  "features_candle_pattern",
  "features_zone",
  "features_ifvg",
  "features_order_block",
  "features_sweep",
  "features_structure",
  "features_displacement",
]);

/**
 * Compile a progressive spec (with steps[]) into sequential CTE SQL.
 * Each step becomes a CTE: root step scans its feature table, child steps
 * join the parent CTE via LATERAL. Entry conditions sequence after all steps.
 * The final signal SELECT is delegated to buildSignalSelect().
 */
function compileProgressiveSQL(spec: StrategySpec, opts: CompileOptions = {}): string {
  const mode = opts.mode ?? "live";
  const lookbackHours = opts.lookbackHours ?? 24;
  const steps = spec.steps!;
  const entryConds = spec.entry.filter((c) => c.required);

  // Topological order
  const order = topologicalSort(steps);
  const stepMap = new Map(steps.map((s) => [s.id, s]));

  // Symbol + time filter segment
  const symbolFilter = opts.symbol ? `AND symbol = '${opts.symbol}'` : "";
  const timeFilter =
    mode === "pit" && opts.from && opts.to
      ? `AND ts >= '${opts.from.toISOString()}'::timestamptz AND ts <= '${opts.to.toISOString()}'::timestamptz`
      : opts.asOfParameter
        ? `AND ts <= $${opts.asOfParameter}::timestamptz AND ts >= $${opts.asOfParameter}::timestamptz - INTERVAL '${lookbackHours} hours'`
        : opts.dataClockTable
          ? `AND ts >= (SELECT MAX(ts) FROM ${opts.dataClockTable}) - INTERVAL '${lookbackHours} hours'`
          : `AND ts >= NOW() - INTERVAL '${lookbackHours} hours'`;
  const timeWindowFilter = timeWindowsToSql(spec);

  // Track alias for each step after compilation
  const stepAliases = new Map<string, string>();

  // The root step (no dependsOn) is the directional anchor. In the progressive
  // path there is no flat-compiler `b`/`s` bias alias, so `features_bias.direction`
  // must resolve to the root step's CTE column (e.g. st_htf_direction.direction).
  const rootStep = steps.find((s) => !s.dependsOn || s.dependsOn.length === 0);
  const biasAlias = rootStep ? `st_${rootStep.id}` : "b";
  const biasAliases = { features_bias: biasAlias, features_htf_bias: biasAlias };

  // Build CTEs in dependency order
  const ctes: string[] = [];
  const stepIds = new Set(steps.map((s) => s.id));

  for (const id of order) {
    const step = stepMap.get(id)!;
    const alias = `st_${id}`;
    stepAliases.set(id, alias);

    const parentIds = step.dependsOn ?? [];
    const isRoot = parentIds.length === 0;

    if (isRoot) {
      // Root step: FROM feature table directly
      const cols = buildStepSelectColumns(step);
      // Apply the FULL root predicate — the audit found that only equality
      // pushdowns were emitted, silently dropping non-equality filters such
      // as `direction != 'neutral'` or `regime = 'trending'`.
      // We keep the equality pushdowns (for index usage) AND add the full
      // predicate as an AND clause. Bare column names resolve correctly
      // because the FROM clause has only one table.
      let rootPredicateSql = "";
      if (step.predicate) {
        let pred = step.predicate.trim();
        if (mode === "pit") pred = stripPitLeaks(pred);
        rootPredicateSql = `\n    AND (${pred})`;
      }

      ctes.push(`${alias} AS (
  SELECT
    symbol, ts, direction${cols}${timeWindowFilter}
  FROM ${step.feature}
  WHERE tf = '${step.tf}'
    ${timeFilter}
    ${symbolFilter}${rootPredicateSql}
  ORDER BY symbol, ts DESC
)`);
    } else {
      // Child step: FROM parent CTE + LATERAL for this step's feature
      // parentId determines which CTE to anchor to
      const parentAlias = stepAliases.get(parentIds[0]);
      if (!parentAlias) throw new Error(`Step '${id}': parent '${parentIds[0]}' not yet compiled`);

      // Build LATERAL using buildPitLateral for registry-correct behavior
      const lateral = buildProgressivePitLateral(step, id, parentAlias, spec, mode);
      // Bias resolves to the PARENT step CTE (which carries the inherited
      // direction column), not the root — only the root CTE is in scope here.
      const stepBiasAliases = { features_bias: parentAlias, features_htf_bias: parentAlias };
      const pred = mode === "pit" ? stripPitLeaks(translatePredicate(step.predicate, `pit_${id}`, "setup", stepBiasAliases)) : translatePredicate(step.predicate, `pit_${id}`, "setup", stepBiasAliases);
      const freshness = buildFreshnessPredicate(step as any, `pit_${id}`, `${parentAlias}.ts`);

      // Direction auto-alignment: inherit direction from parent unless disabled
      const parentStep = stepMap.get(parentIds[0])!;
      const alignDir = step.autoAlignDirection !== false;
      const directionFilter = alignDir
        ? `\n    AND pit_${id}.direction = ${parentAlias}.direction`
        : "";

      // TTL filter (forward: child after parent, backward: child before parent)
      const ttlFilter = step.ttlMinutes
        ? step.ttlDirection === "forward"
          ? `\n    AND pit_${id}.ts <= ${parentAlias}.ts + INTERVAL '${step.ttlMinutes} minutes'`
          : `\n    AND pit_${id}.ts >= ${parentAlias}.ts - INTERVAL '${step.ttlMinutes} minutes'`
        : "";

      ctes.push(`${alias} AS (
  SELECT DISTINCT ON (${parentAlias}.symbol, ${parentAlias}.ts)
    ${parentAlias}.symbol,
    ${parentAlias}.ts,
    ${parentAlias}.direction,
    pit_${id}.ts AS ${id}_ts
  FROM ${parentAlias},
  ${lateral}
  WHERE (${pred} ${freshness})${directionFilter}${ttlFilter}
  ORDER BY ${parentAlias}.symbol, ${parentAlias}.ts
)`);
    }
  }

  // Entry conditions: anchored to last step
  const lastStepId = order[order.length - 1];
  const lastAlias = stepAliases.get(lastStepId)!;
  const entryLaterals = entryConds.map((cond) => buildPitLateral(cond, cond.id, lastAlias, spec, mode));
  // Entry is anchored to the last step CTE (lastAlias), which carries direction.
  const entryBiasAliases = { features_bias: lastAlias, features_htf_bias: lastAlias, __anchor: lastAlias };
  const entryWheres = entryConds.map((cond) => {
    const tableRef = `pit_${cond.id}`;
    const predRaw = translatePredicate(cond.predicate, tableRef, "entry", entryBiasAliases);
    const pred = mode === "pit" ? stripPitLeaks(predRaw) : predRaw;
    const freshness = buildFreshnessPredicate(cond, tableRef, `${lastAlias}.ts`);
    return `(${pred} ${freshness})`;
  });

  // Add freshness tolerance for structure events in progressive mode (same as
  // the flat compiler below — structure events > structureFreshnessMinutes
  // before the anchor are stale and should not trigger entries).
  // SKIP for forward TTL: the spec's ttlMinutes already bounds the window
  // and applying structureFreshnessMinutes creates a stricter MIN(ttl, freshness)
  // that destroys valid forward-looking signals (e.g. 30m cap on 120m TTL).
  const progressiveStructureFreshnessMin = spec.live?.structureFreshnessMinutes ?? 30;
  if (progressiveStructureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond && structureCond.ttlDirection !== "forward") {
      entryWheres.push(
        `(pit_${structureCond.id}.ts >= ${lastAlias}.ts - interval '${progressiveStructureFreshnessMin} minutes')`
      );
    }
  }

  // signal_direction projection for the progressive entry CTE — mirrors the flat
  // compiler (line ~748): the shared SL/TP/side builders reference
  // COALESCE(e.signal_direction, e.bias_direction), so entry_signals must always
  // project the column. For generic signalSource, take the direction from the
  // first entry condition whose feature has one (pit_<id> is in scope here);
  // otherwise NULL so the COALESCE falls back to bias_direction.
  const progressiveSignalDirectionCond = (spec.signalSource ?? "zone") === "generic"
    ? entryConds.find((c) => FEATURES_WITH_DIRECTION.has(c.feature))
    : null;
  const progressiveSignalDirectionProjection = progressiveSignalDirectionCond
    ? `, pit_${progressiveSignalDirectionCond.id}.direction as signal_direction`
    : ", NULL::text as signal_direction";
  const progressiveLineageItems = entryConds.map((cond) =>
    `jsonb_build_object('conditionId', '${cond.id}', 'feature', '${cond.feature}', 'tf', '${cond.tf}', 'row', to_jsonb(pit_${cond.id}))`
  );
  const progressiveLineageProjection = progressiveLineageItems.length
    ? `, jsonb_build_array(${progressiveLineageItems.join(", ")}) as causal_lineage`
    : ", '[]'::jsonb as causal_lineage";

  const progressiveResolvedDirection = progressiveSignalDirectionCond
    ? `COALESCE(pit_${progressiveSignalDirectionCond.id}.direction, ${lastAlias}.direction)`
    : `${lastAlias}.direction`;
  const entrySection = entryLaterals.length
    ? `
SELECT DISTINCT ON (${lastAlias}.symbol, ${lastAlias}.ts) ${lastAlias}.symbol, ${lastAlias}.ts, ${lastAlias}.direction as bias_direction${progressiveSignalDirectionProjection}, ${progressiveResolvedDirection} as resolved_direction${progressiveLineageProjection}
FROM ${lastAlias}${entryLaterals.length ? "\n," + entryLaterals.join(",\n") : ""}${entryWheres.length > 0 ? `
WHERE ${entryWheres.join("\n  AND ")}` : ""}`
    : `
SELECT DISTINCT ON (${lastAlias}.symbol, ${lastAlias}.ts) ${lastAlias}.symbol, ${lastAlias}.ts, direction as bias_direction${progressiveSignalDirectionProjection}, ${progressiveResolvedDirection} as resolved_direction${progressiveLineageProjection} FROM ${lastAlias}`;

  // Signal SELECT — same as flat compiler, reads from entry_signals
  const tfMap = resolveTimeframes(spec);
  const signalSource = spec.signalSource ?? "zone";
  const rawSignalSql = buildSignalSelect(spec, signalSource, {
    pricingTf: tfMap.pricing ?? "15m",
    zoneTf: tfMap.zone ?? "15m",
    atrTfs: tfMap.atrTfs ?? ["15m"],
    orbTf: tfMap.orb ?? "15m",
    indicatorTf: tfMap.indicator ?? "1h",
    movingAverageTf: tfMap.movingAverage ?? "1h",
    bollingerTf: tfMap.bollinger ?? "15m",
    keltnerTf: tfMap.keltner ?? "15m",
    ifvgTf: tfMap.ifvg ?? "15m",
    fvgTf: tfMap.fvg ?? "5m",
    signalTable: "entry_signals",
  });
  const signalSql = bindAtrReferences(rawSignalSql, tfMap.atrTfs);

  return `
WITH
${ctes.join(",\n")},
entry_signals AS (
${indent(entrySection, 2)}
)
${signalSql}
`;
}

/**
 * Build SELECT columns for a root progressive step beyond symbol/ts/direction.
 * Pulls registry columns if needed.
 */
function buildStepSelectColumns(step: ProgressiveStep): string {
  const cols: string[] = [];
  // Add registry-relevant columns from the feature's contract
  // For now, keep minimal — direction + ts + symbol is enough for step chaining
  return cols.length ? `, ${cols.join(", ")}` : "";
}

/**
 * Build a LATERAL subquery for a progressive child step, similar to buildPitLateral
 * but accepting any asOfRef alias and using ProgressiveStep fields.
 */
function buildProgressivePitLateral(
  step: ProgressiveStep,
  alias: string,
  asOfRef: string,
  spec?: StrategySpec,
  mode?: "live" | "pit"
): string {
  const contract = getFeatureContract(step.feature);
  const groupCols = step.groupBy ?? contract?.equalityGroupByDefaults ?? [];
  const distinctOn = ["symbol", ...groupCols].join(", ");
  let rawPushdowns = extractEqualityPushdowns(step.predicate);
  // In PIT mode, strip is_fresh, fill_pct, and tapped equality pushdowns
  // (same as flat compiler's stripPitLeaks) — these are wall-clock tainted
  // lifecycle columns that would leak future state in the DISTINCT ON sort.
  if (mode === "pit") {
    rawPushdowns = rawPushdowns.filter(
      (f) => f.column !== "is_fresh" && f.column !== "fill_pct" && f.column !== "tapped"
    );
  }
  const pushdownSql = rawPushdowns.length
    ? "\n      " + rawPushdowns.map((f) => `AND ${f.column} = ${f.literal}`).join("\n      ")
    : "";
  const isForward = step.ttlDirection === "forward";
  const tieBreaker = contract?.tieBreaker ?? (isForward ? "ts ASC" : "ts DESC");
  const orderBy = tieBreaker ? `ORDER BY ${distinctOn}, ${tieBreaker}` : `ORDER BY ${distinctOn}, ts DESC`;

  // Build policy WHERE using registry. When a step has a ttlMinutes, the LATERAL
  // must constrain its lower bound to the TTL window (not just the registry
  // lookback) so DISTINCT ON ... ts DESC picks the latest row WITHIN the TTL.
  // Otherwise the LATERAL selects the latest row across the full lookback, which
  // the subsequent TTL WHERE then drops — yielding zero rows.
  const lookback = buildLookbackInterval(step as any, spec);
  // lookback is a string like "61 hours"; convert to minutes for comparison.
  const lookbackMinutes = (() => {
    const m = /(\d+)\s*(hour|minute|hr|min)/i.exec(lookback);
    if (!m) return Infinity;
    return parseInt(m[1], 10) * (m[2].toLowerCase().startsWith("h") ? 60 : 1);
  })();
  const effectiveLookback = step.ttlMinutes && step.ttlMinutes < lookbackMinutes ? `${step.ttlMinutes} minutes` : lookback;
  const policyWhere = isForward
    ? `
      AND ${step.feature}.ts >= ${asOfRef}.ts
      AND ${step.feature}.ts <= ${asOfRef}.ts + INTERVAL '${effectiveLookback}'`
    : `
      AND ${step.feature}.ts <= ${asOfRef}.ts
      AND ${step.feature}.ts >= ${asOfRef}.ts - INTERVAL '${effectiveLookback}'`;

  // Freshness predicate (convert step to match buildFreshnessPredicate's StrategyCondition shape)
  const freshnessSql = buildFreshnessPredicate(
    { ...step, ignoreLifecycle: step.ignoreLifecycle } as any,
    step.feature,
    `${asOfRef}.ts`
  );

  return `LATERAL (
    SELECT DISTINCT ON (${distinctOn}) *
    FROM ${step.feature}
    WHERE symbol = ${asOfRef}.symbol
      AND tf = '${step.tf}'${policyWhere}${pushdownSql}
      ${freshnessSql}
    ${orderBy}
  ) AS pit_${alias}`;
}

function compileFullSQL(spec: StrategySpec, opts: CompileOptions = {}): string {
  const mode = opts.mode ?? "live";
  const lookbackHours = opts.lookbackHours ?? 24;
  const setupConds = spec.setup.filter((c) => c.required);
  const entryConds = spec.entry.filter((c) => c.required);

  // Bias anchor: the first bias/htf_bias condition drives the setup_candidates ts.
  // Additional bias/htf_bias conditions are joined as point-in-time LATERALs so
  // strategies can require multi-timeframe confluence (e.g. local 15m bias agrees
  // with 1h HTF bias).
  const biasCond = spec.setup.find((c) => BIAS_FEATURES.includes(c.feature));
  const biasTf = biasCond?.tf ?? "15m";
  const biasTable = biasCond?.feature ?? "features_bias";

  const biasAliasMap: Record<string, string> = {};
  for (const cond of setupConds) {
    if (BIAS_FEATURES.includes(cond.feature)) {
      biasAliasMap[cond.feature] = cond === biasCond ? "b" : `pit_${cond.id}`;
    }
  }

  // Point-in-time setup feature lookups (anchor bias is the FROM table, all others
  // including extra bias/htf_bias timeframes get their own LATERAL).
  const setupLaterals = setupConds
    .filter((c) => c !== biasCond)
    .map((cond) => buildPitLateral(cond, cond.id, "b", spec, mode));

  // Build setup WHERE: anchor bias uses 'b', all others use 'pit_*'
  const setupWheres = setupConds.map((cond) => {
    const tableRef = cond === biasCond ? "b" : `pit_${cond.id}`;
    const predRaw = translatePredicate(cond.predicate, tableRef, "setup", biasAliasMap);
    const pred = mode === "pit" ? stripPitLeaks(predRaw) : predRaw;
    const freshness = buildFreshnessPredicate(cond, tableRef, "b.ts");
    return `(${pred} ${freshness})`;
  });

  // Point-in-time entry feature lookups
  const entryLaterals = entryConds.map((cond) => buildPitLateral(cond, cond.id, "s", spec, mode));

  // Build entry WHERE
  const entryWheres = entryConds.map((cond) => {
    const tableRef = `pit_${cond.id}`;
    const predRaw = translatePredicate(cond.predicate, tableRef, "entry", { __anchor: "s" });
    const pred = mode === "pit" ? stripPitLeaks(predRaw) : predRaw;
    const freshness = buildFreshnessPredicate(cond, tableRef, "s.ts");
    return `(${pred} ${freshness})`;
  });

  // Add freshness tolerance for structure events (within last N minutes).
  // SKIP for forward TTL: the spec's ttlMinutes already bounds the window
  // and structureFreshnessMinutes would create a strict MIN(ttl, freshness)
  // that destroys valid forward-looking signals.
  const structureFreshnessMin = spec.live?.structureFreshnessMinutes ?? 30;
  if (structureFreshnessMin > 0) {
    const structureCond = entryConds.find((c) => c.feature === "features_structure");
    if (structureCond && structureCond.ttlDirection !== "forward") {
      entryWheres.push(
        `(pit_${structureCond.id}.ts >= s.ts - interval '${structureFreshnessMin} minutes')`
      );
    }
  }

  const setupLateralSection = setupLaterals.length ? ",\n" + setupLaterals.join(",\n") : "";
  const entryLateralSection = entryLaterals.length ? ",\n" + entryLaterals.join(",\n") : "";

  const symbolFilter = opts.symbol ? `AND symbol = '${opts.symbol}'` : "";
  const timeFilter =
    mode === "pit" && opts.from && opts.to
      ? `AND ts >= '${opts.from.toISOString()}'::timestamptz AND ts <= '${opts.to.toISOString()}'::timestamptz`
      : opts.asOfParameter
        ? `AND ts <= $${opts.asOfParameter}::timestamptz AND ts >= $${opts.asOfParameter}::timestamptz - INTERVAL '${lookbackHours} hours'`
        : opts.dataClockTable
          ? `AND ts >= (SELECT MAX(ts) FROM ${opts.dataClockTable}) - INTERVAL '${lookbackHours} hours'`
          : `AND ts >= NOW() - INTERVAL '${lookbackHours} hours'`;

  const timeWindowFilter = timeWindowsToSql(spec);

  const signalSource = spec.signalSource ?? "zone";

  // Project the columns the anchor table actually has, so `regime`/`state`
  // predicates on the anchor resolve (and the bare-`state` latent bug, SK-30,
  // is closed). features_direction_state has regime + htf_state; features_bias
  // has regime; features_htf_bias has state.
  const biasExtraCols: string[] = [];
  if (biasTable === "features_direction_state" || biasTable === "features_bias") biasExtraCols.push("regime");
  if (biasTable === "features_htf_bias") biasExtraCols.push("state");
  const biasExtraSelect = biasExtraCols.length ? `, ${biasExtraCols.join(", ")}` : "";
  const biasSection = `
SELECT symbol, ts, direction${biasExtraSelect}
FROM ${biasTable}
WHERE tf = '${biasTf}'
  ${timeFilter}
  ${symbolFilter}
  ${timeWindowFilter}`;

  // features_direction_state stores direction as 'buy'/'sell'; the signal
  // select's side CASE expects 'bullish'/'bearish'. Normalize when the bias
  // anchor is direction_state so side resolves correctly.
  const biasDirectionExpr =
    biasTable === "features_direction_state"
      ? `CASE WHEN b.direction IN ('buy', 'bullish') THEN 'bullish' WHEN b.direction IN ('sell', 'bearish') THEN 'bearish' ELSE NULL END`
      : `b.direction`;
  const biasDirectionProjection = `${biasDirectionExpr} as bias_direction`;

  // For generic signal source, project the direction from the first non-bias
  // setup condition that emits a direction column (e.g. features_push_pull)
  // so buildGenericSignalSelect can derive trade side from the pattern, not
  // from (often-neutral) daily bias.
  const signalDirectionCond = signalSource === "generic"
    ? setupConds.find((c) => c !== biasCond && FEATURES_WITH_DIRECTION.has(c.feature))
    : null;
  const signalDirectionProjection = signalDirectionCond
    ? `, pit_${signalDirectionCond.id}.direction as signal_direction`
    : ", NULL::text as signal_direction";

  // Preserve exact PIT-selected feature rows. to_jsonb(record) avoids assuming a
  // shared primary-key shape across heterogeneous feature tables and carries
  // producer metadata (engine_ver/input_hash) whenever the source row has it.
  const conditionLineage = (cond: StrategyCondition, alias: string) =>
    `jsonb_build_object('conditionId', '${cond.id}', 'feature', '${cond.feature}', 'tf', '${cond.tf}', 'row', to_jsonb(${alias}))`;
  const setupLineageItems = setupConds.map((cond) =>
    conditionLineage(cond, cond === biasCond ? "b" : `pit_${cond.id}`)
  );
  const setupLineageProjection = setupLineageItems.length
    ? `, jsonb_build_array(${setupLineageItems.join(", ")}) as causal_lineage`
    : ", '[]'::jsonb as causal_lineage";
  const entryLineageItems = entryConds.map((cond) => conditionLineage(cond, `pit_${cond.id}`));
  const entryLineageProjection = entryLineageItems.length
    ? `, s.causal_lineage || jsonb_build_array(${entryLineageItems.join(", ")}) as causal_lineage`
    : ", s.causal_lineage";

  const setupSection = `
SELECT b.symbol, b.ts, ${biasDirectionProjection}${signalDirectionProjection}, COALESCE(${signalDirectionCond ? `pit_${signalDirectionCond.id}.direction` : "NULL::text"}, ${biasDirectionExpr}) as resolved_direction${setupLineageProjection}
FROM bias_candidates b${setupLateralSection}
WHERE ${setupWheres.join("\n  AND ")}`;

  const entrySection = `
SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction${signalDirectionProjection ? ", s.signal_direction" : ""}, COALESCE(s.signal_direction, s.bias_direction) as resolved_direction${entryLineageProjection}
FROM setup_candidates s${entryLateralSection}${entryWheres.length > 0 ? `
WHERE ${entryWheres.join("\n  AND ")}` : ""}`;

  // Resolve timeframes for pricing, zone, atr in final SELECT
  const tfMap = resolveTimeframes(spec);
  const pricingTf = tfMap.pricing ?? "15m";
  const zoneTf = tfMap.zone ?? "15m";
  const atrTfs = tfMap.atrTfs ?? ["15m"];
  const orbTf = tfMap.orb ?? "15m";
  const indicatorTf = tfMap.indicator ?? "1h";
  const movingAverageTf = tfMap.movingAverage ?? "1h";
  const bollingerTf = tfMap.bollinger ?? "15m";
  const keltnerTf = tfMap.keltner ?? "15m";
  const ifvgTf = tfMap.ifvg ?? "15m";
  const fvgTf = tfMap.fvg ?? "5m";

  const rawSignalSql = buildSignalSelect(spec, signalSource, { pricingTf, zoneTf, atrTfs, orbTf, indicatorTf, movingAverageTf, bollingerTf, keltnerTf, ifvgTf, fvgTf });
  const signalSql = bindAtrReferences(rawSignalSql, atrTfs);

  if (opts.debug) {
    // Explain mode (P1-C): cumulative per-condition counts.
    // Embed _sm_* / _em_* boolean columns, chain CTEs adding
    // one filter at a time, so SELECT shows count drops.

    // ── Setup: embed _sm_* booleans (predicate + freshness) ──
    const setupMatchExprs = setupConds.map((cond) => {
      const tableRef = cond === biasCond ? "b" : `pit_${cond.id}`;
      const predRaw = translatePredicate(cond.predicate, tableRef, "setup", biasAliasMap);
      const pred = mode === "pit" ? stripPitLeaks(predRaw) : predRaw;
      const freshness = buildFreshnessPredicate(cond, tableRef, "b.ts");
      return `(${pred} ${freshness}) AS _sm_${cond.id}`;
    });
    const setupSectionDebug = `
SELECT b.symbol, b.ts, b.direction as bias_direction${biasExtraCols.length ? "," : ""}${biasExtraCols.length ? "\n  " + biasExtraCols.join(", ") : ""}${signalDirectionProjection},
  ${setupMatchExprs.join(",\n  ")}
FROM bias_candidates b${setupLateralSection}`;

    // ── Entry: embed _em_* booleans (predicate + freshness) ──
    const entryMatchExprs = entryConds.map((cond) => {
      const tableRef = `pit_${cond.id}`;
      const predRaw = translatePredicate(cond.predicate, tableRef, "entry");
      const pred = mode === "pit" ? stripPitLeaks(predRaw) : predRaw;
      const freshness = buildFreshnessPredicate(cond, tableRef, "s.ts");
      return `(${pred} ${freshness}) AS _em_${cond.id}`;
    });
    const entrySectionDebug = `
SELECT DISTINCT ON (s.symbol, s.ts) s.symbol, s.ts, s.bias_direction${signalDirectionProjection ? ", s.signal_direction" : ""},
  ${entryMatchExprs.join(",\n  ")}
FROM s_filtered s${entryLateralSection}`;

    // ── Build CTEs in dependency order ──
    const ctes: string[] = [];
    const selects: string[] = [
      `  (SELECT COUNT(*) FROM bias_candidates) AS bias_rows`,
    ];

    // 1. setup_candidates_raw alias
    ctes.push("setup_candidates_raw AS (SELECT * FROM setup_candidates_raw_tmp)");

    // 2. Cumulative setup filters
    let cumSetup: string[] = [];
    for (const cond of setupConds) {
      cumSetup.push(`_sm_${cond.id}`);
      const prev = ctes[ctes.length - 1].split(" AS ")[0];
      const alias = `sc_${cond.id}`;
      ctes.push(`${alias} AS (SELECT * FROM ${prev} WHERE ${cumSetup.join(" AND ")})`);
      selects.push(`  (SELECT COUNT(*) FROM ${alias}) AS setup_${cond.id}_rows`);
    }

    // 3. s_filtered + entry raw (LATERALs need s_filtered rows)
    const lastSetupCte = ctes[ctes.length - 1].split(" AS ")[0];
    ctes.push(`s_filtered AS (SELECT * FROM ${lastSetupCte})`);
    ctes.push(`entry_candidates_raw AS (${indent(entrySectionDebug, 2).trimStart()})`);

    // 4. Cumulative entry filters
    let cumEntry: string[] = [];
    for (const cond of entryConds) {
      cumEntry.push(`_em_${cond.id}`);
      const prev = ctes[ctes.length - 1].split(" AS ")[0];
      const alias = `ec_${cond.id}`;
      ctes.push(`${alias} AS (SELECT * FROM ${prev} WHERE ${cumEntry.join(" AND ")})`);
      selects.push(`  (SELECT COUNT(*) FROM ${alias}) AS entry_${cond.id}_rows`);
    }

    return `
WITH bias_candidates AS (
${indent(biasSection, 2)}
),
setup_candidates_raw_tmp AS (
${indent(setupSectionDebug, 2)}
),
${ctes.join(",\n")}
SELECT
${selects.join(",\n")}
`;
  }

  return `
WITH bias_candidates AS (
${indent(biasSection, 2)}
),
setup_candidates AS (
${indent(setupSection, 2)}
),
entry_signals AS (
${indent(entrySection, 2)}
)
${signalSql}
`;
}

interface ResolvedTimeframes {
  pricing: TimeFrame;
  zone: TimeFrame;
  atrTfs: TimeFrame[];
  orb: TimeFrame;
  indicator: TimeFrame;
  movingAverage: TimeFrame;
  bollinger: TimeFrame;
  keltner: TimeFrame;
  ifvg: TimeFrame;
  fvg: TimeFrame;
}

function resolveTimeframes(spec: StrategySpec): ResolvedTimeframes {
  const map: Partial<Omit<ResolvedTimeframes, "atrTfs">> & { atrTfs?: TimeFrame[] } = {};
  // Progressive specs use steps[] instead of setup[]
  const setupConds = spec.steps ?? spec.setup ?? [];
  for (const cond of [...setupConds, ...spec.entry]) {
    if (!("feature" in cond)) continue; // safety: steps entries are validated
    if (cond.feature === "features_pricing") map.pricing = cond.tf;
    if (cond.feature === "features_zone") map.zone = cond.tf;
    if (cond.feature === "features_opening_range") map.orb = cond.tf;
    if (cond.feature === "features_indicator") map.indicator = cond.tf;
    if (cond.feature === "features_moving_average") map.movingAverage = cond.tf;
    if (cond.feature === "features_bollinger") map.bollinger = cond.tf;
    if (cond.feature === "features_keltner") map.keltner = cond.tf;
    if (cond.feature === "features_ifvg") map.ifvg = cond.tf;
    if (
      cond.feature === "features_zone" &&
      isFvgZoneCondition(cond)
    ) {
      map.fvg = cond.tf;
    }
  }

  // ATR can appear in risk expressions with explicit timeframes (e.g. atr(1m)).
  // Collect every referenced TF so the signal SELECT can join them all.
  const atrRefs = new Set<TimeFrame>();
  const riskExprs = [
    spec.risk?.sl,
    spec.risk?.tp,
    spec.entryConfig?.zonePips != null ? String(spec.entryConfig.zonePips) : null,
    spec.risk?.tpOffsetPips != null ? String(spec.risk.tpOffsetPips) : null,
  ].filter(Boolean) as string[];

  for (const expr of riskExprs) {
    for (const tf of extractAtrTimeframes(expr)) {
      atrRefs.add(tf);
    }
  }

  // Also honor an explicit features_atr condition if present.
  const explicitAtrCond = [...setupConds, ...spec.entry].find((c) => c.feature === "features_atr");
  if (explicitAtrCond) {
    atrRefs.add(explicitAtrCond.tf);
  }

  return {
    pricing: map.pricing ?? map.zone ?? "15m",
    zone: map.zone ?? "15m",
    atrTfs: atrRefs.size > 0 ? Array.from(atrRefs) : ["15m"],
    orb: map.orb ?? "15m",
    indicator: map.indicator ?? "1h",
    movingAverage: map.movingAverage ?? "1h",
    bollinger: map.bollinger ?? "15m",
    keltner: map.keltner ?? "15m",
    ifvg: map.ifvg ?? "15m",
    fvg: map.fvg ?? "5m",
  };
}

const ATR_TF_RE = /\batr\s*\(\s*(1m|5m|15m|1h|4h|1d)\s*\)/gi;

export function extractAtrTimeframes(expr: string): TimeFrame[] {
  const tfs: TimeFrame[] = [];
  const validTfs = new Set<TimeFrame>(["1m", "5m", "15m", "1h", "4h", "1d"]);
  let m: RegExpExecArray | null;
  // Reset lastIndex in case the regex is reused
  ATR_TF_RE.lastIndex = 0;
  while ((m = ATR_TF_RE.exec(expr)) !== null) {
    const tf = m[1].toLowerCase() as TimeFrame;
    if (validTfs.has(tf) && !tfs.includes(tf)) {
      tfs.push(tf);
    }
  }
  return tfs;
}

/**
 * Extract every unique (feature@tf) key a strategy spec requires for live
 * execution — features from setup/entry conditions, gate core inputs, and ATR
 * timeframes referenced in risk expressions.
 *
 * Used by both the pipeline trigger (feature engine scheduling) and the live
 * runner (feature freshness checks) so they stay in sync.
 */
export function extractRequiredFeatures(spec: StrategySpec): Set<string> {
  const required = new Set<string>();
  for (const item of [...(spec.setup ?? []), ...(spec.steps ?? []), ...(spec.entry ?? [])]) {
    if (item.feature && item.tf) required.add(`${item.feature}@${item.tf}`);
  }
  // Core features consumed by gates.
  required.add("features_atr@15m");
  required.add("features_session@1m");
  required.add("features_spread@1m");
  // ATR timeframes referenced by risk expressions.
  const riskExprs = [
    spec.risk?.sl,
    spec.risk?.tp,
    spec.entryConfig?.zonePips != null ? String(spec.entryConfig.zonePips) : null,
    spec.risk?.tpOffsetPips != null ? String(spec.risk.tpOffsetPips) : null,
  ].filter(Boolean) as string[];
  for (const expr of riskExprs) {
    for (const tf of extractAtrTimeframes(expr)) {
      required.add(`features_atr@${tf}`);
    }
  }
  return required;
}

function atrAlias(tf: TimeFrame): string {
  return `a_${tf.replace(/[^a-z0-9]/gi, "_")}`;
}

function bindAtrReferences(sql: string, atrTfs: TimeFrame[]): string {
  let out = sql;
  for (const tf of atrTfs) {
    const re = new RegExp(`\\batr\\s*\\(\\s*${tf}\\s*\\)`, "gi");
    out = out.replace(re, `COALESCE(${atrAlias(tf)}.effective_value, ${atrAlias(tf)}.value)`);
  }
  return out;
}

interface SignalTfs {
  pricingTf: TimeFrame;
  zoneTf: TimeFrame;
  atrTfs: TimeFrame[];
  orbTf: TimeFrame;
  indicatorTf: TimeFrame;
  movingAverageTf: TimeFrame;
  bollingerTf: TimeFrame;
  keltnerTf: TimeFrame;
  ifvgTf: TimeFrame;
  fvgTf: TimeFrame;
  /** Table the signal SELECT reads entry rows from. Flat path: setup_candidates. Progressive path: entry_signals. */
  signalTable?: string;
}

function buildAtrJoins(atrTfs: TimeFrame[]): string {
  return atrTfs
    .map(
      (tf) => `JOIN features_atr ${atrAlias(tf)} ON e.symbol = ${atrAlias(tf)}.symbol AND ${atrAlias(tf)}.tf = '${tf}' AND ${atrAlias(tf)}.period = 5
  AND ${atrAlias(tf)}.ts = (SELECT MAX(ts) FROM features_atr WHERE symbol = e.symbol AND tf = '${tf}' AND period = 5 AND ts <= e.ts)`
    )
    .join("\n");
}

function buildAtrSelectColumns(atrTfs: TimeFrame[]): string {
  const primaryTf = atrTfs[0];
  return atrTfs
    .map((tf) => {
      const alias = atrAlias(tf);
      const eff = `COALESCE(${alias}.effective_value, ${alias}.value)`;
      const col = `  ${eff} as atr_${tf.replace(/[^a-z0-9]/gi, "_")}`;
      return tf === primaryTf ? `${col},\n  ${eff} as atr_5,` : `${col},`;
    })
    .join("\n");
}

function compileInternalWaveSQL(spec: StrategySpec, opts: CompileOptions): string {
  const symbolSql = opts.symbol
    ? `AND le.symbol = '${opts.symbol.replace(/'/g, "''")}'`
    : "";
  const windowSql = opts.mode === "pit" && opts.from && opts.to
    ? `AND le.known_at >= '${opts.from.toISOString()}'::timestamptz\n      AND le.known_at <= '${opts.to.toISOString()}'::timestamptz`
    : opts.asOfParameter
      ? `AND le.known_at <= $${opts.asOfParameter}::timestamptz\n      AND le.known_at >= $${opts.asOfParameter}::timestamptz - INTERVAL '${opts.lookbackHours ?? 24} hours'`
      : opts.dataClockTable
        ? `AND le.known_at >= (SELECT MAX(ts) FROM ${opts.dataClockTable}) - INTERVAL '${opts.lookbackHours ?? 24} hours'`
        : `AND le.known_at >= NOW() - INTERVAL '${opts.lookbackHours ?? 24} hours'`;

  return `
WITH sweeps AS (
  SELECT le.*,
    CASE WHEN le.direction = 'bullish' THEN 'buy' ELSE 'sell' END AS side
  FROM features_liquidity_event_v2 le
  WHERE le.tf = '5m'
    AND le.direction IN ('bullish', 'bearish')
    AND le.killzone_ids ?| ARRAY['LONDON_KILLZONE','NY_KILLZONE']
    ${symbolSql}
    ${windowSql}
), aligned AS (
  SELECT sw.*, ds.regime, ds.agreement
  FROM sweeps sw
  JOIN LATERAL (
    SELECT d.direction, d.regime, d.agreement
    FROM features_direction_state d
    WHERE d.symbol = sw.symbol AND d.tf = '1h' AND d.ts <= sw.known_at
    ORDER BY d.ts DESC LIMIT 1
  ) ds ON (sw.direction = 'bullish' AND ds.direction IN ('buy','bullish'))
       OR (sw.direction = 'bearish' AND ds.direction IN ('sell','bearish'))
), confirmed AS (
  SELECT a.*, d.ts AS confirmation_ts, mc.c AS confirmation_price
  FROM aligned a
  JOIN LATERAL (
    SELECT x.ts, x.tf
    FROM features_displacement x
    WHERE x.symbol = a.symbol
      AND x.tf IN ('1m','5m')
      AND x.ts > a.known_at
      AND x.ts <= a.known_at + INTERVAL '30 minutes'
      AND x.direction = a.direction
    ORDER BY x.ts ASC, CASE x.tf WHEN '5m' THEN 0 ELSE 1 END
    LIMIT 1
  ) d ON TRUE
  JOIN LATERAL (
    SELECT c.c
    FROM market.candles_1m_canonical c
    WHERE c.symbol = a.symbol AND c.ts <= d.ts
    ORDER BY c.ts DESC LIMIT 1
  ) mc ON TRUE
), retested AS (
  SELECT c.*, fill.ts AS entry_ts
  FROM confirmed c
  JOIN LATERAL (
    SELECT b.ts
    FROM market.candles_1m_canonical b
    WHERE b.symbol = c.symbol
      AND b.ts > c.confirmation_ts
      AND b.ts <= c.confirmation_ts + INTERVAL '60 minutes'
      AND b.l <= c.confirmation_price AND b.h >= c.confirmation_price
    ORDER BY b.ts ASC LIMIT 1
  ) fill ON TRUE
)
SELECT
  symbol,
  entry_ts AS ts,
  direction AS bias_direction,
  NULL::text AS signal_direction,
  side,
  confirmation_price AS entry_price,
  extreme AS stop_loss,
  CASE
    WHEN direction = 'bullish' THEN confirmation_price + 2.0 * (confirmation_price - extreme)
    ELSE confirmation_price - 2.0 * (extreme - confirmation_price)
  END AS take_profit,
  event_id AS signal_event_id,
  level_id AS signal_level_id,
  known_at AS sweep_known_at,
  confirmation_ts,
  regime,
  agreement
FROM retested
WHERE (direction = 'bullish' AND extreme < confirmation_price)
   OR (direction = 'bearish' AND extreme > confirmation_price)
ORDER BY ts DESC
`;
}

function buildSignalSelect(
  spec: StrategySpec,
  signalSource: StrategySpec["signalSource"],
  tfs: SignalTfs
): string {
  const { pricingTf, zoneTf, atrTfs, orbTf, indicatorTf, movingAverageTf, ifvgTf, fvgTf, signalTable } = tfs;
  // New feature TFs are available for future signalSource branches; currently
  // used only as setup/entry filters via the point-in-time LATERAL lookups.
  void tfs.bollingerTf;
  void tfs.keltnerTf;

  switch (signalSource) {
    case "orb":
      return buildOrbSignalSelect(spec, { pricingTf, atrTfs, orbTf });
    case "indicator":
      return buildIndicatorSignalSelect(spec, { pricingTf, atrTfs, indicatorTf });
    case "moving_average":
      return buildMovingAverageSignalSelect(spec, { pricingTf, atrTfs, movingAverageTf });
    case "fvg":
      return buildFvgSignalSelect(spec, { pricingTf, atrTfs, fvgTf, signalTable });
    case "generic":
      return buildGenericSignalSelect(spec, { pricingTf, atrTfs });
    case "zone":
    default:
      return buildZoneSignalSelect(spec, { pricingTf, zoneTf, atrTfs });
  }
}

/** Emits the entry_type column only when the spec explicitly configures one. */
function buildEntryTypeColumn(spec: StrategySpec): string {
  const type = spec.entryConfig?.type;
  if (!type) return "";
  return `'${type}' as entry_type`;
}

function buildFvgSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "fvgTf" | "signalTable">
): string {
  const { pricingTf, atrTfs, fvgTf, signalTable = "setup_candidates" } = tfs;
  const ssc = spec.signalSourceConfig ?? {};
  const requireOrb = ssc.requireOrbBreakout ?? true;
  const orbStart = ssc.orbWindow?.utcStart ?? "13:45";
  const orbEnd = ssc.orbWindow?.utcEnd ?? "16:00";
  const orbClose = ssc.orbCloseUtc ?? "13:30";
  const entrySql = buildEntryPriceSql(spec, "fvg", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "fvg", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "fvg", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  const candleTable =
    fvgTf === "15m" ? "market.candles_15m_canonical"
    : fvgTf === "5m" ? "market.candles_5m_canonical"
    : "market.candles_1m_canonical";
  const candleOffset = fvgTf === "15m" ? "30 minutes" : fvgTf === "5m" ? "5 minutes" : "1 minute";
  // Registry-bounded lookback (96 bars default, or the spec's lookbackBars)
  // instead of the raw tf-tier default: zones are dense and the entry
  // LATERALs already use the same bound.
  const fvgCond = [...(spec.setup ?? []), ...(spec.steps ?? []), ...spec.entry].find(
    (c) => c.feature === "features_zone" && isFvgZoneCondition(c)
  );
  const fvgLookback = fvgCond
    ? buildLookbackInterval(fvgCond, spec)
    : buildLookbackIntervalForTf(fvgTf);
  const minFvgWidthPips = ssc.minFvgWidthPips;

  // Canonical candles contain no precision/digits column. Use same
  // symbol-aware pip contract as riskCompiler. Keep expression correlated to
  // FVG alias, which is valid inside FVG lateral WHERE.
  const pipSizeSql = `CASE
    WHEN f.symbol LIKE '%XAU%' OR f.symbol LIKE '%GOLD%' THEN 0.1
    WHEN f.symbol LIKE '%JPY%' THEN 0.01
    WHEN f.symbol LIKE '%NAS100%' OR f.symbol LIKE '%NDX%' OR f.symbol LIKE '%US30%'
      OR f.symbol LIKE '%DJI%' OR f.symbol LIKE '%DE40%' OR f.symbol LIKE '%DAX%'
      OR f.symbol LIKE '%UK100%' OR f.symbol LIKE '%FTSE%' THEN 1.0
    ELSE 0.0001
  END`;
  const widthFilterSql = minFvgWidthPips
    ? `AND (f.top - f.bottom) >= ${Number(minFvgWidthPips)} * ${pipSizeSql}`
    : "";

  // Structure-break EXISTS join. Default true for signalSource="fvg".
  // Auto-calculate lookback from FVG TF if not explicitly set.
  const requireFvgStructure = ssc.requireFvgStructureBreak ?? true;
  const fvgStructureLookback = ssc.fvgStructureLookback ?? (
    fvgTf === "1m" ? "2 hours"
    : fvgTf === "5m" ? "4 hours"
    : fvgTf === "15m" ? "8 hours"
    : fvgTf === "1h" ? "24 hours"
    : "6 hours"
  );
  const fvgStructureSql = requireFvgStructure ? `
      AND EXISTS (
        SELECT 1 FROM features_structure s
        WHERE s.symbol = e.symbol
          AND s.tf = '${fvgTf}'
          AND s.ts BETWEEN f.ts - INTERVAL '${fvgStructureLookback}' AND f.ts
          AND s.event_type IN ('bos', 'choch', 'mss')
          AND s.invalidated_at IS NULL
          AND s.direction = CASE WHEN e.resolved_direction = 'bullish' THEN 'bullish' ELSE 'bearish' END
      )` : "";

  return `
SELECT DISTINCT ON (symbol, date_trunc('day', ts AT TIME ZONE 'UTC'))
  *
FROM (
  SELECT DISTINCT ON (e.symbol, f.ts)
    e.symbol,
    f.ts,
    f.direction as bias_direction,
    f.top as fvg_top,
    f.bottom as fvg_bottom,
    ((f.top + f.bottom) / 2.0) as fvg_midpoint,
    o.high as orb_high,
    o.low as orb_low,
    p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
    CASE
      WHEN f.direction = 'bullish' THEN 'buy'
      WHEN f.direction = 'bearish' THEN 'sell'
      ELSE NULL
    END as side,
    ${entrySql} as entry_price,
    ${slSql} as stop_loss,
    ${tpSql} as take_profit${entryTypeColumn ? `,
    ${entryTypeColumn}` : ""}
  FROM ${signalTable} e
  JOIN LATERAL (
    SELECT *
    FROM features_zone f
    WHERE f.symbol = e.symbol
      AND f.tf = '${fvgTf}'
      AND f.zone_kind = 'fvg'
      AND f.ts <= e.ts
      AND f.ts >= e.ts - INTERVAL '${fvgLookback}'
      AND (f.invalidated_at IS NULL OR f.invalidated_at > e.ts)
      AND f.direction = CASE WHEN e.resolved_direction = 'bullish' THEN 'bullish' ELSE 'bearish' END
      ${widthFilterSql}
      ${fvgStructureSql}
    ORDER BY
      (f.top - f.bottom) DESC,
      f.ts DESC
    LIMIT 1
  ) f ON TRUE
  JOIN LATERAL (
    SELECT ctf.*
    FROM ${candleTable} ctf
    WHERE ctf.symbol = f.symbol AND ctf.ts = f.ts - interval '${candleOffset}'
    LIMIT 1
  ) fvg_c1 ON TRUE
  JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
    AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
  JOIN LATERAL (
    SELECT c15.h as high, c15.l as low
    FROM market.candles_15m_canonical c15
    WHERE c15.symbol = e.symbol
      AND c15.ts = date_trunc('day', f.ts AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '${orbClose}'
    LIMIT 1
  ) o ON true
${buildAtrJoins(atrTfs)}
  WHERE f.direction IN ('bullish', 'bearish')
${requireOrb ? `    AND (
      (f.direction = 'bullish' AND f.bottom > o.high)
      OR
      (f.direction = 'bearish' AND f.top < o.low)
    )` : ""}
    AND f.ts::time >= time '${orbStart}'
    AND f.ts::time <= time '${orbEnd}'
  ORDER BY e.symbol, f.ts, e.ts
) fvg_candidates
ORDER BY symbol, date_trunc('day', ts AT TIME ZONE 'UTC'), ts ASC
`;
}

function buildZoneSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "zoneTf" | "atrTfs">
): string {
  const { pricingTf, zoneTf, atrTfs } = tfs;
  const entrySql = buildEntryPriceSql(spec, "zone", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "zone", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "zone", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  // Use the strategy's pricing predicate if it exists, otherwise fall back to
  // strict discount/premium filtering.
  const pricingCond = spec.setup?.find((c) => c.feature === "features_pricing" && c.required);
  let pricingFilter: string;
  if (pricingCond?.predicate) {
    pricingFilter = translatePredicate(pricingCond.predicate, "p", "setup")
      .replace(/b\.direction/g, "e.resolved_direction");
  } else {
    pricingFilter = `CASE
      WHEN e.resolved_direction = 'bullish' THEN p.position IN ('discount', 'deep_discount')
      WHEN e.resolved_direction = 'bearish' THEN p.position IN ('premium', 'deep_premium')
    END`;
  }

  // Push the pricing predicate inside the LATERAL so the joined row actually
  // satisfies the discount/premium filter. The previous MAX(ts) join picked the
  // latest row regardless of whether it matched the pricing filter, then the
  // outer WHERE discarded it — losing signals when the latest pricing row was
  // 'premium' but the strategy needed 'discount'. (RC-2 / Bug #2)
  const pricingFilterInner = pricingFilter
    .replace(/\bp\.fib_position\b/g, "p2.fib_position")
    .replace(/\bp\.in_ote\b/g, "p2.in_ote")
    .replace(/\bp\.ote_low\b/g, "p2.ote_low")
    .replace(/\bp\.ote_high\b/g, "p2.ote_high")
    .replace(/\bp\.position\b/g, "p2.position");
  const pricingLookback = buildLookbackIntervalForTf(pricingTf);

  return `
SELECT
  e.symbol,
  e.ts,
  e.bias_direction,
  e.causal_lineage || jsonb_build_array(
    jsonb_build_object('conditionId', 'signal_pricing', 'feature', 'features_pricing', 'tf', '${pricingTf}', 'row', to_jsonb(p)),
    jsonb_build_object('conditionId', 'signal_zone', 'feature', 'features_zone', 'tf', '${zoneTf}', 'row', to_jsonb(z))
  ) as causal_lineage,
  z.ts as zone_ts,
  z.top as zone_top,
  z.bottom as zone_bottom,
  z.zone_kind,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN e.resolved_direction = 'bullish' THEN 'buy'
    WHEN e.resolved_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM entry_signals e
JOIN LATERAL (
  SELECT *
  FROM features_pricing p2
  WHERE p2.symbol = e.symbol AND p2.tf = '${pricingTf}'
    AND p2.ts <= e.ts
    AND p2.ts >= e.ts - INTERVAL '${pricingLookback}'
    AND (${pricingFilterInner})
  ORDER BY p2.ts DESC
  LIMIT 1
) p ON TRUE
JOIN LATERAL (
  SELECT *
  FROM features_zone z
  WHERE z.symbol = e.symbol
    AND z.tf = '${zoneTf}'
    AND z.ts <= e.ts
    AND z.ts >= e.ts - INTERVAL '${buildLookbackIntervalForTf(zoneTf)}'
    AND (z.mitigated_at IS NULL OR z.mitigated_at > e.ts)
    AND (z.invalidated_at IS NULL OR z.invalidated_at > e.ts)
    AND z.direction = CASE WHEN e.resolved_direction = 'bullish' THEN 'bullish' ELSE 'bearish' END
  ORDER BY
    CASE WHEN e.resolved_direction = 'bullish' THEN z.bottom END DESC NULLS LAST,
    CASE WHEN e.resolved_direction = 'bearish' THEN z.top END ASC NULLS LAST,
    z.rank_score DESC NULLS LAST,
    z.strength_score DESC NULLS LAST,
    z.quality_score DESC NULLS LAST,
    z.ts DESC
  LIMIT 1
) z ON TRUE
${buildAtrJoins(atrTfs)}
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (${pricingFilter})
ORDER BY e.ts DESC
`;
}

function buildOrbSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "orbTf">
): string {
  const { pricingTf, atrTfs, orbTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "orb", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "orb", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "orb", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  // The ORB condition declares which session's opening range this strategy
  // trades. The join pins the range to the signal's UTC date + session +
  // tf-derived range length and requires completion (o.ts <= e.ts) — stale
  // ranges from prior sessions/days can never match (V4 BUG-11).
  const orbCond = [...(spec.setup ?? []), ...(spec.steps ?? []), ...spec.entry].find(
    (c) => c.feature === "features_opening_range"
  );
  if (!orbCond) {
    throw new Error("signalSource 'orb' requires a features_opening_range condition");
  }
  const orbJoin = buildOrbSessionScopedJoin(orbCond, "o", "e");
  return `
SELECT DISTINCT ON (symbol, date_trunc('day', ts AT TIME ZONE 'UTC'))
  *
FROM (
  SELECT
  e.symbol,
  e.ts,
  e.bias_direction,
  o.high as orb_high,
  o.low as orb_low,
  o.midpoint as orb_midpoint,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN e.resolved_direction = 'bullish' THEN 'buy'
    WHEN e.resolved_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM entry_signals e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_opening_range o ON e.symbol = o.symbol AND o.tf = '${orbTf}'${orbJoin}
${buildAtrJoins(atrTfs)}
WHERE e.bias_direction IN ('bullish', 'bearish')
) orb_candidates
ORDER BY symbol, date_trunc('day', ts AT TIME ZONE 'UTC'), ts ASC
`;
}

function buildIndicatorSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "indicatorTf">
): string {
  const { pricingTf, atrTfs, indicatorTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "indicator", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "indicator", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "indicator", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  return `
SELECT
  e.symbol,
  e.ts,
  e.bias_direction,
  i.indicator_name,
  i.value as indicator_value,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN e.resolved_direction = 'bullish' THEN 'buy'
    WHEN e.resolved_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM entry_signals e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_indicator i ON e.symbol = i.symbol AND i.tf = '${indicatorTf}'
  AND i.ts = (SELECT MAX(ts) FROM features_indicator WHERE symbol = e.symbol AND tf = '${indicatorTf}' AND ts <= e.ts)
${buildAtrJoins(atrTfs)}
WHERE e.bias_direction IN ('bullish', 'bearish')
ORDER BY e.ts DESC
`;
}

/**
 * Generic signal select: uses entry_signals + features_pricing + ATR only.
 * No zone/OB/FVG LATERAL join required. Entry price from pricing ote_low/ote_high.
 * Intended for strategies whose entry conditions already filter from feature tables
 * (e.g. order_block, ifvg, structure) — the signal layer just needs prices + ATR.
 */
function buildGenericSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs">
): string {
  const { pricingTf, atrTfs } = tfs;
  const entrySql = buildEntryPriceSql(spec, "generic", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "generic", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "generic", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  // Derive side from signal_direction (push-pull) with fallback to bias_direction.
  // signal_direction is projected by compileFullSQL when a non-bias setup
  // condition (e.g. features_push_pull) has a direction column.
  return `
SELECT
  e.symbol,
  e.ts,
  e.bias_direction,
  e.signal_direction,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN e.resolved_direction = 'bullish' THEN 'buy'
    WHEN e.resolved_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM entry_signals e
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
${buildAtrJoins(atrTfs)}
WHERE e.bias_direction IS NOT NULL
ORDER BY e.ts DESC
`;
}

function buildMovingAverageSignalSelect(
  spec: StrategySpec,
  tfs: Pick<SignalTfs, "pricingTf" | "atrTfs" | "movingAverageTf">
): string {
  const { pricingTf, atrTfs, movingAverageTf } = tfs;
  const entrySql = buildEntryPriceSql(spec, "moving_average", { signalAlias: "e" });
  const slSql = buildSlSql(spec, "moving_average", { signalAlias: "e" });
  const tpSql = buildTpSql(spec, "moving_average", { signalAlias: "e" });
  const entryTypeColumn = buildEntryTypeColumn(spec);
  const cfg = spec.signalSourceConfig ?? {};
  const maType = cfg.maType ?? "sma";
  const fastPeriod = cfg.fastPeriod ?? 9;
  const slowPeriod = cfg.slowPeriod ?? 21;

  return `
SELECT
  e.symbol,
  e.ts,
  e.bias_direction,
  fast_ma.value as ma_fast,
  slow_ma.value as ma_slow,
  fast_ma.value as signal_reference_price,
  market_candle.c as planned_entry_price,
  p.position as pricing_position,
${buildAtrSelectColumns(atrTfs)}
  CASE
    WHEN e.resolved_direction = 'bullish' THEN 'buy'
    WHEN e.resolved_direction = 'bearish' THEN 'sell'
    ELSE NULL
  END as side,
  ${entrySql} as entry_price,
  ${slSql} as stop_loss,
  ${tpSql} as take_profit${entryTypeColumn ? `,
  ${entryTypeColumn}` : ""}
FROM entry_signals e
JOIN LATERAL (
  SELECT c.c
  FROM market.candles_1m_canonical c
  WHERE c.symbol = e.symbol AND c.ts <= e.ts
  ORDER BY c.ts DESC
  LIMIT 1
) market_candle ON TRUE
JOIN features_pricing p ON e.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing WHERE symbol = e.symbol AND tf = '${pricingTf}' AND ts <= e.ts)
JOIN features_moving_average fast_ma ON e.symbol = fast_ma.symbol AND fast_ma.tf = '${movingAverageTf}'
  AND fast_ma.ma_type = '${maType}' AND fast_ma.period = ${fastPeriod}
  AND fast_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = e.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${fastPeriod} AND ts <= e.ts)
JOIN features_moving_average slow_ma ON e.symbol = slow_ma.symbol AND slow_ma.tf = '${movingAverageTf}'
  AND slow_ma.ma_type = '${maType}' AND slow_ma.period = ${slowPeriod}
  AND slow_ma.ts = (SELECT MAX(ts) FROM features_moving_average WHERE symbol = e.symbol AND tf = '${movingAverageTf}' AND ma_type = '${maType}' AND period = ${slowPeriod} AND ts <= e.ts)
${buildAtrJoins(atrTfs)}
WHERE e.bias_direction IN ('bullish', 'bearish')
  AND (
    (e.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)
    OR (e.bias_direction = 'bearish' AND fast_ma.value < slow_ma.value)
  )
ORDER BY e.ts DESC
`;
}

/** Translate simplified predicate syntax to SQL */
function translatePredicate(
  predicate: string,
  tableRef: string,
  context: "setup" | "entry",
  biasAliases: Record<string, string> = {}
): string {
  // Map qualified feature references to the correct alias.  The anchor bias
  // condition uses the FROM table ('b' in setup, 's' in entry); additional
  // bias/htf_bias conditions each have their own LATERAL alias so specs can
  // express multi-timeframe confluence.
  const biasAlias = biasAliases["features_bias"] ?? (context === "setup" ? "b" : "s");
  const htfBiasAlias = biasAliases["features_htf_bias"] ?? (context === "setup" ? "b" : "s");
  const directionStateAlias = biasAliases["features_direction_state"] ?? (context === "setup" ? "b" : "s");
  // The entry CTE (setup_candidates) exposes the bias as "bias_direction",
  // while raw feature tables and LATERAL aliases expose it as "direction".
  const biasDirectionCol = biasAlias === "s" ? "bias_direction" : "direction";
  const htfBiasDirectionCol = htfBiasAlias === "s" ? "bias_direction" : "direction";
  const directionStateDirectionCol = directionStateAlias === "s" ? "bias_direction" : "direction";
  const anchorAlias = biasAliases.__anchor ?? (context === "setup" ? "b" : "s");

  let sql = predicate
    .replace(/features_bias\.direction/g, "__BIAS_DIR__")
    .replace(/features_bias\b/g, "__BIAS_TABLE__")
    .replace(/features_htf_bias\.direction/g, "__HTF_BIAS_DIR__")
    .replace(/features_htf_bias\.state/g, "__HTF_BIAS_STATE__")
    .replace(/features_htf_bias\b/g, "__HTF_BIAS_TABLE__")
    .replace(/features_direction_state\.direction/g, "__DIRECTION_STATE_DIR__")
    .replace(/features_direction_state\b/g, "__DIRECTION_STATE_TABLE__");

  // Use word boundaries so period/fast_period/etc don't overlap.
  // Bare-column map. `score` MUST run before strength_score/quality_score (its
  // word boundary would otherwise match the `score` segment after the `.` of an
  // already-replaced tableRef.strength_score). regime/state/agreement are safe.
  sql = sql
    .replace(/\bregime\b/g, `${tableRef}.regime`)
    .replace(/\bstate\b/g, `${tableRef}.state`)
    .replace(/\bagreement\b/g, `${tableRef}.agreement`)
    .replace(/\bscore\b/g, `${tableRef}.score`)
    .replace(/\bzone_kind\b/g, `${tableRef}.zone_kind`)
    .replace(/\bevent_type\b/g, `${tableRef}.event_type`)
    .replace(/\bdirection\b/g, `${tableRef}.direction`)
    .replace(/\bfib_position\b/g, `${tableRef}.fib_position`)
    .replace(/\bin_ote\b/g, `${tableRef}.in_ote`)
    .replace(/\bote_low\b/g, `${tableRef}.ote_low`)
    .replace(/\bote_high\b/g, `${tableRef}.ote_high`)
    .replace(/\bposition\b/g, `${tableRef}.position`)
    .replace(/\bfill_pct\b/g, `${tableRef}.fill_pct`)
    .replace(/\btapped\b/g, `${tableRef}.tapped`)
    .replace(/\bgrade\b/g, `${tableRef}.grade`)
    .replace(/\bob_kind\b/g, `${tableRef}.ob_kind`)
    .replace(/\bdegree\b/g, `${tableRef}.degree`)
    // Stored age_bars is producer-snapshot age. Strategy age predicates need
    // age at signal anchor, so derive it from causal timestamps instead.
    .replace(
      /\bage_bars\b/g,
      `GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (${anchorAlias}.ts - ${tableRef}.ts)) / CASE ${tableRef}.tf WHEN '1m' THEN 60 WHEN '5m' THEN 300 WHEN '15m' THEN 900 WHEN '1h' THEN 3600 WHEN '4h' THEN 14400 WHEN '1d' THEN 86400 ELSE 60 END))`
    )
    .replace(/\bformation_ts\b/g, `${tableRef}.formation_ts`)
    .replace(/\bindicator_name\b/g, `${tableRef}.indicator_name`)
    .replace(/\bpattern_name\b/g, `${tableRef}.pattern_name`)
    .replace(/\brange_minutes\b/g, `${tableRef}.range_minutes`)
    .replace(/\bfast_period\b/g, `${tableRef}.fast_period`)
    .replace(/\bslow_period\b/g, `${tableRef}.slow_period`)
    .replace(/\bfast_value\b/g, `${tableRef}.fast_value`)
    .replace(/\bslow_value\b/g, `${tableRef}.slow_value`)
    .replace(/\bperiod\b/g, `${tableRef}.period`)
    .replace(/\bvalue\b/g, `${tableRef}.value`)
    .replace(/\bsession\b/g, `${tableRef}.session`)
    .replace(/\bis_fresh\b/g, `${tableRef}.is_fresh`)
    .replace(/\bquality_score\b/g, `${tableRef}.quality_score`)
    .replace(/\bconfidence\b/g, `${tableRef}.confidence`)
    .replace(/\bmidpoint\b/g, `${tableRef}.midpoint`)
    .replace(/\bma_type\b/g, `${tableRef}.ma_type`)
    .replace(/\bupper_band\b/g, `${tableRef}.upper_band`)
    .replace(/\bmiddle_band\b/g, `${tableRef}.middle_band`)
    .replace(/\blower_band\b/g, `${tableRef}.lower_band`)
    .replace(/\bbandwidth\b/g, `${tableRef}.bandwidth`)
    .replace(/\bpercent_b\b/g, `${tableRef}.percent_b`)
    .replace(/\bupper_channel\b/g, `${tableRef}.upper_channel`)
    .replace(/\bmiddle_channel\b/g, `${tableRef}.middle_channel`)
    .replace(/\blower_channel\b/g, `${tableRef}.lower_channel`)
    .replace(/\bema_period\b/g, `${tableRef}.ema_period`)
    .replace(/\batr_period\b/g, `${tableRef}.atr_period`)
    .replace(/\bmultiplier\b/g, `${tableRef}.multiplier`)
    .replace(/\bconsecutive_count\b/g, `${tableRef}.consecutive_count`)
    .replace(/\bsequence_grade\b/g, `${tableRef}.sequence_grade`)
    .replace(/\bformation\b/g, `${tableRef}.formation`)
    .replace(/\bstrength_score\b/g, `${tableRef}.strength_score`)
    .replace(/\bis_wick_close\b/g, `${tableRef}.is_wick_close`)
    .replace(/\bwick_into_zone\b/g, `${tableRef}.wick_into_zone`)
    .replace(/\bclose_inside_zone\b/g, `${tableRef}.close_inside_zone`)
    .replace(/\bengulfing_at_zone\b/g, `${tableRef}.engulfing_at_zone`)
    .replace(/\bcorrelation_1h\b/g, `${tableRef}.correlation_1h`)
    .replace(/\bcorrelation_4h\b/g, `${tableRef}.correlation_4h`)
    .replace(/\bcorrelation_1d\b/g, `${tableRef}.correlation_1d`)
    .replace(/\bdivergence_detected\b/g, `${tableRef}.divergence_detected`)
    .replace(/\bdivergence_type\b/g, `${tableRef}.divergence_type`)
    .replace(/\breference_symbol\b/g, `${tableRef}.reference_symbol`)
    .replace(/\btop\b/g, `${tableRef}.top`)
    .replace(/\bbottom\b/g, `${tableRef}.bottom`)
    .replace(/\bmitigated_at\b/g, `${tableRef}.mitigated_at`)
    .replace(/\binvalidated_at\b/g, `${tableRef}.invalidated_at`)
    .replace(/\bhigh\b/g, `${tableRef}.high`)
    .replace(/\blow\b/g, `${tableRef}.low`)
    .replace(/\bopen\b/g, `${tableRef}.open`)
    .replace(/\bclose\b/g, `${tableRef}.close`)
    .replace(/\bdate\b/g, `${tableRef}.date`);

  // Entry context (alias="s") must use resolved_direction so that
  // features_bias.direction picks up signal_direction when bias=neutral.
  // Setup context reads the raw bias direction from the FROM table — there is
  // no signal_direction there, so the bare column is correct.
  const biasDirEntry = `COALESCE(${biasAlias}.signal_direction, ${biasAlias}.bias_direction)`;
  const htfBiasDirEntry = `COALESCE(${htfBiasAlias}.signal_direction, ${htfBiasAlias}.bias_direction)`;
  const directionStateDirEntry = `COALESCE(${directionStateAlias}.signal_direction, ${directionStateAlias}.bias_direction)`;

  sql = sql
    .replace(/__BIAS_DIR__/g, biasAlias === "s" ? biasDirEntry : `${biasAlias}.${biasDirectionCol}`)
    .replace(/__HTF_BIAS_DIR__/g, htfBiasAlias === "s" ? htfBiasDirEntry : `${htfBiasAlias}.${htfBiasDirectionCol}`)
    .replace(/__HTF_BIAS_STATE__/g, `${htfBiasAlias}.state`)
    .replace(/__BIAS_TABLE__/g, biasAlias)
    .replace(/__HTF_BIAS_TABLE__/g, htfBiasAlias)
    // Direction-state stores buy/sell. Cross-feature direction columns use
    // bullish/bearish, so normalize at compiler boundary.
    .replace(
      /__DIRECTION_STATE_DIR__/g,
      `(CASE WHEN ${directionStateAlias === "s" ? directionStateDirEntry : `${directionStateAlias}.${directionStateDirectionCol}`} IN ('buy', 'bullish') THEN 'bullish' WHEN ${directionStateAlias === "s" ? directionStateDirEntry : `${directionStateAlias}.${directionStateDirectionCol}`} IN ('sell', 'bearish') THEN 'bearish' ELSE 'neutral' END)`
    )
    .replace(/__DIRECTION_STATE_TABLE__/g, directionStateAlias);

  return sql;
}

function indent(text: string, spaces: number): string {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => prefix + line)
    .join("\n");
}
