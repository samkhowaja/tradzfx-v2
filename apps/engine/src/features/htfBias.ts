/**
 * Higher-TimeFrame Bias feature v3.2.0 — pure HTF Bias Tree with local-agreement signal.
 *
 * Computes a top-down bias tree from higher-timeframe candles only.  No DB
 * queries, no dependency on other feature rows.  The aggregate fields
 * (direction, confidence, state, score, reason) and per-timeframe tree remain
 * unchanged for backward compatibility.
 *
 * v3.1.0 changes:
 *   - 15m weight is boosted when the trading TF is 15m so the entry timeframe
 *     is no longer the weakest voice.
 *   - Exposes a localAgreement score so specs can block when HTF and local
 *     structure disagree.
 *
 * v3.2.0 changes (Track B — HTF bias reweighting):
 *   - Rebalanced BASE_TF_WEIGHTS so the daily no longer dominates the
 *     aggregate score.  Old weights (1d=3.0, 4h=2.0, 1h=1.0, 15m=0.5) made
 *     a single daily BOS overwhelm three agreeing lower-TFs.  New weights
 *     (1d=1.5, 4h=1.5, 1h=1.5, 15m=1.0) require multi-TF agreement before
 *     the aggregate flips, which the COMPREHENSIVE_AUDIT_REPORT flagged as
 *     the root cause of over-confident A+ grades on counter-trend setups.
 *   - 15m weight is now 1.0 by default (was 0.5) and only boosted to 1.5
 *     when the trading TF is 15m, so the entry TF always has a meaningful
 *     voice without inflating the 15m contribution on higher-TF specs.
 */

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
  higherTfCandles?: Record<TimeFrame, Candle[]>;
}

const TF_ORDER: TimeFrame[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

const BASE_TF_WEIGHTS: Record<TimeFrame, number> = {
  "1d": 1.5,
  "4h": 1.5,
  "1h": 1.5,
  "15m": 1.0,
  "5m": 0.0,
  "1m": 0.0,
};

function tfWeightsFor(featureTf: TimeFrame): Record<TimeFrame, number> {
  const weights = { ...BASE_TF_WEIGHTS };
  if (featureTf === "15m") {
    // The entry timeframe should not be the weakest input.
    weights["15m"] = 1.5;
  }
  return weights;
}

function tfIndex(tf: TimeFrame): number {
  return TF_ORDER.indexOf(tf);
}

function getContributingTfs(featureTf: TimeFrame, weights: Record<TimeFrame, number>): TimeFrame[] {
  const idx = tfIndex(featureTf);
  return TF_ORDER.filter((tf) => tfIndex(tf) >= idx && weights[tf] > 0);
}

function parentTf(tf: TimeFrame, weights: Record<TimeFrame, number>): TimeFrame | undefined {
  const idx = tfIndex(tf);
  if (idx < 0 || idx >= TF_ORDER.length - 1) return undefined;
  for (let i = idx + 1; i < TF_ORDER.length; i++) {
    if (weights[TF_ORDER[i]] > 0) return TF_ORDER[i];
  }
  return undefined;
}

interface SwingBreak {
  direction: Direction;
  level: number;
  eventType: "bos" | "choch";
  ts: Date;
}

function detectSwingBreak(candles: Candle[]): SwingBreak | null {
  if (candles.length < 20) return null;
  const lookback = 10;
  const current = candles[candles.length - 1];
  const prior = candles.slice(-lookback - 1, -1);
  if (prior.length === 0) return null;

  const highest = Math.max(...prior.map((c) => c.h));
  const lowest = Math.min(...prior.map((c) => c.l));

  if (current.c > highest) {
    return { direction: "bullish", level: highest, eventType: "bos", ts: current.ts };
  }
  if (current.c < lowest) {
    return { direction: "bearish", level: lowest, eventType: "bos", ts: current.ts };
  }
  return null;
}

interface RawNode {
  tf: TimeFrame;
  score: number;
  direction: Direction;
  reasons: string[];
}

function computeRawNodes(
  featureTf: TimeFrame,
  higherTfCandles: Record<TimeFrame, Candle[]> | undefined,
  weights: Record<TimeFrame, number>
): RawNode[] {
  const tfs = getContributingTfs(featureTf, weights);
  const nodes: RawNode[] = [];
  for (const tf of tfs) {
    const candles = higherTfCandles?.[tf];
    const weight = weights[tf];
    let score = 0;
    const reasons: string[] = [];

    const swing = candles && candles.length > 0 ? detectSwingBreak(candles) : null;
    if (swing) {
      if (swing.direction === "bullish") {
        score += weight;
        reasons.push(`${tf} bullish ${swing.eventType}`);
      } else if (swing.direction === "bearish") {
        score -= weight;
        reasons.push(`${tf} bearish ${swing.eventType}`);
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

function propagateTree(
  rawNodes: RawNode[],
  weights: Record<TimeFrame, number>
): Record<TimeFrame, BiasNode> {
  const sorted = [...rawNodes].sort((a, b) => tfIndex(b.tf) - tfIndex(a.tf));
  const byTf = new Map<TimeFrame, BiasNode>();

  for (const raw of sorted) {
    const rawState = rawNodeState(raw.score);
    let state: BiasNodeState = rawState;
    let confidence = baseConfidence(rawState);
    const pTf = parentTf(raw.tf, weights);
    const parent = pTf ? byTf.get(pTf) : undefined;

    if (parent && parent.direction !== "neutral") {
      const aligned = raw.direction === parent.direction;
      if (aligned) {
        if (parent.state === "strong") {
          state = "strong";
          confidence = Math.max(confidence, 90);
        } else if (parent.state === "soft") {
          state = state === "strong" ? "strong" : "soft";
          confidence = Math.max(confidence, 70);
        }
      } else if (raw.direction !== "neutral") {
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
  featureTf: TimeFrame,
  weights: Record<TimeFrame, number>
): {
  direction: Direction;
  confidence: number;
  state: HtfBiasState;
  score: number;
  reason: string;
  localAgreement: number | undefined;
} {
  const tfs = getContributingTfs(featureTf, weights);
  let score = 0;
  const reasons: string[] = [];
  let localContribution = 0;
  let higherContribution = 0;

  for (const tf of tfs) {
    const node = tree[tf];
    if (!node) continue;
    const weight = weights[tf];
    const signed =
      node.direction === "bullish" ? weight : node.direction === "bearish" ? -weight : 0;
    score += signed;
    if (node.direction !== "neutral") {
      reasons.push(`${tf} ${node.direction}`);
    }
    if (tf === featureTf) {
      localContribution += Math.abs(signed);
    } else {
      higherContribution += Math.abs(signed);
    }
  }

  let direction: Direction = "neutral";
  let confidence = 0;
  let state: HtfBiasState = "BLOCK";

  if (Math.abs(score) >= 3.0) {
    state = "READY";
    confidence = 90;
  } else if (Math.abs(score) >= 1.5) {
    state = "SOFT_WARN";
    confidence = 70;
  } else {
    state = "BLOCK";
    confidence = 0;
  }

  if (score > 0) direction = "bullish";
  else if (score < 0) direction = "bearish";

  const reason =
    reasons.length > 0
      ? `${direction} ${state} (score=${score.toFixed(1)}): ${reasons.join(", ")}`
      : `${direction} ${state} (score=${score.toFixed(1)}): no fresh HTF context`;

  // localAgreement = how much the local TF lines up with the higher-TF consensus.
  // Undefined when the local TF does not contribute (e.g. 1m/5m trading TFs).
  let localAgreement: number | undefined;
  const localNode = tree[featureTf];
  if (localContribution > 0 || (localNode && localNode.direction !== "neutral")) {
    const aligned =
      direction === "neutral"
        ? 0
        : localNode && localNode.direction === direction
        ? 1
        : localNode && localNode.direction !== "neutral"
        ? 0
        : 0;
    const total = localContribution + higherContribution;
    localAgreement = total > 0 ? aligned * (localContribution / total) : aligned;
  }

  return { direction, confidence, state, score, reason, localAgreement };
}

function computeHtfBias(
  featureTf: TimeFrame,
  higherTfCandles: Record<TimeFrame, Candle[]> | undefined
): HtfBiasOutput {
  const weights = tfWeightsFor(featureTf);
  const rawNodes = computeRawNodes(featureTf, higherTfCandles, weights);
  const byTimeFrame = propagateTree(rawNodes, weights);
  const aggregate = computeAggregate(byTimeFrame, featureTf, weights);

  const treeSummary = Object.values(byTimeFrame)
    .sort((a, b) => tfIndex(b.tf) - tfIndex(a.tf))
    .map((n) => `${n.tf}:${n.direction}:${n.state}`)
    .join(", ");

  return {
    direction: aggregate.direction,
    confidence: aggregate.confidence,
    state: aggregate.state,
    score: aggregate.score,
    reason: `${aggregate.reason} | tree={${treeSummary}}`,
    byTimeFrame,
    tradingTf: featureTf,
    localAgreement: aggregate.localAgreement,
  };
}

export const htfBiasFeature: FeatureDefinition<HtfBiasInput, HtfBiasOutput> = {
  name: "features_htf_bias",
  version: "3.2.0",
  dependencies: [],
  referenceTimeFrames: ["1h", "4h", "1d"],

  compute(input, context): HtfBiasOutput {
    const tf = context?.tf ?? "15m";
    if (!input.higherTfCandles || Object.keys(input.higherTfCandles).length === 0) {
      return {
        direction: "neutral",
        confidence: 0,
        state: "BLOCK",
        score: 0,
        reason: "missing higher-timeframe candles",
      };
    }
    return computeHtfBias(tf, input.higherTfCandles);
  },

  hashInput(input): string {
    const htf = input.higherTfCandles;
    let htfHash = "";
    if (htf) {
      for (const tf of TF_ORDER) {
        const candles = htf[tf];
        if (!candles || candles.length === 0) continue;
        htfHash +=
          `${tf}:` +
          candles
            .map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`)
            .join("|") +
          "||";
      }
    }
    return sha256(`htfBias:v3.2.0|${htfHash}`);
  },

  hashOutput(output): string {
    const treeHash = output.byTimeFrame
      ? Object.values(output.byTimeFrame)
          .map((n) => `${n.tf}:${n.direction}:${n.state}:${n.score}`)
          .join("|")
      : "";
    return sha256(
      `${output.direction}:${output.confidence}:${output.state}:${output.score}:${output.reason}:${output.localAgreement ?? ""}:${treeHash}`
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
        local_agreement: output.localAgreement ?? null,
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
      localAgreement: r.local_agreement != null ? Number(r.local_agreement) : undefined,
    };
  },
};
