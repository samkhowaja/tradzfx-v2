/**
 * Higher-TimeFrame Bias feature v2.0.0 — HTF Bias Tree.
 *
 * Computes a top-down bias tree: 1D is computed first, then each child TF is
 * constrained by its parent. Aligned directions boost confidence; opposing
 * directions mark the child state as "opposing".
 *
 * The legacy aggregate fields (direction, confidence, state, score, reason)
 * remain unchanged for backward compatibility with the strategy compiler,
 * structure/zone HTF-alignment flags, and the setup engine.
 */

import type { Pool } from "@tm/shared";
import type {
  Candle,
  Direction,
  FeatureDefinition,
  TimeFrame,
  HtfBiasOutput,
  HtfBiasState,
  BiasNode,
  BiasNodeState,
} from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface HtfBiasInput {
  candles: Candle[];
}

const TF_ORDER: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const TF_WEIGHTS: Record<TimeFrame, number> = {
  "1d": 3.0,
  "4h": 2.0,
  "1h": 1.0,
  "15m": 0.5,
  "5m": 0.0,
  "1m": 0.0,
};

function tfIndex(tf: TimeFrame): number {
  return TF_ORDER.indexOf(tf);
}

function getContributingTfs(featureTf: TimeFrame): TimeFrame[] {
  const idx = tfIndex(featureTf);
  return TF_ORDER.filter((tf) => tfIndex(tf) >= idx && TF_WEIGHTS[tf] > 0);
}

function parentTf(tf: TimeFrame): TimeFrame | undefined {
  const idx = tfIndex(tf);
  if (idx < 0 || idx >= TF_ORDER.length - 1) return undefined;
  // Walk toward higher timeframes to find the next weighted parent.
  for (let i = idx + 1; i < TF_ORDER.length; i++) {
    if (TF_WEIGHTS[TF_ORDER[i]] > 0) return TF_ORDER[i];
  }
  return undefined;
}

async function fetchLatestFreshOb(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOfTs: Date
): Promise<{ ob_kind: string } | null> {
  const { rows } = await pool.query(
    `SELECT ob_kind
     FROM features_order_block
     WHERE symbol = $1
       AND tf = $2
       AND ts <= $3
       AND (mitigated_at IS NULL OR mitigated_at > $3)
       AND (invalidated_at IS NULL OR invalidated_at > $3)
     ORDER BY ts DESC
     LIMIT 1`,
    [symbol, tf, asOfTs]
  );
  return rows[0] ?? null;
}

async function fetchLatestFreshStructure(
  pool: Pool,
  symbol: string,
  tf: TimeFrame,
  asOfTs: Date
): Promise<{ direction: string; event_type: string } | null> {
  const { rows } = await pool.query(
    `SELECT direction, event_type
     FROM features_structure
     WHERE symbol = $1
       AND tf = $2
       AND ts <= $3
       AND (invalidated_at IS NULL OR invalidated_at > $3)
     ORDER BY ts DESC
     LIMIT 1`,
    [symbol, tf, asOfTs]
  );
  return rows[0] ?? null;
}

interface RawNode {
  tf: TimeFrame;
  score: number;
  direction: Direction;
  reasons: string[];
}

async function computeRawNodes(
  pool: Pool,
  symbol: string,
  tfs: TimeFrame[],
  asOfTs: Date
): Promise<RawNode[]> {
  const nodes: RawNode[] = [];
  for (const tf of tfs) {
    const weight = TF_WEIGHTS[tf];
    const [ob, structure] = await Promise.all([
      fetchLatestFreshOb(pool, symbol, tf, asOfTs),
      fetchLatestFreshStructure(pool, symbol, tf, asOfTs),
    ]);

    let score = 0;
    const reasons: string[] = [];

    if (ob) {
      if (ob.ob_kind === "bullish") {
        score += weight;
        reasons.push(`${tf} bullish OB`);
      } else if (ob.ob_kind === "bearish") {
        score -= weight;
        reasons.push(`${tf} bearish OB`);
      }
    }

    if (structure) {
      if (structure.direction === "bullish") {
        score += weight;
        reasons.push(`${tf} bullish ${structure.event_type}`);
      } else if (structure.direction === "bearish") {
        score -= weight;
        reasons.push(`${tf} bearish ${structure.event_type}`);
      }
    }

    let direction: Direction = "neutral";
    if (score > 0) direction = "bullish";
    else if (score < 0) direction = "bearish";

    nodes.push({ tf, score, direction, reasons });
  }
  return nodes;
}

function rawNodeState(score: number): BiasNodeState {
  const absScore = Math.abs(score);
  if (absScore >= 2) return "strong";
  if (absScore > 0) return "soft";
  return "neutral";
}

function baseConfidence(state: BiasNodeState): number {
  switch (state) {
    case "strong":
      return 80;
    case "soft":
      return 60;
    case "opposing":
      return 30;
    case "neutral":
    default:
      return 40;
  }
}

function propagateTree(rawNodes: RawNode[]): Record<TimeFrame, BiasNode> {
  // Sort from highest TF to lowest so parents are processed first.
  const sorted = [...rawNodes].sort((a, b) => tfIndex(b.tf) - tfIndex(a.tf));
  const byTf = new Map<TimeFrame, BiasNode>();

  for (const raw of sorted) {
    const rawState = rawNodeState(raw.score);
    let state: BiasNodeState = rawState;
    let confidence = baseConfidence(rawState);
    const pTf = parentTf(raw.tf);
    const parent = pTf ? byTf.get(pTf) : undefined;

    if (parent && parent.direction !== "neutral") {
      const aligned = raw.direction === parent.direction;
      if (aligned) {
        // Aligned with parent: boost confidence and ensure state is at least
        // as strong as the parent's influence.
        if (parent.state === "strong") {
          state = "strong";
          confidence = Math.max(confidence, 90);
        } else if (parent.state === "soft") {
          state = state === "strong" ? "strong" : "soft";
          confidence = Math.max(confidence, 70);
        }
      } else if (raw.direction !== "neutral") {
        // Opposing the parent: mark as opposing and reduce confidence.
        state = "opposing";
        confidence = 25;
      }
    }

    byTf.set(raw.tf, {
      tf: raw.tf,
      direction: raw.direction,
      confidence,
      state,
      score: raw.score,
      reason: `${raw.direction} ${state} on ${raw.tf} (score=${raw.score}): ${raw.reasons.join(", ") || "no fresh context"}`,
      parentTf: pTf,
    });
  }

  return Object.fromEntries(byTf) as Record<TimeFrame, BiasNode>;
}

function computeAggregate(
  tree: Record<TimeFrame, BiasNode>,
  featureTf: TimeFrame
): { direction: Direction; confidence: number; state: HtfBiasState; score: number; reason: string } {
  const tfs = getContributingTfs(featureTf);
  let score = 0;
  const reasons: string[] = [];

  for (const tf of tfs) {
    const node = tree[tf];
    if (!node) continue;
    const weight = TF_WEIGHTS[tf];
    if (node.direction === "bullish") {
      score += weight;
      reasons.push(`${tf} bullish`);
    } else if (node.direction === "bearish") {
      score -= weight;
      reasons.push(`${tf} bearish`);
    }
  }

  let direction: Direction = "neutral";
  let confidence = 0;
  let state: HtfBiasState = "BLOCK";

  if (Math.abs(score) >= 3.0) {
    state = "READY";
    confidence = 90;
  } else if (Math.abs(score) >= 1.0) {
    state = "SOFT_WARN";
    confidence = 70;
  } else {
    state = "BLOCK";
    confidence = 0;
  }

  if (score > 0) direction = "bullish";
  else if (score < 0) direction = "bearish";

  const reason = reasons.length > 0
    ? `${direction} ${state} (score=${score.toFixed(1)}): ${reasons.join(", ")}`
    : `${direction} ${state} (score=${score.toFixed(1)}): no fresh HTF context`;

  return { direction, confidence, state, score, reason };
}

async function computeHtfBias(
  pool: Pool,
  symbol: string,
  featureTf: TimeFrame,
  asOfTs: Date
): Promise<HtfBiasOutput> {
  const tfs = getContributingTfs(featureTf);
  const rawNodes = await computeRawNodes(pool, symbol, tfs, asOfTs);
  const byTimeFrame = propagateTree(rawNodes);
  const aggregate = computeAggregate(byTimeFrame, featureTf);

  const treeSummary = Object.values(byTimeFrame)
    .sort((a, b) => tfIndex(b.tf) - tfIndex(a.tf))
    .map((n) => `${n.tf}:${n.direction}:${n.state}`)
    .join(", ");

  return {
    ...aggregate,
    byTimeFrame,
    tradingTf: featureTf,
    reason: `${aggregate.reason} | tree={${treeSummary}}`,
  };
}

export const htfBiasFeature: FeatureDefinition<
  HtfBiasInput,
  HtfBiasOutput
> = {
  name: "features_htf_bias",
  version: "2.0.0",
  dependencies: [],

  compute(_input, context): HtfBiasOutput {
    const pool = context?.pool as Pool | undefined;
    const symbol = context?.symbol;
    const endTs = context?.endTs;
    const tf = context?.tf ?? "15m";

    if (!pool || !symbol || !endTs) {
      return {
        direction: "neutral",
        confidence: 0,
        state: "BLOCK",
        score: 0,
        reason: "missing context (pool/symbol/endTs)",
      };
    }

    return computeHtfBias(pool, symbol, tf, endTs) as unknown as HtfBiasOutput;
  },

  hashInput(): string {
    // Bumped to v2.0.1 so existing cached rows with NULL by_time_frame are
    // recomputed and upserted.
    return sha256("htfBias:v2.0.1");
  },

  hashOutput(output): string {
    const treeHash = output.byTimeFrame
      ? Object.values(output.byTimeFrame)
          .map((n) => `${n.tf}:${n.direction}:${n.state}:${n.score}`)
          .join("|")
      : "";
    return sha256(
      `${output.direction}:${output.confidence}:${output.state}:${output.score}:${output.reason}:${treeHash}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        direction: output.direction,
        confidence: output.confidence,
        state: output.state,
        score: output.score,
        reason: output.reason,
        by_time_frame: output.byTimeFrame ?? null,
        trading_tf: output.tradingTf ?? null,
      },
    ];
  },

  deserialize(rows): HtfBiasOutput {
    const r = rows[0];
    if (!r) return { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "" };

    const parseTree = (raw: unknown): Record<TimeFrame, BiasNode> | undefined => {
      if (!raw || typeof raw !== "object") return undefined;
      const record: Record<TimeFrame, BiasNode> = {} as any;
      for (const [tf, nodeRaw] of Object.entries(raw as Record<string, unknown>)) {
        const n = nodeRaw as Record<string, unknown>;
        record[tf as TimeFrame] = {
          tf: (n.tf ?? tf) as TimeFrame,
          direction: n.direction as Direction,
          confidence: Number(n.confidence) || 0,
          state: (n.state as BiasNodeState) ?? "neutral",
          score: Number(n.score) || 0,
          reason: (n.reason as string) ?? "",
          parentTf: n.parent_tf ? (n.parent_tf as TimeFrame) : undefined,
        };
      }
      return record;
    };

    return {
      direction: r.direction as Direction,
      confidence: r.confidence as number,
      state: r.state as HtfBiasState,
      score: r.score as number,
      reason: r.reason as string,
      byTimeFrame: parseTree(r.by_time_frame),
      tradingTf: (r.trading_tf as TimeFrame) ?? undefined,
    };
  },
};
