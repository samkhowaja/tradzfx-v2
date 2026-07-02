import type { EvaluationContext, GraderResult } from "../types";

export function gradeTrendAlignment(ctx: EvaluationContext): GraderResult {
  const reasons: string[] = [];

  const htf = ctx.htfBias;
  const bias = ctx.bias;
  const price = ctx.latestCandle?.c;

  if (!htf || !price) {
    return { score: 0, reasons: ["Missing HTF bias or price"], entryZone: null };
  }

  const htfAgrees = htf.direction === ctx.direction;
  const biasAgrees = bias ? bias.direction === ctx.direction || bias.direction === "neutral" : true;

  let score = 0;

  if (htfAgrees && htf.strength === "strong") {
    score += 40;
    reasons.push(`Strong ${htf.direction} HTF bias confirms ${ctx.direction}`);
  } else if (htfAgrees && htf.strength === "moderate") {
    score += 30;
    reasons.push(`Moderate ${htf.direction} HTF bias aligns with ${ctx.direction}`);
  } else if (htfAgrees && htf.strength === "weak") {
    score += 15;
    reasons.push(`Weak ${htf.direction} HTF bias aligns with ${ctx.direction}`);
  } else if (!htfAgrees) {
    reasons.push(`HTF bias (${htf.direction}) opposes ${ctx.direction} setup`);
  }

  if (biasAgrees && bias && bias.strength === "strong") {
    score += 20;
    reasons.push(`Strong ${bias.direction} LTF bias supports setup`);
  } else if (biasAgrees && bias && bias.strength === "moderate") {
    score += 12;
    reasons.push(`Moderate ${bias.direction} LTF bias supports setup`);
  } else if (bias && !biasAgrees) {
    reasons.push(`LTF bias (${bias.direction}) opposes setup`);
  }

  // Limit to 0-100
  score = Math.min(100, Math.max(0, score));
  return { score, reasons, entryZone: null };
}
