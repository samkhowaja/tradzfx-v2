/**
 * Higher-TimeFrame Bias feature.
 *
 * Computes directional bias from fresh order blocks and structure on higher
 * timeframes. Uses the documented MTF weighting model:
 *
 *   1D  = 3.0  (macro anchor)
 *   4H  = 2.0  (primary trading bias)
 *   1H  = 1.0  (confirmation)
 *   15m = 0.5  (tie-breaker)
 *
 * Consensus tiers:
 *   |score| >= 3.0  -> READY
 *   |score| >= 1.0  -> SOFT_WARN
 *   |score| <  1.0  -> BLOCK
 */

import type { Pool } from "@tm/shared";
import type {
  Candle,
  Direction,
  FeatureDefinition,
  TimeFrame,
} from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface HtfBiasInput {
  candles: Candle[];
}

export type HtfBiasState = "READY" | "SOFT_WARN" | "BLOCK";

export interface HtfBiasOutput {
  direction: Direction;
  confidence: number;
  state: HtfBiasState;
  score: number;
  reason: string;
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

async function computeHtfBias(
  pool: Pool,
  symbol: string,
  featureTf: TimeFrame,
  asOfTs: Date
): Promise<HtfBiasOutput> {
  const tfs = getContributingTfs(featureTf);
  let score = 0;
  const reasons: string[] = [];

  for (const tf of tfs) {
    const weight = TF_WEIGHTS[tf];
    const ob = await fetchLatestFreshOb(pool, symbol, tf, asOfTs);
    const structure = await fetchLatestFreshStructure(pool, symbol, tf, asOfTs);

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

export const htfBiasFeature: FeatureDefinition<
  HtfBiasInput,
  HtfBiasOutput
> = {
  name: "features_htf_bias",
  version: "1.0.0",
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

    // Synchronous compute interface is required by FeatureDefinition, but we
    // need to query the DB. The runner awaits the returned Promise.
    return computeHtfBias(pool, symbol, tf, endTs) as unknown as HtfBiasOutput;
  },

  hashInput(): string {
    // Runner appends symbol/tf/endTs to the input hash.
    return sha256("htfBias");
  },

  hashOutput(output): string {
    return sha256(
      `${output.direction}:${output.confidence}:${output.state}:${output.score}:${output.reason}`
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
      },
    ];
  },

  deserialize(rows): HtfBiasOutput {
    const r = rows[0];
    if (!r) return { direction: "neutral", confidence: 0, state: "BLOCK", score: 0, reason: "" };
    return {
      direction: r.direction as Direction,
      confidence: r.confidence as number,
      state: r.state as HtfBiasState,
      score: r.score as number,
      reason: r.reason as string,
    };
  },
};
