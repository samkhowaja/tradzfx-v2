import type { EvaluationContext, GraderResult } from "../types";

export function gradeConfirmation(ctx: EvaluationContext): GraderResult {
  const reasons: string[] = [];
  let score = 0;

  // Session timing
  if (ctx.sessionProfile?.killzone) {
    score += 25;
    reasons.push(`Active session: ${ctx.sessionProfile.name}`);
  } else if (ctx.sessionProfile?.name) {
    score += 8;
    reasons.push(`Session ${ctx.sessionProfile.name} is not a killzone`);
  } else {
    reasons.push("No session information available");
  }

  // Spread sanity
  if (ctx.spreadPips <= ctx.maxAllowedSpreadPips * 0.5) {
    score += 25;
    reasons.push(`Spread ${ctx.spreadPips.toFixed(1)}p is healthy`);
  } else if (ctx.spreadPips <= ctx.maxAllowedSpreadPips) {
    score += 12;
    reasons.push(`Spread ${ctx.spreadPips.toFixed(1)}p is acceptable`);
  } else {
    reasons.push(`Spread ${ctx.spreadPips.toFixed(1)}p exceeds threshold`);
  }

  // ATR vs volatility regime
  // NOTE: contextBuilder stores the regime under `regime`, not `state`.
  const regime = ctx.volatility?.regime;
  if (regime) {
    if (regime === "normal") {
      score += 20;
      reasons.push("Volatility regime normal");
    } else if (regime === "low") {
      score += 10;
      reasons.push("Low volatility — reduce size");
    } else if (regime === "high") {
      score += 5;
      reasons.push("High volatility — wider stops required");
    }
  }

  score = Math.min(100, Math.max(0, score));
  return { score, reasons, entryZone: null };
}
