/**
 * Registry-driven SQL builder helpers.
 *
 * These functions generate the PIT LATERAL joins, freshness predicates, and
 * lookback intervals used by the strategy compiler. They read feature semantics
 * from the FeatureRegistry so that join behavior is consistent between live
 * and PIT modes and across all feature types.
 */

import type { StrategyCondition, TimeFrame, OrbSessionKey, StrategySpec, LevelKind } from "@tm/shared";
import { ORB_SESSION_KEYS, getLevelMaxAgeDays } from "@tm/shared";

/**
 * Session window boundaries (UTC hours, inclusive start, exclusive end).
 * Mirrors SESSION_HOURS in validate.ts so the session-gap padding in
 * buildLookbackInterval stays in sync with temporal-coverage validation.
 */
const SESSION_HOURS: Array<{ label: string; start: number; end: number }> = [
  { label: "ASIA", start: 0, end: 7 },
  { label: "LONDON", start: 7, end: 12 },
  { label: "OVERLAP", start: 12, end: 16 },
  { label: "NY", start: 16, end: 21 },
];
import {
  FEATURE_REGISTRY,
  getFeatureContract,
  type FeatureContract,
  type FeatureJoinPolicy,
} from "./featureRegistry";

const TF_MINUTES: Record<TimeFrame, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/**
 * Extract simple column-equality filters from a predicate string so they can be
 * pushed into the latest_* CTE WHERE clause. Only literal right-hand sides are
 * supported: numbers, single-quoted strings, and boolean literals.
 */
export function extractEqualityPushdowns(predicate: string): Array<{ column: string; literal: string }> {
  const filters: Array<{ column: string; literal: string }> = [];
  const seen = new Map<string, string>();
  const re = /(?<!\.)\b([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?|true|false)(?=\s|$|\)|,|AND|OR|;)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(predicate)) !== null) {
    const column = m[1].toLowerCase();
    // Preserve case for string literals (e.g. 'DXY', 'NY') — only lowercase
    // numeric and boolean literals. String case matters in SQL equality.
    const literal = m[2].startsWith("'") ? m[2] : m[2].toLowerCase();
    // `is_fresh` is a mutable current-state flag, not a real equality dimension:
    // never push it into the LATERAL WHERE. In PIT mode the compiler strips it
    // from the predicate and relies on the as-of lifecycle window; in live mode
    // it stays in the outer WHERE via compiler predicate translation. Either way it must not
    // leak into the pushdown.
    if (column === "is_fresh") continue;
    if (!seen.has(column)) {
      seen.set(column, literal);
    } else if (seen.get(column) !== literal) {
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

function defaultLookbackInterval(tf: TimeFrame): string {
  switch (tf) {
    case "1m":
      return "1 hour";
    case "5m":
    case "15m":
      return "24 hours";
    case "1h":
      return "3 days";
    case "4h":
      return "7 days";
    case "1d":
      return "30 days";
    default:
      return "24 hours";
  }
}

/** Build a PostgreSQL interval string from a timeframe and an optional bar count. */
export function buildLookbackIntervalForTf(tf: TimeFrame, bars?: number): string {
  if (!bars || bars <= 0) {
    return defaultLookbackInterval(tf);
  }
  const minutes = (TF_MINUTES[tf] ?? 15) * bars;
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/** Build a PostgreSQL interval string from a strategy condition. */
/**
 * Maximum gap (minutes) between the last allowed session and the first allowed
 * session of the next day. Used by buildLookbackInterval to pad the lookback
 * window so events that occur during an overnight/weekend gap are still visible
 * at signal time (P3-C: anti-pattern A-3 / A-5 / A-13).
 *
 * Mirrors SESSION_HOURS in validate.ts. NY closes at 21:00 UTC; ASIA opens at
 * 00:00 UTC the next day → 3h gap. Weekend (Fri 21:00 → Sun 21:00) is 49h but
 * that is handled separately by the weekend padding below.
 */
const SESSION_GAP_PADDING_MINUTES = 3 * 60; // 180min overnight gap
const WEEKEND_GAP_PADDING_MINUTES = 49 * 60; // 2940min Fri 21:00 → Sun 21:00

/**
 * Compute the session-gap padding (minutes) for a spec. If the spec filters to
 * a subset of sessions, the largest gap between consecutive allowed sessions
 * (including the wrap-around to the next day) is added so that an event just
 * before a closed window is still inside the lookback at signal time.
 */
export function sessionGapPaddingMinutes(spec?: StrategySpec): number {
  // Real specs declare `filters.sessions` (plural array); tolerate a single
  // `filters.session` (singular) for parity with the gate script.
  const raw = spec?.filters?.sessions ?? (spec?.filters?.session ? [spec.filters.session] : undefined);
  if (!raw || raw.length === 0) {
    // No session filter → assume full FX week; pad for the weekend gap only.
    return WEEKEND_GAP_PADDING_MINUTES;
  }
  const windows = SESSION_HOURS.filter((s) => raw.includes(s.label));
  if (windows.length === 0) return WEEKEND_GAP_PADDING_MINUTES;
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  let maxGap = 0;
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].start - sorted[i].end;
    if (gap > maxGap) maxGap = gap;
  }
  // wrap-around: last session end → first session start next day
  const wrapGap = 24 + sorted[0].start - sorted[sorted.length - 1].end;
  if (wrapGap > maxGap) maxGap = wrapGap;
  // If the spec trades across the weekend (NY present, no ASIA restriction
  // that excludes the weekend), pad for the weekend too.
  const tradesWeekend = raw.includes("NY") && !raw.includes("ASIA");
  return maxGap * 60 + (tradesWeekend ? WEEKEND_GAP_PADDING_MINUTES : 0);
}

function formatInterval(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) return `${minutes / 1440} days`;
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/**
 * Build a PostgreSQL interval string from a strategy condition.
 *
 * P3-C enhancement: when a `spec` is supplied, the computed lookback window is
 * padded by the session-gap (and weekend-gap) padding so that sparse events
 * occurring just before an overnight or weekend closure remain visible at
 * signal time. This prevents the silent starvation anti-pattern (A-3/A-5/A-13)
 * without requiring every spec to hand-tune lookbackBars.
 *
 * The padding is additive and conservative: it never shrinks the window.
 */
export function buildLookbackInterval(cond: StrategyCondition, spec?: StrategySpec): string {
  // For forward TTL direction, use ttlMinutes as the lookback bound directly
  // (the window is parent.ts to parent.ts + ttlMinutes). No session-gap padding
  // needed — forward TTL searches into the future, not backward across gaps.
  if (cond.ttlDirection === "forward" && cond.ttlMinutes && cond.ttlMinutes > 0) {
    return formatInterval(cond.ttlMinutes);
  }

  const bars = cond.lookbackBars;
  const tf = cond.tf;
  let minutes: number;
  if (!bars || bars <= 0) {
    const contract = FEATURE_REGISTRY[cond.feature];
    if (contract) {
      // Per-TF map takes priority, then flat defaultLookbackBars
      const tfBars = contract.defaultLookbackBarsByTf?.[tf] ?? contract.defaultLookbackBars;
      minutes = (TF_MINUTES[tf] ?? 15) * tfBars;
    } else {
      minutes = (TF_MINUTES[tf] ?? 15) * 24; // fallback 24 bars
    }
  } else {
    minutes = (TF_MINUTES[tf] ?? 15) * bars;
  }
  const padding = sessionGapPaddingMinutes(spec);
  return formatInterval(minutes + padding);
}

export function isFvgZoneCondition(cond: StrategyCondition): boolean {
  if (cond.feature !== "features_zone") return false;
  const pred = cond.predicate ?? "";
  return (
    /zone_kind\s*=\s*['"]fvg['"]/i.test(pred) ||
    /zone_kind\s+IN\s*\([^)]*['"]fvg['"]/i.test(pred)
  );
}

/**
 * Build a freshness predicate for a level or lifecycle feature.
 * For non-FVG zones, rows with mitigated_at <= asOf are excluded.
 * For all level features, rows with invalidated_at <= asOf are excluded.
 * Sweeps use mitigated_at as their validity boundary.
 * Structure events use invalidated_at.
 */
export function buildFreshnessPredicate(
  cond: StrategyCondition,
  tableRef: string,
  asOfRef: string
): string {
  // Specs can opt out of the lifecycle validity window per condition (e.g. they
  // encode validity in their own predicate). Mirrors the legacy PIT fork behavior
  // so the compiler and the fork agree.
  if (cond.ignoreLifecycle) return "";

  const contract = getFeatureContract(cond.feature);

  if (contract.semanticType === "level") {
    const isFvg = cond.feature === "features_zone" && isFvgZoneCondition(cond);
    const mitigatedCol = contract.validityColumns?.mitigatedAt;
    const invalidatedCol = contract.validityColumns?.invalidatedAt;
    const parts: string[] = [];
    const levelKind: LevelKind | undefined = cond.feature === "features_ifvg"
      ? "ifvg"
      : cond.feature === "features_order_block"
        ? "order_block"
        : cond.feature === "features_zone"
          ? "zone"
          : undefined;
    const maxAgeDays = levelKind ? getLevelMaxAgeDays(levelKind, cond.tf) : undefined;

    if (!isFvg && mitigatedCol) {
      parts.push(`(${tableRef}.${mitigatedCol} IS NULL OR ${tableRef}.${mitigatedCol} > ${asOfRef})`);
    }
    if (invalidatedCol) {
      parts.push(`(${tableRef}.${invalidatedCol} IS NULL OR ${tableRef}.${invalidatedCol} > ${asOfRef})`);
    }
    if (maxAgeDays !== undefined) {
      parts.push(`${tableRef}.ts >= ${asOfRef} - INTERVAL '${maxAgeDays} days'`);
    }

    return parts.length ? `AND ${parts.join("\n        AND ")}` : "";
  }

  if (cond.feature === "features_sweep") {
    const col = contract.validityColumns?.mitigatedAt ?? "mitigated_at";
    return `AND (${tableRef}.${col} IS NULL OR ${tableRef}.${col} > ${asOfRef})`;
  }

  if (cond.feature === "features_structure") {
    const col = contract.validityColumns?.invalidatedAt ?? "invalidated_at";
    return `AND (${tableRef}.${col} IS NULL OR ${tableRef}.${col} > ${asOfRef})`;
  }

  // State, event, and distribution features do not use lifecycle freshness by
  // default; their PIT join applies the lookback window and predicate.
  return "";
}

function buildDistinctOn(contract: FeatureContract, cond: StrategyCondition): string {
  const groupCols = cond.groupBy ?? contract.equalityGroupByDefaults ?? [];
  return ["symbol", ...groupCols].join(", ");
}

function buildPushdownSql(cond: StrategyCondition, mode?: "live" | "pit"): string {
  if (!cond.predicate) return "";
  const pushdowns = extractEqualityPushdowns(cond.predicate);
  if (!pushdowns.length) return "";
  // In PIT mode, strip is_fresh, fill_pct, and tapped equality pushdowns
  // (wall-clock tainted lifecycle columns that leak future state).
  const filtered = mode === "pit"
    ? pushdowns.filter((f) => f.column !== "is_fresh" && f.column !== "fill_pct" && f.column !== "tapped")
    : pushdowns;
  if (!filtered.length) return "";
  return "\n      " + filtered.map((f) => `AND ${f.column} = ${f.literal}`).join("\n      ");
}

function buildOrderBy(contract: FeatureContract, cond: StrategyCondition): string {
  const groupCols = cond.groupBy ?? contract.equalityGroupByDefaults ?? [];
  const distinctOn = ["symbol", ...groupCols].join(", ");
  const isForward = cond.ttlDirection === "forward";
  const tieBreaker = isForward ? "ts ASC" : (contract.tieBreaker ?? "ts DESC");
  return tieBreaker ? `ORDER BY ${distinctOn}, ${tieBreaker}` : `ORDER BY ${distinctOn}, ts DESC`;
}

function buildJoinPolicyWhere(
  contract: FeatureContract,
  cond: StrategyCondition,
  tableRef: string,
  asOfRef: string,
  spec?: StrategySpec
): string {
  const lookback = buildLookbackInterval(cond, spec);
  const policy = contract.joinPolicy;
  const confirmationLag = buildConfirmationLagSql(contract, cond, asOfRef);

  const upperBound = confirmationLag
    ? `AND ${tableRef}.ts <= ${asOfRef}.ts - ${confirmationLag}`
    : `AND ${tableRef}.ts <= ${asOfRef}.ts`;

  const isForward = cond.ttlDirection === "forward";

  switch (policy) {
    case "latest_as_of":
      return isForward
        ? `
      AND ${tableRef}.ts >= ${asOfRef}.ts
      AND ${tableRef}.ts <= ${asOfRef}.ts + INTERVAL '${lookback}'`
        : `
      ${upperBound}
      AND ${tableRef}.ts >= ${asOfRef}.ts - INTERVAL '${lookback}'`;

    case "active_window":
      return isForward
        ? `
      AND ${tableRef}.ts >= ${asOfRef}.ts
      AND ${tableRef}.ts <= ${asOfRef}.ts + INTERVAL '${lookback}'`
        : `
      ${upperBound}
      AND ${tableRef}.ts >= ${asOfRef}.ts - INTERVAL '${lookback}'`;

    case "candidate_set":
      return isForward
        ? `
      AND ${tableRef}.ts >= ${asOfRef}.ts
      AND ${tableRef}.ts <= ${asOfRef}.ts + INTERVAL '${lookback}'`
        : `
      ${upperBound}
      AND ${tableRef}.ts >= ${asOfRef}.ts - INTERVAL '${lookback}'`;

    case "sample_distribution":
      return isForward
        ? `
      AND ${tableRef}.ts >= ${asOfRef}.ts
      AND ${tableRef}.ts <= ${asOfRef}.ts + INTERVAL '${lookback}'`
        : `
      ${upperBound}
      AND ${tableRef}.ts >= ${asOfRef}.ts - INTERVAL '${lookback}'`;

    case "session_scoped":
      return buildOrbSessionScopedJoin(cond, tableRef, asOfRef);

    default:
      return isForward
        ? `
      AND ${tableRef}.ts >= ${asOfRef}.ts
      AND ${tableRef}.ts <= ${asOfRef}.ts + INTERVAL '${lookback}'`
        : `
      ${upperBound}
      AND ${tableRef}.ts >= ${asOfRef}.ts - INTERVAL '${lookback}'`;
  }
}

/**
 * Build an SQL fragment for the confirmation-lag upper-bound shift.
 *
 * Features whose producer needs N bars AFTER `ts` to confirm an event (e.g.
 * pivots, which scan `lookback` bars after the center bar) are put at `ts`
 * but NOT knowable until `ts + N * barDuration`.  This function returns an
 * interval expression that shifts the LATERAL upper bound so backtests never
 * see events before they were actually confirmable.
 *
 * Returns empty string when no confirmation lag is configured.
 */
function buildConfirmationLagSql(
  contract: FeatureContract,
  cond: StrategyCondition,
  asOfRef: string
): string {
  const lagBars =
    contract.confirmationLookbackBarsByTf?.[cond.tf] ??
    contract.confirmationLookbackBars;
  if (!lagBars || lagBars <= 0) return "";

  const tfMinutes = TF_MINUTES[cond.tf] ?? 15;
  const lagMinutes = lagBars * tfMinutes;
  return `INTERVAL '${lagMinutes} minutes'`;
}

/**
 * Resolve the opening-range session a condition binds to. Session-scoped
 * features (features_opening_range) require the spec to declare `session`
 * explicitly (asia | london | ny, lowercase, matching the producer). Fails
 * fast on missing/invalid values: silently widening the join would reintroduce
 * the stale-range bug (V4 BUG-11).
 */
export function resolveOrbSession(cond: StrategyCondition): OrbSessionKey {
  const raw = (cond.session ?? "").toLowerCase();
  if ((ORB_SESSION_KEYS as readonly string[]).includes(raw)) {
    return raw as OrbSessionKey;
  }
  throw new Error(
    `Condition on session-scoped feature '${cond.feature}' (id='${cond.id}') must declare ` +
      `session: one of ${ORB_SESSION_KEYS.join(", ")} (got '${cond.session ?? "<missing>"}')`
  );
}

/**
 * WHERE fragment for the session_scoped join policy. Pins the opening-range
 * row to the anchor's UTC date + the spec-declared session + the tf-derived
 * range length, and requires the range to be complete as of the anchor
 * (row ts = range completion time, set by the producer).
 *
 * Used by both buildJoinPolicyWhere (PIT LATERALs) and the ORB signal SELECTs
 * in the compiler and the legacy backtest fork, so every ORB join is identical.
 */
export function buildOrbSessionScopedJoin(
  cond: StrategyCondition,
  tableRef: string,
  asOfRef: string
): string {
  const session = resolveOrbSession(cond);
  const rangeMinutes = TF_MINUTES[cond.tf] ?? 15;
  return `
      AND ${tableRef}.date = (${asOfRef}.ts AT TIME ZONE 'UTC')::date
      AND ${tableRef}.session = '${session}'
      AND ${tableRef}.range_minutes = ${rangeMinutes}
      AND ${tableRef}.ts <= ${asOfRef}.ts`;
}

/**
 * Build a point-in-time LATERAL lookup driven by the feature registry.
 *
 * The shape of the subquery depends on the feature's join policy:
 * - latest_as_of: returns the latest row as of the anchor timestamp
 * - active_window: returns the best active level (zones, OBs, iFVGs)
 * - candidate_set: returns the best matching event/candidate inside the lookback
 * - sample_distribution: returns the latest sample from a distribution
 */
export function buildPitLateral(
  cond: StrategyCondition,
  alias: string,
  asOfRef: string,
  spec?: StrategySpec,
  mode?: "live" | "pit"
): string {
  const contract = getFeatureContract(cond.feature);
  const distinctOn = buildDistinctOn(contract, cond);
  const pushdownSql = buildPushdownSql(cond, mode);
  const orderBy = buildOrderBy(contract, cond);
  const policyWhere = buildJoinPolicyWhere(contract, cond, cond.feature, asOfRef, spec);
  // Include the freshness predicate INSIDE the LATERAL so DISTINCT ON only
  // considers fresh rows when picking the best one. Without this, the LATERAL
  // can return a mitigated/invalidated zone as the "best" row, then the outer
  // WHERE drops it, losing the signal.
  // (RC-1 / compiler under-emission fix)
  const asOfCol = `${asOfRef}.ts`;
  const freshnessSql = buildFreshnessPredicate(cond, cond.feature, asOfCol);

  return `LATERAL (
      SELECT DISTINCT ON (${distinctOn}) *
      FROM ${cond.feature}
      WHERE symbol = ${asOfRef}.symbol
        AND tf = '${cond.tf}'${policyWhere}${pushdownSql}
        ${freshnessSql}
      ${orderBy}
    ) AS pit_${alias}`;
}

/** Return the default freshness window in minutes for a live feature check. */
export function getDefaultFreshnessMinutes(table: string, tf: TimeFrame): number | undefined {
  return FEATURE_REGISTRY[table]?.defaultFreshnessMinutesByTf?.[tf];
}

/** Return the default lookback bars for a feature, optionally per-TF. */
export function getDefaultLookbackBars(table: string, tf?: TimeFrame): number {
  const contract = FEATURE_REGISTRY[table];
  if (!contract) return 24;
  if (tf && contract.defaultLookbackBarsByTf?.[tf] !== undefined) {
    return contract.defaultLookbackBarsByTf[tf]!;
  }
  return contract.defaultLookbackBars;
}

export { FEATURE_REGISTRY, getFeatureContract };
