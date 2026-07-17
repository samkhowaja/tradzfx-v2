/**
 * Direction State feature v1.0.0 — Direction Arbiter (P0 / SK-27..33).
 *
 * Reconciles the two current direction truths into ONE regime-classified
 * direction per (symbol, tf, ts):
 *   - features_bias      (v3.x blended: htf_bias + structure + pivots; has `regime`)
 *   - features_htf_bias  (v3.x pure HTF candle tree; has `state` READY/SOFT_WARN/BLOCK)
 *
 * The two disagree ~50% of the time and specs/gates each read only one, which
 * is the "two direction truths" smell (SK-30/33). This feature is the single
 * source of truth downstream consumers can predicate on uniformly (`direction`,
 * `regime`, `agreement`, `htf_state`).
 *
 * Reconcile rules (deterministic, unit-tested — see directionState.test.ts):
 *   agreement = bias.direction === htf.direction && bias.direction !== 'neutral'
 *   direction:
 *     agreement                              -> bias.direction (== htf.direction)
 *     else if htf.state === 'READY' && htf.direction !== 'neutral' -> htf.direction
 *     else if bias.direction !== 'neutral' && htf.direction === 'neutral' -> bias.direction
 *     else                                   -> 'neutral' (no trade)
 *   regime = bias.regime, forced to 'ranging' when !agreement (disagreement = choppy)
 *   confidence = agreement ? max(bias, htf) : min(bias, htf)   (0..1)
 *
 * `ts` is the evaluation anchor (last candle / endTs) — this is a STATE feature
 * (latest_as_of), unlike level features whose ts is the formation time.
 */

import type {
  Candle,
  FeatureDefinition,
  Direction,
  RegimeBiasOutput,
  HtfBiasOutput,
  HtfBiasState,
  DirectionRegime,
  DirectionStateOutput,
} from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface DirectionStateInput {
  candles: Candle[];
  features_bias?: RegimeBiasOutput;
  features_htf_bias?: HtfBiasOutput;
}

const NEUTRAL: DirectionStateOutput = {
  direction: "neutral",
  regime: "ranging",
  agreement: false,
  biasDirection: "neutral",
  htfDirection: "neutral",
  htfState: "BLOCK",
  confidence: 0,
  reason: "insufficient inputs (bias/htf_bias missing)",
};

/** Pure reconcile — exported for unit tests. */
export function reconcileDirection(
  bias: RegimeBiasOutput | undefined,
  htf: HtfBiasOutput | undefined
): DirectionStateOutput {
  if (!bias || !htf) return { ...NEUTRAL };

  const bd = bias.direction;
  const hd = htf.direction;
  const htfState = htf.state;
  const agreement = bd === hd && bd !== "neutral";

  let direction: Direction;
  let reason: string;
  if (agreement) {
    direction = bd;
    reason = `agree ${bd} htf=${htfState}`;
  } else if (htfState === "READY" && hd !== "neutral") {
    direction = hd;
    reason = `htf READY override ${hd} (bias=${bd})`;
  } else if (bd !== "neutral" && hd === "neutral") {
    direction = bd;
    reason = `bias-only ${bd} (htf neutral/${htfState})`;
  } else {
    direction = "neutral";
    reason = `disagree bias=${bd} htf=${hd}/${htfState} -> neutral`;
  }

  const regime: DirectionRegime = agreement ? bias.regime : "ranging";
  const bc = Number(bias.confidence) || 0;
  const hc = Number(htf.confidence) || 0;
  const confidence = agreement ? Math.max(bc, hc) : Math.min(bc, hc);

  return {
    direction,
    regime,
    agreement,
    biasDirection: bd,
    htfDirection: hd,
    htfState,
    confidence: Math.min(1, Math.max(0, confidence)),
    reason,
  };
}

export const directionStateFeature: FeatureDefinition<DirectionStateInput, DirectionStateOutput> = {
  name: "features_direction_state",
  version: "1.0.0",
  dependencies: ["features_bias", "features_htf_bias"],

  compute(input): DirectionStateOutput {
    return reconcileDirection(input.features_bias, input.features_htf_bias);
  },

  hashInput(input): string {
    const b = input.features_bias;
    const h = input.features_htf_bias;
    return sha256(
      `direction_state:v1.0.0:` +
        `b=${b?.direction ?? ""}:${b?.regime ?? ""}:${b?.confidence ?? ""}|` +
        `h=${h?.direction ?? ""}:${h?.state ?? ""}:${h?.confidence ?? ""}`
    );
  },

  hashOutput(output): string {
    return sha256(
      `${output.direction}:${output.regime}:${output.agreement}:${output.htfState}:${output.confidence}`
    );
  },

  serialize(output): Record<string, unknown>[] {
    // State feature: one row per evaluation. `ts` is injected by the runner
    // from opts.endTs (see buildRows) — do not set it here.
    return [
      {
        direction: output.direction,
        regime: output.regime,
        agreement: output.agreement,
        bias_direction: output.biasDirection,
        htf_direction: output.htfDirection,
        htf_state: output.htfState,
        confidence: output.confidence,
        reason: output.reason,
      },
    ];
  },

  deserialize(rows): DirectionStateOutput {
    const r = rows[0];
    if (!r) return { ...NEUTRAL };
    return {
      direction: r.direction as Direction,
      regime: r.regime as DirectionRegime,
      agreement: r.agreement as boolean,
      biasDirection: r.bias_direction as Direction,
      htfDirection: r.htf_direction as Direction,
      htfState: r.htf_state as HtfBiasState,
      confidence: Number(r.confidence) || 0,
      reason: (r.reason as string) ?? "",
    };
  },
};
