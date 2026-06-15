/**
 * Feature DAG — directed acyclic graph of feature definitions.
 * Validates dependencies and produces a topologically-sorted execution order.
 */

import type { FeatureDefinition, FeatureGraph } from "@tm/shared";

export class FeatureDAG {
  private nodes: Map<string, FeatureDefinition<any, any>> = new Map();

  register(feature: FeatureDefinition<any, any>): void {
    if (this.nodes.has(feature.name)) {
      throw new Error(`Feature ${feature.name} already registered`);
    }
    this.nodes.set(feature.name, feature);
  }

  get(name: string): FeatureDefinition<any, any> | undefined {
    return this.nodes.get(name);
  }

  /** Topologically sort features so dependencies execute before dependents */
  sort(symbol: string, tf: string, requested: string[]): FeatureDefinition<any, any>[] {
    const visited = new Set<string>();
    const temp = new Set<string>();
    const result: FeatureDefinition<any, any>[] = [];

    const visit = (name: string) => {
      if (temp.has(name)) {
        throw new Error(`Cyclic dependency detected: ${name}`);
      }
      if (visited.has(name)) return;

      temp.add(name);
      const feature = this.nodes.get(name);
      if (!feature) {
        throw new Error(`Unknown feature: ${name}`);
      }

      for (const dep of feature.dependencies) {
        visit(dep);
      }

      temp.delete(name);
      visited.add(name);
      result.push(feature);
    };

    for (const name of requested) {
      if (!visited.has(name)) {
        visit(name);
      }
    }

    return result;
  }

  /** Get all feature names reachable from the requested set */
  closure(requested: string[]): string[] {
    return this.sort("", "", requested).map((f) => f.name);
  }

  /** Get all registered feature names */
  getFeatureNames(): string[] {
    return Array.from(this.nodes.keys());
  }
}

export const globalDAG = new FeatureDAG();
