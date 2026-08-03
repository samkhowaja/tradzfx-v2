import type { ProgressiveStepV2, StrategySpec } from "@tm/shared";
import { FEATURE_REGISTRY } from "../featureRegistry";
import type { ProgressiveValidationResult } from "./types";

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const COLUMN_PATTERN = /^[a-z_][a-z0-9_]*$/;
const ORDER_TERM_PATTERN = /^[a-z_][a-z0-9_]*(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$/i;

function validateRankOrderBy(value: string): boolean {
  const terms = value.split(",").map((term) => term.trim()).filter(Boolean);
  return terms.length > 0 && terms.every((term) => ORDER_TERM_PATTERN.test(term));
}

function detectCycle(steps: ProgressiveStepV2[]): string[] | null {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependencies.map((dep) => dep.stepId)]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id);
    stack.push(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (!dependencies.has(dependency)) continue;
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return null;
  };

  for (const step of steps) {
    const cycle = visit(step.id);
    if (cycle) return cycle;
  }
  return null;
}

function reachableFromRoots(steps: ProgressiveStepV2[], roots: string[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependencies) {
      const list = children.get(dependency.stepId) ?? [];
      list.push(step.id);
      children.set(dependency.stepId, list);
    }
  }
  const reachable = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return reachable;
}

function canReachTerminal(steps: ProgressiveStepV2[], terminals: string[]): Set<string> {
  const dependencies = new Map(steps.map((step) => [step.id, step.dependencies.map((dep) => dep.stepId)]));
  const reachable = new Set<string>();
  const queue = [...terminals];
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    queue.push(...(dependencies.get(id) ?? []));
  }
  return reachable;
}

/** Strict validation for progressive DAG v2. No runtime behavior is inferred silently. */
export function validateProgressiveV2Spec(spec: StrategySpec): ProgressiveValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = spec.id || "<unknown>";

  if (spec.progressiveVersion !== 2) {
    if (spec.progressiveSteps !== undefined) errors.push(`${prefix}: progressiveSteps requires progressiveVersion: 2`);
    return { errors, warnings };
  }
  if (!Array.isArray(spec.progressiveSteps) || spec.progressiveSteps.length === 0) {
    errors.push(`${prefix}: progressiveVersion 2 requires a non-empty progressiveSteps array`);
    return { errors, warnings };
  }
  if (spec.steps?.length) {
    errors.push(`${prefix}: progressive v1 steps[] and progressiveSteps[] cannot coexist`);
  }

  const steps = spec.progressiveSteps;
  const ids = new Set<string>();
  for (const step of steps) {
    if (!ID_PATTERN.test(step.id)) errors.push(`${prefix}: node '${step.id}' has invalid id`);
    if (ids.has(step.id)) errors.push(`${prefix}: duplicate progressive node id '${step.id}'`);
    ids.add(step.id);
    if (!step.predicate?.trim()) errors.push(`${prefix}: node '${step.id}' requires a non-empty predicate`);
    if (!FEATURE_REGISTRY[step.feature]) errors.push(`${prefix}: node '${step.id}' references unknown feature '${step.feature}'`);
    const supported = FEATURE_REGISTRY[step.feature]?.supportedTimeframes;
    if (supported && !supported.includes(step.tf)) {
      errors.push(`${prefix}: node '${step.id}' requests unsupported ${step.feature}@${step.tf}`);
    }
    if (!Array.isArray(step.dependencies)) errors.push(`${prefix}: node '${step.id}' dependencies must be an array`);
    if (step.ttlBars !== undefined && (!Number.isInteger(step.ttlBars) || step.ttlBars < 1)) {
      errors.push(`${prefix}: node '${step.id}' ttlBars must be a positive integer`);
    }
    if (step.identityColumns !== undefined) {
      if (step.identityColumns.length === 0 || step.identityColumns.some((column) => !COLUMN_PATTERN.test(column))) {
        errors.push(`${prefix}: node '${step.id}' identityColumns must contain safe column identifiers`);
      }
      if (new Set(step.identityColumns).size !== step.identityColumns.length) {
        errors.push(`${prefix}: node '${step.id}' identityColumns contains duplicates`);
      }
    }
    if (step.rank) {
      if (!Number.isInteger(step.rank.limit) || step.rank.limit < 1) errors.push(`${prefix}: node '${step.id}' rank.limit must be a positive integer`);
      if (!validateRankOrderBy(step.rank.orderBy)) errors.push(`${prefix}: node '${step.id}' rank.orderBy uses unsupported syntax`);
    }
  }

  for (const step of steps) {
    const dependencyIds = new Set<string>();
    for (const dependency of step.dependencies ?? []) {
      if (!ids.has(dependency.stepId)) errors.push(`${prefix}: node '${step.id}' depends on missing node '${dependency.stepId}'`);
      if (dependency.stepId === step.id) errors.push(`${prefix}: node '${step.id}' cannot depend on itself`);
      if (dependencyIds.has(dependency.stepId)) errors.push(`${prefix}: node '${step.id}' repeats dependency '${dependency.stepId}'`);
      dependencyIds.add(dependency.stepId);
      if (dependency.minDelayBars !== undefined && (!Number.isInteger(dependency.minDelayBars) || dependency.minDelayBars < 0)) {
        errors.push(`${prefix}: edge '${dependency.stepId}' → '${step.id}' minDelayBars must be a non-negative integer`);
      }
      if (dependency.maxDelayBars !== undefined && (!Number.isInteger(dependency.maxDelayBars) || dependency.maxDelayBars < 0)) {
        errors.push(`${prefix}: edge '${dependency.stepId}' → '${step.id}' maxDelayBars must be a non-negative integer`);
      }
      if (dependency.relation === "within" && dependency.maxDelayBars === undefined) {
        errors.push(`${prefix}: edge '${dependency.stepId}' → '${step.id}' relation 'within' requires maxDelayBars`);
      }
      if (dependency.minDelayBars !== undefined && dependency.maxDelayBars !== undefined && dependency.minDelayBars > dependency.maxDelayBars) {
        errors.push(`${prefix}: edge '${dependency.stepId}' → '${step.id}' minDelayBars exceeds maxDelayBars`);
      }
    }
    const mode = step.dependencyMode ?? "all";
    if (mode === "quorum") {
      if (!Number.isInteger(step.quorum) || step.quorum! < 1 || step.quorum! > step.dependencies.length) {
        errors.push(`${prefix}: node '${step.id}' quorum must be between 1 and dependency count`);
      }
    } else if (step.quorum !== undefined) {
      errors.push(`${prefix}: node '${step.id}' quorum is only valid with dependencyMode 'quorum'`);
    }
    if (step.dependencies.length === 0 && mode !== "all") {
      errors.push(`${prefix}: root node '${step.id}' must use dependencyMode 'all'`);
    }
  }

  const cycle = detectCycle(steps);
  if (cycle) errors.push(`${prefix}: progressive DAG cycle detected: ${cycle.join(" → ")}`);

  const roots = steps.filter((step) => step.dependencies.length === 0).map((step) => step.id);
  const terminals = steps.filter((step) => step.terminal === "entry_ready").map((step) => step.id);
  if (roots.length === 0) errors.push(`${prefix}: progressive DAG requires at least one root node`);
  if (terminals.length === 0) errors.push(`${prefix}: progressive DAG requires at least one entry_ready terminal node`);

  if (!cycle && roots.length && terminals.length) {
    const fromRoots = reachableFromRoots(steps, roots);
    const toTerminal = canReachTerminal(steps, terminals);
    for (const step of steps) {
      if (!fromRoots.has(step.id)) errors.push(`${prefix}: node '${step.id}' is unreachable from every root`);
      if (step.terminal !== "invalidated" && !toTerminal.has(step.id)) {
        errors.push(`${prefix}: node '${step.id}' cannot reach an entry_ready terminal`);
      }
    }
  }

  for (const root of steps.filter((step) => step.dependencies.length === 0)) {
    if (root.kind !== "context") warnings.push(`${prefix}: root node '${root.id}' is '${root.kind}', expected context`);
  }

  return { errors, warnings };
}
