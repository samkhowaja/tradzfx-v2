import type { Pool, Queryable, TimeFrame, BiasNode, Direction } from "@tm/shared";
import type { SetupEvaluation, EvaluationInput, EvaluationContext, SetupGrade, SetupStatus, EntryZone, EvidenceItem, SetupDirection } from "./types";
import { buildContext, buildContextBatch } from "./contextBuilder";
import { getCalibrationTuning } from "./calibrationTuning";
import { runHardRules } from "./rules/hardRules";
import { runSoftRules } from "./rules/softRules";
import { gradeTrendAlignment } from "./graders/trendAlignment";
import { gradeEntryQuality } from "./graders/entryQuality";
import { gradeRiskQuality } from "./graders/riskQuality";
import { gradeConfirmation } from "./graders/confirmation";

const WEIGHTS = {
  trendAlignment: 0.35,
  entryQuality: 0.30,
  riskQuality: 0.20,
  confirmation: 0.15,
};

// Maximum raw score each grader can return under ideal conditions.
// Keep this in sync with the graders; it drives the achievable-confidence
// ceiling so calibration thresholds never make A/A+ unreachable.
const GRADER_MAX_SCORES = {
  trendAlignment: 60,
  entryQuality: 80,
  riskQuality: 80,
  confirmation: 70,
};

const MAX_ACHIEVABLE_CONFIDENCE = Math.round(
  GRADER_MAX_SCORES.trendAlignment * WEIGHTS.trendAlignment +
    GRADER_MAX_SCORES.entryQuality * WEIGHTS.entryQuality +
    GRADER_MAX_SCORES.riskQuality * WEIGHTS.riskQuality +
    GRADER_MAX_SCORES.confirmation * WEIGHTS.confirmation
);

function zoneOverlapsOte(
  zone: EntryZone | null,
  pricing: EvaluationContext["pricing"]
): boolean {
  if (!zone || !pricing) return false;
  const oteLow = pricing.oteLow;
  const oteHigh = pricing.oteHigh;
  if (oteLow == null || oteHigh == null) return false;
  const low = Math.min(oteLow, oteHigh);
  const high = Math.max(oteLow, oteHigh);
  return zone.bottom <= high && zone.top >= low;
}

function setupDirectionToBias(direction: SetupDirection): Direction {
  if (direction === "long") return "bullish";
  if (direction === "short") return "bearish";
  return "neutral";
}

function htfTreeGradeCap(ctx: EvaluationContext): SetupGrade | null {
  const tree = ctx.htfBias?.byTimeFrame;
  if (!tree) return null;

  const tradingNode = tree[ctx.tf];
  if (!tradingNode) return null;

  const parentTf = tradingNode.parentTf;
  const parentNode = parentTf ? tree[parentTf] : undefined;

  const tradingState = tradingNode.state ?? "neutral";
  const parentState = parentNode?.state ?? "neutral";
  const parentDirection = parentNode?.direction ?? "neutral";

  // Parent opposes setup direction -> BLOCK.
  if (parentDirection !== "neutral" && parentDirection !== setupDirectionToBias(ctx.direction)) {
    return "BLOCK";
  }

  // Trading TF is explicitly opposing its parent -> counter-trend, BLOCK.
  if (tradingState === "opposing") {
    return "BLOCK";
  }

  // Track B (v3.2.0): with rebalanced weights (1d=1.5, 4h=1.5, 1h=1.5, 15m=1.0),
  // a single "strong" parent no longer auto-promotes the trading TF to A+.
  // Require either two strong nodes OR a strong parent with a soft trading TF
  // AND a non-trivial localAgreement score (>= 0.4) so the entry TF is
  // actually confirming the higher-TF direction.
  const localAgreement = ctx.htfBias?.localAgreement;
  const localConfirms =
    localAgreement == null || localAgreement >= 0.4;

  if (parentState === "strong" && tradingState === "strong" && localConfirms) return "A+";
  if (
    (parentState === "strong" && tradingState === "soft") ||
    (parentState === "soft" && tradingState === "strong")
  ) {
    return "A";
  }
  if (parentState === "soft" && tradingState === "soft") return "B";
  if (parentState === "neutral" || tradingState === "neutral") return "C";

  return null;
}

function capGrade(a: SetupGrade, b: SetupGrade): SetupGrade {
  const order: SetupGrade[] = ["A+", "A", "B", "C", "BLOCK"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

function isAPlusEligible(
  ctx: EvaluationContext,
  entryZone: EntryZone | null
): boolean {
  if (!ctx.pricing?.inOte) return false;
  if (!entryZone) return false;
  if (!zoneOverlapsOte(entryZone, ctx.pricing)) return false;

  const zone = ctx.zones.find((z) => z.id === entryZone.zoneId);
  if (!zone) return false;
  // Invalidated zones never qualify for A+.
  if (zone.invalidatedAt) return false;
  // Retest zones (already tapped once) can still earn A+ when their quality
  // score is high enough — they often produce the cleanest reversals.
  if (zone.tapped && (zone.qualityScore == null || zone.qualityScore < 0.7)) return false;
  if (!zone.tapped && zone.qualityScore != null && zone.qualityScore < 0.5) return false;

  return true;
}

export async function evaluateSetup(
  pool: Queryable,
  input: EvaluationInput
): Promise<SetupEvaluation> {
  const ctx = await buildContext(pool, input);
  return finalizeSetup(pool, ctx);
}

async function finalizeSetup(
  pool: Queryable,
  ctx: EvaluationContext
): Promise<SetupEvaluation> {
  // 1. Hard rules (BLOCK conditions)
  const blockReasons = runHardRules(ctx);
  if (blockReasons.length > 0) {
    return buildBlockedEvaluation(ctx, blockReasons);
  }

  // 2. Sub-scores
  const trend = gradeTrendAlignment(ctx);
  const entry = gradeEntryQuality(ctx);
  const risk = await gradeRiskQuality(ctx);
  const confirmation = gradeConfirmation(ctx);

  // 3. Weighted confidence
  const confidence = Math.round(
    trend.score * WEIGHTS.trendAlignment +
    entry.score * WEIGHTS.entryQuality +
    risk.score * WEIGHTS.riskQuality +
    confirmation.score * WEIGHTS.confirmation
  );

  // 4. Grade (with optional calibration tuning)
  const grade = await mapConfidenceToGrade(confidence, ctx, entry.entryZone ?? null, pool);

  // 5. Collect evidence
  const evidence: EvidenceItem[] = [
    ...trend.reasons.map((r) => ({ type: "htf_bias" as const, weight: WEIGHTS.trendAlignment, description: r, data: {} })),
    ...entry.reasons.map((r) => ({ type: "zone" as const, weight: WEIGHTS.entryQuality, description: r, data: {} })),
    ...risk.reasons.map((r) => ({ type: "risk" as const, weight: WEIGHTS.riskQuality, description: r, data: {} })),
    ...confirmation.reasons.map((r) => ({ type: "session" as const, weight: WEIGHTS.confirmation, description: r, data: {} })),
  ];

  // Add explicit OTE evidence when confluence exists.
  if (ctx.pricing?.inOte && zoneOverlapsOte(entry.entryZone ?? null, ctx.pricing)) {
    evidence.push({
      type: "ote",
      weight: WEIGHTS.entryQuality,
      description: `OTE ${ctx.pricing.dynamicOteSource ?? ""} band overlaps entry zone`,
      data: {
        oteLow: ctx.pricing.oteLow,
        oteHigh: ctx.pricing.oteHigh,
        source: ctx.pricing.dynamicOteSource,
        quality: ctx.pricing.dynamicOteQuality,
      },
    });
  }

  ctx.evidence = evidence;
  ctx.warnings = runSoftRules(ctx);

  const status: SetupStatus =
    grade === "BLOCK" ? "blocked" : grade === "A+" || grade === "A" ? "ready" : "waiting";

  return {
    symbol: ctx.symbol,
    tf: ctx.tf,
    timestamp: ctx.asOf.toISOString(),
    grade,
    direction: ctx.direction,
    confidence,
    entryZone: entry.entryZone ?? null,
    stopLoss: risk.stopLoss ?? null,
    takeProfit: risk.takeProfit ?? null,
    riskReward: risk.riskReward ?? null,
    status,
    blockReasons: [],
    warnings: ctx.warnings,
    evidence,
    featuresUsed: ctx.featuresUsed,
  };
}

function buildBlockedEvaluation(
  ctx: EvaluationContext,
  blockReasons: string[]
): SetupEvaluation {
  return {
    symbol: ctx.symbol,
    tf: ctx.tf,
    timestamp: ctx.asOf.toISOString(),
    grade: "BLOCK",
    direction: ctx.direction,
    confidence: 0,
    entryZone: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
    status: "blocked",
    blockReasons,
    warnings: runSoftRules(ctx),
    evidence: [],
    featuresUsed: ctx.featuresUsed,
  };
}

const BASE_THRESHOLDS: Record<SetupGrade, number> = {
  "A+": 80,
  A: 65,
  B: 45,
  C: 25,
  BLOCK: 0,
};

async function mapConfidenceToGrade(
  confidence: number,
  ctx: EvaluationContext,
  entryZone: EntryZone | null,
  pool: import("@tm/shared").Queryable
): Promise<SetupGrade> {
  // Legacy HTF opposition can force BLOCK even if confidence is high.
  if (ctx.htfBias && ctx.htfBias.state === "BLOCK" && ctx.htfBias.direction !== "neutral" && ctx.htfBias.direction !== ctx.direction) {
    return "BLOCK";
  }

  // Load per-symbol/timeframe tuning adjustments (cached).
  let thresholds = { ...BASE_THRESHOLDS };
  try {
    const tuning = await getCalibrationTuning(pool, ctx.symbol, ctx.tf);
    for (const row of tuning) {
      if (row.thresholdDelta) {
        thresholds[row.grade] = Math.min(100, Math.max(0, thresholds[row.grade] + row.thresholdDelta));
      }
    }
  } catch {
    // Fail-open: if calibration_tuning is missing, use base thresholds.
  }

  // Clamp high-grade thresholds to the maximum confidence the current grader
  // weights can produce. Otherwise calibration can make A/A+ impossible.
  thresholds["A+"] = Math.min(thresholds["A+"], MAX_ACHIEVABLE_CONFIDENCE);
  thresholds.A = Math.min(thresholds.A, MAX_ACHIEVABLE_CONFIDENCE);

  // A+ requires OTE + fresh, high-quality zone confluence.
  let grade: SetupGrade;
  if (confidence >= thresholds["A+"] && isAPlusEligible(ctx, entryZone)) grade = "A+";
  else if (confidence >= thresholds.A) grade = "A";
  else if (confidence >= thresholds.B) grade = "B";
  else if (confidence >= thresholds.C) grade = "C";
  else grade = "BLOCK";

  // Apply the HTF bias tree cap (Phase 7).
  const treeCap = htfTreeGradeCap(ctx);
  if (treeCap) {
    grade = capGrade(grade, treeCap);
  }

  return grade;
}

/**
 * Evaluate many setups for the same symbol/timeframe in a single batched pass
 * over the feature tables. This avoids the per-signal query storm that made
 * long-range full-mode backtests time out. Results are returned in the same
 * order as the inputs.
 */
export async function evaluateSetupBatch(
  pool: Queryable,
  inputs: EvaluationInput[]
): Promise<SetupEvaluation[]> {
  if (!inputs.length) return [];

  const groups = new Map<
    string,
    { symbol: string; tf: TimeFrame; inputs: EvaluationInput[]; indices: number[] }
  >();
  inputs.forEach((inp, idx) => {
    const symbol = inp.symbol.toUpperCase();
    const tf = inp.tf;
    const key = `${symbol}|${tf}`;
    let g = groups.get(key);
    if (!g) {
      g = { symbol, tf, inputs: [], indices: [] };
      groups.set(key, g);
    }
    g.inputs.push(inp);
    g.indices.push(idx);
  });

  const results: SetupEvaluation[] = new Array(inputs.length);

  for (const g of groups.values()) {
    const asOfs = g.inputs.map((inp) => inp.asOf ?? new Date());
    const directions = g.inputs.map((inp) => inp.direction) as SetupDirection[];
    const minRRs = g.inputs.map((inp) => inp.minRR ?? 2);
    const setupFamilies = g.inputs.map((inp) => inp.setupFamily);
    const strategyIds = g.inputs.map((inp) => inp.strategyId);
    const familyIds = g.inputs.map((inp) => inp.familyId);
    const signalSources = g.inputs.map((inp) => inp.signalSource);
    const signalZones = g.inputs.map((inp) => inp.signalZone);
    const backtest = g.inputs[0].backtest;

    const contexts = await buildContextBatch(pool, g.symbol, g.tf, asOfs, {
      directions,
      minRRs,
      setupFamilies,
      strategyIds,
      familyIds,
      signalSources,
      signalZones,
      backtest,
    });

    for (let i = 0; i < g.inputs.length; i++) {
      const ctx = contexts[i];
      results[g.indices[i]] = await finalizeSetup(pool, ctx);
    }
  }

  return results;
}
