/**
 * Strategy spec validation.
 *
 * Fail-fast checks run at seed time (scripts/seed-strategy-specs.js) so that
 * structurally invalid specs never reach the compiler, the PIT backtester, or
 * the live runner. Rules here encode invariants that SQL generation relies on;
 * a violation is a spec bug, not a runtime condition.
 */

import { ORB_SESSION_KEYS } from "@tm/shared";
import type { StrategySpec, StrategyCondition, ProgressiveStep } from "@tm/shared";
import { FEATURE_REGISTRY } from "./featureRegistry";

/** Minutes per timeframe (local copy avoids circular dep through sqlBuilder). */
const TF_MINUTES: Record<string, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1h": 60,
  "4h": 240,
  "1d": 1440,
};

/** Known gate names — keeps validateSpec in sync with tradePipeline/gates/*. */
const KNOWN_GATES = new Set([
  "volatility",
  "session",
  "spread",
  "portfolioHeat",
  "familyPosition",
  "rateLimit",
  "dailyLoss",
  "dailyWin",
]);

/** Valid signal sources — matched against the compiler's compileSignalSelect dispatch. */
const VALID_SIGNAL_SOURCES = new Set([
  "zone",
  "orb",
  "indicator",
  "moving_average",
  "fvg",
  "generic",
]);

/** Valid entry types — mirrors RuntimeConfig.

/**
 * Session window boundaries (UTC hours, inclusive start, exclusive end).
 * These mirror DEFAULT_SESSION_WINDOWS from @tm/shared.
 */
const SESSION_HOURS: Array<{ label: string; start: number; end: number }> = [
  { label: "ASIA", start: 0, end: 7 },
  { label: "LONDON", start: 7, end: 12 },
  { label: "OVERLAP", start: 12, end: 16 },
  { label: "NY", start: 16, end: 21 },
];

/** Maximum intra-session gap in minutes (NY close → ASIA open next day). */
const MAX_INTRASESSION_GAP_MINUTES = 4 * 60; // 240min

/** Weekend gap in minutes (Fri 21:00 UTC → Sun 21:00 UTC for FX). */
const WEEKEND_GAP_MINUTES = 49 * 60; // 2940min

const SETUP_FAMILIES = new Set([
  "zone_reversal",
  "orb_breakout",
  "fvg_continuation",
  "trend_pullback",
  "liquidity_sweep",
  "indicator",
]);

/** Tables whose join policy requires an explicit `session` on the condition. */
function sessionScopedFeatures(): Set<string> {
  const out = new Set<string>();
  for (const [table, c] of Object.entries(FEATURE_REGISTRY)) {
    if (c.joinPolicy === "session_scoped") out.add(table);
  }
  return out;
}

/**
 * Validate a parsed strategy spec. Returns a list of human-readable errors;
 * an empty list means the spec is valid.
 */
export function validateSpec(spec: StrategySpec): string[] {
  const errors: string[] = [];
  const specId = spec.id ?? "<unknown>";
  const conds = [...(spec.setup ?? []), ...(spec.entry ?? [])];
  const scoped = sessionScopedFeatures();

  for (const cond of conds) {
    if (scoped.has(cond.feature)) {
      const raw = (cond.session ?? "").toLowerCase();
      if (!(ORB_SESSION_KEYS as readonly string[]).includes(raw)) {
        errors.push(
          `${specId}: condition '${cond.id}' on session-scoped feature '${cond.feature}' ` +
            `must declare session: one of ${ORB_SESSION_KEYS.join(", ")} ` +
            `(got '${cond.session ?? "<missing>"}')`
        );
      }
    }

    // F-16: warn when condition silently relies on registry default
    if (!cond.lookbackBars || cond.lookbackBars <= 0) {
      const contract = FEATURE_REGISTRY[cond.feature];
      if (contract) {
        const tfLabel = cond.tf ?? "?";
        const defaultBars =
          contract.defaultLookbackBarsByTf?.[cond.tf] ?? contract.defaultLookbackBars;
        console.warn(
          `${specId}: condition '${cond.id}' (${cond.feature}@${tfLabel}) ` +
            `has no explicit lookbackBars — using registry default ${defaultBars}. ` +
            `Set lookbackBars explicitly if this feature needs a wider window.`
        );
      }
    }

    // ignoreLifecycle footguard: warn when a level feature condition skips
    // lifecycle validation. This means already-hit zones/OBs/iFVGs can match,
    // potentially causing phantom entries. In the waqar_v2 spec this is
    // intentional (structure events don't need lifecycle), but most conditions
    // should NOT set this flag.
    if (cond.ignoreLifecycle && FEATURE_REGISTRY[cond.feature]?.joinPolicy === "active_window") {
      console.warn(
        `${specId}: condition '${cond.id}' on level feature '${cond.feature}' ` +
          `has ignoreLifecycle=true — lifecycle freshness is skipped. ` +
          `Ensure this is intentional; otherwise, remove ignoreLifecycle.`
      );
    }
  }

  const signalSource = spec.signalSource ?? "zone";

  // Validate signal source against compiler dispatch table.
  if (!VALID_SIGNAL_SOURCES.has(signalSource)) {
    errors.push(
      `${specId}: signalSource '${signalSource}' is invalid; expected one of ${[...VALID_SIGNAL_SOURCES].join(", ")}`
    );
  }

  // Validate every gate name against known implementations.
  for (const gate of spec.gates ?? []) {
    if (!KNOWN_GATES.has(gate.name)) {
      errors.push(
        `${specId}: unknown gate '${gate.name}' in gates list; expected one of ${[...KNOWN_GATES].join(", ")}`
      );
    }
  }

  // Validate every condition's feature is registered (catches typos like
  // "features_bais" instead of "features_bias").
  for (const cond of conds) {
    if (cond.feature && !FEATURE_REGISTRY[cond.feature]) {
      errors.push(
        `${specId}: condition '${cond.id}' references unknown feature '${cond.feature}'`
      );
    }
  }

  // Validate risk has all required fields.
  if (!spec.risk?.sl) errors.push(`${specId}: risk.sl is required`);
  if (!spec.risk?.tp) errors.push(`${specId}: risk.tp is required`);
  if (spec.risk?.minRR === undefined) errors.push(`${specId}: risk.minRR is required`);
  if (spec.risk?.timeoutBars === undefined) errors.push(`${specId}: risk.timeoutBars is required`);

  // Ordered evaluation is opt-in. Legacy specs remain unchanged and can run
  // beside staged variants for direct comparison.
  if (spec.staged?.enabled) {
    const staged = spec.staged;
    if (!TF_MINUTES[staged.context.tf]) errors.push(`${specId}: staged.context.tf is invalid`);
    if (!TF_MINUTES[staged.setup.tf]) errors.push(`${specId}: staged.setup.tf is invalid`);
    if (!TF_MINUTES[staged.entry.tf]) errors.push(`${specId}: staged.entry.tf is invalid`);
    if (!Number.isInteger(staged.context.maxAgeBars) || staged.context.maxAgeBars < 1) {
      errors.push(`${specId}: staged.context.maxAgeBars must be a positive integer`);
    }
    if (!Number.isInteger(staged.setup.maxAgeBars) || staged.setup.maxAgeBars < 1) {
      errors.push(`${specId}: staged.setup.maxAgeBars must be a positive integer`);
    }
    if (!Number.isInteger(staged.entry.maxBarsAfterTouch) || staged.entry.maxBarsAfterTouch < 1) {
      errors.push(`${specId}: staged.entry.maxBarsAfterTouch must be a positive integer`);
    }
    if (staged.setup.eventTypes.length === 0) errors.push(`${specId}: staged.setup.eventTypes cannot be empty`);
    if (staged.entry.eventTypes.length === 0) errors.push(`${specId}: staged.entry.eventTypes cannot be empty`);
  }

  // Validate entryConfig entry type if present.
  if (spec.entryConfig && !["market", "limit", "stop"].includes(spec.entryConfig.type)) {
    errors.push(
      `${specId}: entryConfig.type must be 'market', 'limit', or 'stop' (got '${spec.entryConfig.type}')`
    );
  }

  if (spec.setupFamily !== undefined && !SETUP_FAMILIES.has(spec.setupFamily)) {
    errors.push(
      `${specId}: setupFamily '${spec.setupFamily}' is invalid; expected one of ${[...SETUP_FAMILIES].join(", ")}`
    );
  }

  if (signalSource === "orb" && spec.setupFamily && spec.setupFamily !== "orb_breakout") {
    errors.push(`${specId}: signalSource 'orb' must use setupFamily 'orb_breakout'`);
  }
  if (signalSource === "fvg" && spec.setupFamily && spec.setupFamily !== "fvg_continuation") {
    errors.push(`${specId}: signalSource 'fvg' must use setupFamily 'fvg_continuation'`);
  }

  if (signalSource === "orb" && !conds.some((c) => c.feature === "features_opening_range")) {
    errors.push(
      `${specId}: signalSource 'orb' requires a features_opening_range condition in setup or entry`
    );
  }

  // Warmup must be long enough for features (zones, ATR, session state) to
  // stabilize; below 50 bars the early-window signals are distorted.
  if (spec.warmupBars !== undefined) {
    const wb = spec.warmupBars;
    if (!Number.isInteger(wb) || wb < 1) {
      errors.push(`${specId}: warmupBars must be a positive integer (got ${wb})`);
    } else if (wb < 50) {
      errors.push(
        `${specId}: warmupBars ${wb} is below the minimum 50 (early-window feature distortion)`
      );
    }
  }

  // Progressive DAG validation when steps[] present
  if (spec.steps && spec.steps.length > 0) {
    errors.push(...validateProgressiveSpec(spec));
  }

  return errors;
}

/**
 * Temporal-coverage validation (P1-B). Warns when a condition's lookback window
 * is shorter than the maximum intra-session gap or the weekend gap, meaning
 * events outside trading hours can be invisible at that TF.
 *
 * Returns warnings (soft) rather than errors — a narrow lookback may be
 * intentional for latency-sensitive event features.
 */
export function validateTemporalCoverage(spec: StrategySpec): string[] {
  const warnings: string[] = [];
  const conds = [...(spec.setup ?? []), ...(spec.entry ?? [])];

  for (const cond of conds) {
    const tf = cond.tf ?? "15m";
    const tfMinutes = TF_MINUTES[tf] ?? 15;
    const contract = FEATURE_REGISTRY[cond.feature];

    const bars =
      cond.lookbackBars ??
      contract?.defaultLookbackBarsByTf?.[tf] ??
      contract?.defaultLookbackBars ??
      0;
    if (bars <= 0) continue;

    const lookbackMinutes = bars * tfMinutes;

    // Intra-session gap
    if (lookbackMinutes < MAX_INTRASESSION_GAP_MINUTES) {
      warnings.push(
        `${spec.id}: condition '${cond.id}' (${cond.feature}@${tf}) ` +
          `lookback ${lookbackMinutes}min (${bars} bars) < max session gap ` +
          `${MAX_INTRASESSION_GAP_MINUTES}min. Structure events outside ` +
          `trading sessions invisible at this TF. Set lookbackBars >= ` +
          `${Math.ceil(MAX_INTRASESSION_GAP_MINUTES / tfMinutes)}`
      );
    }

    // Weekend gap (only relevant for TFs <= 1h)
    if (tfMinutes <= 60 && lookbackMinutes < WEEKEND_GAP_MINUTES) {
      warnings.push(
        `${spec.id}: condition '${cond.id}' (${cond.feature}@${tf}) ` +
          `lookback ${lookbackMinutes}min < weekend gap ${WEEKEND_GAP_MINUTES}min. ` +
          `Monday morning signals miss Friday structure breaks. Consider ` +
          `increasing lookbackBars or using a higher-TF condition.`
      );
    }
  }

  return warnings;
}

/**
 * Validate a progressive spec (with steps[]). Returns errors; empty = valid.
 * Checks DAG integrity, root step existence, dangling refs, cycles, TTL, rank config.
 */
/**
 * Local topological sort for progressive spec validation.
 * Avoids importing from compiler.ts (circular dependency risk).
 */
function computeTopologicalOrder(steps: ProgressiveStep[]): string[] {
  const visited = new Set<string>();
  const result: string[] = [];
  const adj = new Map<string, string[]>();
  for (const s of steps) adj.set(s.id, s.dependsOn ?? []);

  function dfs(id: string, path: Set<string>) {
    if (path.has(id)) return; // cycle — skip (validated separately)
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

export function validateProgressiveSpec(spec: StrategySpec): string[] {
  const errors: string[] = [];
  if (!spec.steps || spec.steps.length === 0) return errors; // legacy, no steps
  const specId = spec.id ?? "<unknown>";
  const stepIds = new Set(spec.steps.map((s) => s.id));

  // 1. Root step check: at least one step with empty/undefined dependsOn
  const roots = spec.steps.filter((s) => !s.dependsOn || s.dependsOn.length === 0);
  if (roots.length === 0) {
    errors.push(`${specId}: at least one step must be a root (dependsOn: [] or undefined)`);
  }

  // 1a. Every step must have a non-empty predicate string.
  // A missing predicate is silently accepted by the DAG validator but causes
  // translatePredicate(undefined) to throw at compile time (e.g. keylevel_bounce_v4's
  // htf_bias step). This catches the error at seed time.
  for (const step of spec.steps) {
    if (!step.predicate || typeof step.predicate !== "string" || step.predicate.trim().length === 0) {
      errors.push(
        `${specId}: step '${step.id}' has no predicate — every progressive step must declare a non-empty predicate string`
      );
    }
  }

  // 2. Dangling reference check
  for (const step of spec.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!stepIds.has(dep)) {
        errors.push(
          `${specId}: step '${step.id}' dependsOn '${dep}' which does not exist in steps[]`
        );
      }
    }
  }

  // 3. Cycle detection via DFS (3-color: white/gray/black)
  const adj = new Map<string, string[]>();
  for (const s of spec.steps) adj.set(s.id, s.dependsOn ?? []);
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const s of spec.steps) color.set(s.id, WHITE);

  function dfsCycle(node: string): string | null {
    color.set(node, GRAY);
    for (const neighbor of adj.get(node) ?? []) {
      const nc = color.get(neighbor);
      if (nc === GRAY) return `${node} → ${neighbor}`;
      if (nc === WHITE) {
        const sub = dfsCycle(neighbor);
        if (sub) return `${node} → ${sub}`;
      }
    }
    color.set(node, BLACK);
    return null;
  }

  for (const s of spec.steps) {
    if (color.get(s.id) === WHITE) {
      const cycle = dfsCycle(s.id);
      if (cycle) {
        errors.push(`${specId}: cycle detected in steps[]: ${cycle}`);
        break; // one cycle report is enough
      }
    }
  }

  // 4. Entry step check: entry conditions referencing steps must exist
  const stepIdsSet = stepIds;
  for (const cond of spec.entry ?? []) {
    // Check if entry condition uses dependsOn (via ProgressiveEntry — keep this loose)
    // We validate that entry doesn't reference unknown step IDs if it has them
    const entryDependsOn = (cond as any).dependsOn as string[] | undefined;
    if (entryDependsOn) {
      for (const dep of entryDependsOn) {
        if (!stepIdsSet.has(dep)) {
          errors.push(
            `${specId}: entry condition '${cond.id}' dependsOn '${dep}' which does not exist in steps[]`
          );
        }
      }
    }
  }

  // 5. Fan-out / unreachable-step check.
  // The compiler anchors entry to only the last step in topological order;
  // any step not on a dependency path ending at the terminal step is never
  // referenced — its CTE is dead code and the spec author intended filtering
  // that silently never happens (CRITICAL).
  const localTsort = computeTopologicalOrder(spec.steps);
  if (localTsort.length > 0) {
    const terminalId = localTsort[localTsort.length - 1];
    const reachable = new Set<string>();
    function markReachable(nodeId: string) {
      if (reachable.has(nodeId)) return;
      reachable.add(nodeId);
      const s = spec.steps!.find((st) => st.id === nodeId);
      if (s && s.dependsOn) {
        for (const dep of s.dependsOn) markReachable(dep);
      }
    }
    markReachable(terminalId);
    for (const step of spec.steps) {
      if (!reachable.has(step.id)) {
        errors.push(
          `${specId}: step '${step.id}' is unreachable — not on any path to terminal step '${terminalId}'`
        );
      }
    }
  }

  // 6. TTL check: positive integer if set
  for (const step of spec.steps) {
    if (step.ttlMinutes !== undefined) {
      if (!Number.isInteger(step.ttlMinutes) || step.ttlMinutes < 1) {
        errors.push(`${specId}: step '${step.id}' ttlMinutes must be a positive integer (got ${step.ttlMinutes})`);
      }
    }
  }

  // 6. Rank limit check: if rankLimit set, rankOrderBy required
  for (const step of spec.steps) {
    if (step.rankLimit !== undefined && step.rankLimit > 0) {
      if (!step.rankOrderBy) {
        errors.push(
          `${specId}: step '${step.id}' has rankLimit ${step.rankLimit} but no rankOrderBy`
        );
      }
      if (!Number.isInteger(step.rankLimit) || step.rankLimit < 1) {
        errors.push(
          `${specId}: step '${step.id}' rankLimit must be a positive integer (got ${step.rankLimit})`
        );
      }
    }
  }

  // 7. Feature registration check (same as legacy conds)
  const scoped = sessionScopedFeatures();
  for (const step of spec.steps) {
    if (!FEATURE_REGISTRY[step.feature]) {
      errors.push(
        `${specId}: step '${step.id}' references unknown feature '${step.feature}'`
      );
    }
    if (scoped.has(step.feature)) {
      const raw = (step.session ?? "").toLowerCase();
      if (!(ORB_SESSION_KEYS as readonly string[]).includes(raw)) {
        errors.push(
          `${specId}: step '${step.id}' on session-scoped feature '${step.feature}' ` +
            `must declare session: one of ${ORB_SESSION_KEYS.join(", ")} ` +
            `(got '${step.session ?? "<missing>"}')`
        );
      }
    }
  }

  return errors;
}
