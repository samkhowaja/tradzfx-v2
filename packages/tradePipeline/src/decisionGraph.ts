/**
 * Decision Graph.
 * Unified gate pipeline — same code path for live trading and backtesting.
 * Every node writes to decision_trace for observability.
 */

import type {
  MarketContext,
  DecisionNode,
  DecisionTrace,
  DecisionTraceEntry,
} from "@tm/shared";
import { getPool } from "@tm/shared";

export type GateFunction = (
  ctx: MarketContext
) => Promise<{ passed: boolean; reason?: string }>;

export interface GateNode {
  id: string;
  type: "gate";
  gate: GateFunction;
  children: string[];
}

export interface StrategyNode {
  id: string;
  type: "strategy";
  strategyId: string;
  evaluate: (ctx: MarketContext) => Promise<boolean>;
  children: string[];
}

export type GraphNode = GateNode | StrategyNode;

export class DecisionGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private roots: string[] = [];

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.roots.includes(node.id)) {
      this.roots.push(node.id);
    }
  }

  setRoots(roots: string[]): void {
    this.roots = roots;
  }

  async evaluate(ctx: MarketContext): Promise<DecisionTrace> {
    const runId = crypto.randomUUID();
    const trace: DecisionTrace = {
      runId,
      symbol: ctx.symbol,
      strategyId: ctx.signal?.strategyId ?? "unknown",
      ts: ctx.ts,
      nodes: [],
    };

    const visited = new Set<string>();
    const queue = [...this.roots];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const node = this.nodes.get(nodeId);
      if (!node) continue;

      const start = performance.now();
      let passed = true;
      let reason: string | undefined;

      if (node.type === "gate") {
        const result = await node.gate(ctx);
        passed = result.passed;
        reason = result.reason;
      } else if (node.type === "strategy") {
        passed = await node.evaluate(ctx);
      }

      const latency = Math.round(performance.now() - start);

      trace.nodes.push({
        nodeId,
        nodeType: node.type,
        passed,
        reason,
        latencyMs: latency,
      });

      if (passed) {
        queue.push(...node.children);
      }
    }

    await this.persistTrace(trace);
    return trace;
  }

  private async persistTrace(trace: DecisionTrace): Promise<void> {
    const pool = getPool();
    const values = trace.nodes
      .map(
        (n) =>
          `('${trace.runId}', '${trace.symbol}', '${trace.strategyId}', '${trace.ts.toISOString()}', '${n.nodeId}', '${n.nodeType}', ${n.passed}, ${n.reason ? `'${n.reason.replace(/'/g, "''")}'` : "NULL"}, ${n.latencyMs}, NULL)`
      )
      .join(",");

    try {
      await pool.query(
        `INSERT INTO decision_trace (run_id, symbol, strategy_id, ts, node_id, node_type, passed, reason, latency_ms, input_hash)
         VALUES ${values}
         ON CONFLICT DO NOTHING`
      );
    } catch (err: any) {
      console.error("[decisionGraph] Failed to persist trace:", err.message);
    }
  }
}
