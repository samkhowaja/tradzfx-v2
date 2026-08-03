import { createHash } from "node:crypto";
import type { ProgressiveStepV2, StrategySpec } from "@tm/shared";
import type { ProgressivePlan, ProgressivePlanNode } from "./types";
import { validateProgressiveV2Spec } from "./validator";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function topologicalOrder(steps: ProgressiveStepV2[]): string[] {
  const index = new Map(steps.map((step, position) => [step.id, position]));
  const indegree = new Map(steps.map((step) => [step.id, step.dependencies.length]));
  const children = new Map<string, string[]>();
  for (const step of steps) {
    for (const dependency of step.dependencies) {
      const list = children.get(dependency.stepId) ?? [];
      list.push(step.id);
      children.set(dependency.stepId, list);
    }
  }
  const ready = steps.filter((step) => step.dependencies.length === 0).map((step) => step.id);
  ready.sort((a, b) => index.get(a)! - index.get(b)!);
  const result: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    result.push(id);
    const next = [...(children.get(id) ?? [])].sort((a, b) => index.get(a)! - index.get(b)!);
    for (const child of next) {
      const remaining = indegree.get(child)! - 1;
      indegree.set(child, remaining);
      if (remaining === 0) {
        ready.push(child);
        ready.sort((a, b) => index.get(a)! - index.get(b)!);
      }
    }
  }
  return result;
}

function normalizeNode(step: ProgressiveStepV2): ProgressivePlanNode {
  const dependencyMode = step.dependencyMode ?? "all";
  return {
    id: step.id,
    kind: step.kind,
    feature: step.feature,
    tf: step.tf,
    predicate: step.predicate.trim(),
    dependencies: step.dependencies.map((dependency) => ({
      stepId: dependency.stepId,
      relation: dependency.relation,
      minDelayBars: dependency.minDelayBars ?? 0,
      maxDelayBars: dependency.maxDelayBars ?? null,
    })),
    dependencyMode,
    quorum: dependencyMode === "quorum" ? step.quorum! : dependencyMode === "any" ? 1 : step.dependencies.length,
    ttlBars: step.ttlBars ?? null,
    rank: step.rank ? { limit: step.rank.limit, orderBy: step.rank.orderBy.trim() } : null,
    identityColumns: [...(step.identityColumns ?? [])],
    directionMap: step.directionMap ?? "same",
    consumption: step.consumption ?? (step.kind === "event" || step.kind === "confirmation" ? "exclusive_setup" : "reusable"),
    terminal: step.terminal ?? null,
    session: step.session ?? null,
  };
}

/** Compile validated declarative DAG into deterministic immutable runtime plan. */
export function compileProgressivePlan(spec: StrategySpec): ProgressivePlan {
  const validation = validateProgressiveV2Spec(spec);
  if (validation.errors.length) {
    throw new Error(`Invalid progressive DAG v2 spec:\n${validation.errors.join("\n")}`);
  }
  const steps = spec.progressiveSteps!;
  const order = topologicalOrder(steps);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const nodes = order.map((id) => normalizeNode(byId.get(id)!));
  const unsigned = {
    contractVersion: 2 as const,
    strategyId: spec.id,
    strategyVersion: spec.version,
    roots: nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
    terminals: nodes.filter((node) => node.terminal === "entry_ready").map((node) => node.id),
    topologicalOrder: order,
    nodes,
  };
  const planHash = createHash("sha256").update(stableJson(unsigned)).digest("hex");
  return { ...unsigned, planHash };
}
