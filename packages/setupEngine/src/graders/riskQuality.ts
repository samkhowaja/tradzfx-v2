import type { EvaluationContext, GraderResult } from "../types";
import { getPipSizeForSymbol } from "@tm/shared";
import { computeStopLoss, computeTarget } from "@tm/levels";

export async function gradeRiskQuality(ctx: EvaluationContext): Promise<GraderResult> {
  const reasons: string[] = [];

  const price = ctx.latestCandle?.c;
  const atr = ctx.atr;
  const spreadPips = ctx.spreadPips;
  const zone = ctx.entryZone;

  if (!price || !zone) {
    return { score: 0, reasons: ["No price or entry zone"], stopLoss: null, takeProfit: null, riskReward: null };
  }

  const pipSize = getPipSizeForSymbol(ctx.symbol);
  const spreadPrice = spreadPips * pipSize;

  // Neutral setups are blocked by hard rules before this grader runs.
  const side = ctx.direction as "long" | "short";

  // Build the level-context used by the structural SL/TP helpers.
  const levelCtx = {
    pool: ctx.pool,
    symbol: ctx.symbol,
    tf: ctx.tf,
    direction: side,
    entryPrice: price,
    minRR: ctx.minRR,
    maxSlDistance: ctx.maxStopPips * pipSize,
    asOf: ctx.asOf,
  };

  // 1. Structural stop loss, then add spread buffer so the effective SL is
  // placed beyond the spread (worse fill for the trader).
  const fallbackDistance = atr * 1.0;
  let slResult;
  try {
    slResult = await computeStopLoss(levelCtx, fallbackDistance);
  } catch (err: any) {
    reasons.push(`Stop-loss computation failed: ${err.message}`);
    slResult = null;
  }

  let stopLoss = slResult?.price ?? (ctx.direction === "long" ? price - fallbackDistance : price + fallbackDistance);
  stopLoss = ctx.direction === "long" ? stopLoss - spreadPrice : stopLoss + spreadPrice;

  // 2. Structural take-profit. Falls back to fixed RR if no structural level
  //    satisfies minRR.
  const fallbackRR = ctx.minRR;
  let tpResult;
  try {
    tpResult = await computeTarget(levelCtx, stopLoss, fallbackRR);
  } catch (err: any) {
    reasons.push(`Target computation failed: ${err.message}`);
    tpResult = null;
  }

  const takeProfit = tpResult?.price ?? (ctx.direction === "long" ? price + fallbackDistance * fallbackRR : price - fallbackDistance * fallbackRR);

  const riskPips = Math.abs(price - stopLoss) / pipSize;
  const rewardPips = Math.abs(takeProfit - price) / pipSize;
  const rr = riskPips > 0 ? rewardPips / riskPips : 0;

  let score = 0;

  if (rr >= 3) {
    score += 40;
    reasons.push(`Risk/reward ${rr.toFixed(1)}:1 (excellent)`);
  } else if (rr >= 2) {
    score += 30;
    reasons.push(`Risk/reward ${rr.toFixed(1)}:1 (good)`);
  } else if (rr >= 1) {
    score += 15;
    reasons.push(`Risk/reward ${rr.toFixed(1)}:1 (acceptable)`);
  } else {
    reasons.push(`Risk/reward ${rr.toFixed(1)}:1 (poor)`);
  }

  if (slResult?.sourceLevel) {
    reasons.push(`Stop placed at structural ${slResult.sourceLevel.kind} level`);
  } else {
    reasons.push(`Stop placed at ATR-based fallback (${fallbackDistance.toFixed(5)} price units)`);
  }

  if (tpResult?.sourceLevel) {
    reasons.push(`Target placed at structural ${tpResult.sourceLevel.kind} level`);
  } else {
    reasons.push(`Target placed at fixed ${fallbackRR}R fallback`);
  }

  if (riskPips > 0 && spreadPips / riskPips < 0.1) {
    score += 20;
    reasons.push("Spread is <10% of stop distance");
  } else if (riskPips > 0) {
    reasons.push("Spread is a large fraction of stop distance");
  }

  if (riskPips <= ctx.maxStopPips) {
    score += 20;
    reasons.push(`Stop ${riskPips.toFixed(1)}p within ${ctx.maxStopPips}p max`);
  } else {
    reasons.push(`Stop ${riskPips.toFixed(1)}p exceeds ${ctx.maxStopPips}p max`);
  }

  score = Math.min(100, Math.max(0, score));
  return {
    score,
    reasons,
    stopLoss,
    takeProfit,
    riskReward: rr,
    stopPips: riskPips,
  };
}
