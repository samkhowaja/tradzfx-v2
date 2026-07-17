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

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
};

export class DecisionGraph {
  private nodes: Map<string, GraphNode> = new Map();
  private roots: string[] = [];

  constructor(private queryClient?: Queryable) {}

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
    const db = this.queryClient ?? getPool();
    const n = trace.nodes.length;
    if (n === 0) return;

    const runId = trace.runId;
    const symbol = trace.symbol;
    const strategyId = trace.strategyId;
    const ts = trace.ts.toISOString();
    const nodeIds = trace.nodes.map((n) => n.nodeId);
    const nodeTypes = trace.nodes.map((n) => n.nodeType);
    const passed = trace.nodes.map((n) => n.passed);
    const reasons = trace.nodes.map((n) => n.reason ?? null);
    const latencies = trace.nodes.map((n) => n.latencyMs);

    try {
      await db.query(
        `INSERT INTO decision_trace (run_id, symbol, strategy_id, ts, node_id, node_type, passed, reason, latency_ms, input_hash)
         SELECT $1, $2, $3, $4, * FROM UNNEST($5::text[], $6::text[], $7::bool[], $8::text[], $9::float8[])
         ON CONFLICT DO NOTHING`,
        [runId, symbol, strategyId, ts, nodeIds, nodeTypes, passed, reasons, latencies]
      );
    } catch (err: any) {
      console.error("[decisionGraph] Failed to persist trace:", err.message);
    }
  }
}
