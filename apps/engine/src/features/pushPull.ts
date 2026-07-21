/**
 * Push-Pull pattern detection (10XROI system).
 *
 * Detects the core pattern from LR Thomas's 10XROI system:
 *   1. Push: 1-3 consecutive same-direction candles with strong bodies
 *      (momentum in trend direction)
 *   2. Pull: 1-2 counter-direction candles that retrace into the first
 *      push candle's close (the "push-pull level")
 *   3. Entry trigger: current candle continues beyond the pullback
 *      extreme in the push direction
 *
 * Variants detected:
 *   - push_pull:        standard 3-candle pattern (push→pull→continue)
 *   - push_pull_multi:  4+ candle push (3+ push, 1 pull, continue)
 *   - push_pull_doji:   1st push candle is a doji (tight retrace)
 *   - push_pull_reversal: push against prior mini-trend, pull retraces
 *                         within ~9 pips of push candle close
 *   - push_pull_after_pullback: push breaks out of a prior pullback,
 *                         pull retraces to the breakout candle close
 */

import type { Candle, FeatureDefinition, PushPullOutput, Direction } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface PushPullInput {
  candles: Candle[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function bodySize(c: Candle): number {
  return Math.abs(c.c - c.o);
}

function totalRange(c: Candle): number {
  return c.h - c.l;
}

function isBullish(c: Candle): boolean {
  return c.c > c.o;
}

function isBearish(c: Candle): boolean {
  return c.c < c.o;
}

function bodyPctOfRange(c: Candle): number {
  const tr = totalRange(c);
  return tr > 0 ? bodySize(c) / tr : 0;
}

/** Is this candle a doji (very small body relative to range)? */
function isDoji(c: Candle): boolean {
  return bodyPctOfRange(c) < 0.15 && totalRange(c) > 0;
}

/** Body size relative to average of prior candles (proxy for strength). */
function bodyRatio(c: Candle, avgBody: number): number {
  return avgBody > 0 ? bodySize(c) / avgBody : 1;
}

// ── Detection ────────────────────────────────────────────────────────────────

function detectPushPull(candles: Candle[]): PushPullOutput["patterns"] {
  const patterns: PushPullOutput["patterns"] = [];
  if (candles.length < 4) return patterns;

  const MAX_PUSH_CANDLES = 4;
  const MAX_PULL_CANDLES = 2;
  const MIN_BODY_RATIO = 0.3;
  const MIN_PIPS_RETRACE = 0.0001;
  const REVERSAL_PIP_TOLERANCE = 0.0009;

  // Scan all input candles for patterns. No artificial LOOKBACK cap —
  // the engine's fetchCandles provides a bounded rolling window (default 500
  // bars), so we scan every bar in that window as a potential entry trigger.
  const startIdx = 4;

  for (let i = startIdx; i < candles.length; i++) {
    const c0 = candles[i]; // current (would-be entry trigger)

    // Compute average body of lookback window
    const lookbackCandles = candles.slice(Math.max(0, i - 10), i);
    const avgBody = lookbackCandles.reduce((s, c) => s + bodySize(c), 0) / Math.max(1, lookbackCandles.length);

    // Detect bullish push-pull: candle must break above prior high
    if (c0.c > c0.o && c0.h > candles[i - 1].h) {
      const result = detectBullishPushPull(candles, i, avgBody, MAX_PUSH_CANDLES, MAX_PULL_CANDLES, MIN_BODY_RATIO, MIN_PIPS_RETRACE, REVERSAL_PIP_TOLERANCE);
      if (result) patterns.push(result);
    }

    // Detect bearish push-pull: candle must break below prior low
    if (c0.c < c0.o && c0.l < candles[i - 1].l) {
      const result = detectBearishPushPull(candles, i, avgBody, MAX_PUSH_CANDLES, MAX_PULL_CANDLES, MIN_BODY_RATIO, MIN_PIPS_RETRACE, REVERSAL_PIP_TOLERANCE);
      if (result) patterns.push(result);
    }
  }

  return patterns;
}

interface PushPullCandidate {
  patternName: string;
  pushCount: number;
  pullCount: number;
  pushStart: number;
  pushEnd: number;
  pullLow: number;
  pullHigh: number;
  pushPullLevel: number;
  confidence: number;
}

/**
 * Scan backward from entryIdx to find bullish push-pull structure:
 *   - c[entryIdx] = entry trigger (breaks above prior high)
 *   - c[entryIdx-1..entryIdx-pullCount] = pull candles (bearish, retrace into push)
 *   - c[entryIdx-pullCount-1..] = push candles (bullish, rising closes)
 */
function detectBullishPushPull(
  candles: Candle[], entryIdx: number, avgBody: number,
  maxPush: number, maxPull: number, minBodyRatio: number,
  minPips: number, revTol: number
): PushPullOutput["patterns"][number] | null {
  const c0 = candles[entryIdx];
  const c1 = candles[entryIdx - 1];

  // Need at least 1 pull candle (can be bearish OR small bullish that retraces)
  let pullCount = 0;
  let pullLow = c1.l;
  let pullHigh = c1.h;

  if (entryIdx - 1 < 0) return null;

  // Count pull candles (up to maxPull)
  for (let j = 1; j <= maxPull; j++) {
    const idx = entryIdx - j;
    if (idx < 0) break;
    const c = candles[idx];
    // A pull candle must NOT break above prior high in same direction
    // (that would be continuation, not pullback)
    // A pull candle must be counter-direction
    if (isBullish(c)) break;
    pullLow = Math.min(pullLow, c.l);
    pullHigh = Math.max(pullHigh, c.h);
    pullCount++;
  }

  if (pullCount === 0) return null;

  // Now scan for push candles BEFORE the pull
  const pushEndIdx = entryIdx - pullCount - 1;
  if (pushEndIdx < 0) return null;

  let pushCount = 0;
  let pushExtreme = -Infinity; // highest high of push
  let pushStart = Infinity; // lowest low of push
  let earliestPushCandle: Candle | null = null;
  let firstPushCandle: Candle | null = null;
  let pushMaxRange = -Infinity;
  const pushCandles: Candle[] = [];

  for (let j = 1; j <= maxPush; j++) {
    const idx = entryIdx - pullCount - j;
    if (idx < 0) break;
    const c = candles[idx];
    if (!isBullish(c)) break;
    // Stop when both body is small AND range is contracted relative to push max range
    // This distinguishes noise (small body + small range) from doji (small body + wide range)
    if (pushCandles.length > 0 && bodySize(c) < avgBody * minBodyRatio && totalRange(c) < pushMaxRange * 0.65) break;
    pushCandles.unshift(c); // prepend so chronological order
    if (firstPushCandle === null) firstPushCandle = c;
    pushMaxRange = Math.max(pushMaxRange, totalRange(c));
    pushExtreme = Math.max(pushExtreme, c.h);
    pushStart = Math.min(pushStart, c.l);
    pushCount++;
  }
  earliestPushCandle = pushCandles.length > 0 ? pushCandles[0] : firstPushCandle;

  if (pushCount < 1) return null;
  if (!firstPushCandle) return null;

  const pushPullLevel = firstPushCandle.c;
  // Use earliest push candle for pattern classification
  const classifierCandle = earliestPushCandle ?? firstPushCandle;

  // The pull must retrace to at or near the first push candle's close
  // (the "push-pull level"). Allow slight overshoot.
  const retraceThreshold = pushPullLevel + (pushExtreme - pushPullLevel) * 0.15;
  const pullDepth = pushPullLevel - pullLow;

  if (pullLow > retraceThreshold && pullDepth < minPips) {
    // Pull didn't retrace enough — may be continuation, not push-pull
    return null;
  }

  // Valid push-pull found. Determine variant.
  let patternName: string;
  let confidence: number;

  // Check for doji variant: first push candle is doji
  if (isDoji(classifierCandle)) {
    patternName = "push_pull_doji";
    confidence = 0.6;
  }
  // Multi-candle push (3+ push candles)
  else if (pushCount >= 3) {
    patternName = "push_pull_multi";
    confidence = 0.7;
  }
  // Check if candle before earliest push was counter-direction (reversal)
  else if (pushEndIdx - pushCount >= 0 && isBearish(candles[pushEndIdx - pushCount])) {
    // Candle before the first push candle was bearish → push reversed mini-trend
    if (Math.abs(pullLow - pushPullLevel) <= revTol) {
      patternName = "push_pull_reversal";
      confidence = 0.65;
    } else {
      patternName = "push_pull";
      confidence = 0.55;
    }
  }
  // After-pullback: check if any push candle has small body relative to range
  else if (pushCandles.some((pc) => bodyPctOfRange(pc) < 0.35)) {
    patternName = "push_pull_after_pullback";
    confidence = 0.6;
  }
  // Standard push-pull
  else {
    patternName = "push_pull";
    confidence = 0.55;
  }

  // Boost confidence if body is very large (strong momentum)
  if (bodyRatio(classifierCandle, avgBody) >= 1.5) {
    confidence = Math.min(confidence + 0.15, 0.95);
  }

  // Reduce confidence if pull retraced too shallow
  const retracePct = pushExtreme > pushStart
    ? (pushExtreme - pullLow) / (pushExtreme - pushStart)
    : 0;
  if (retracePct < 0.2) confidence = Math.max(confidence - 0.15, 0.1);

  return {
    patternName,
    direction: "bullish",
    pushCount,
    pullCount,
    pushStart,
    pushEnd: pushExtreme,
    pullLow,
    pullHigh,
    pushPullLevel,
    confidence,
    ts: c0.ts,
  };
}

/**
 * Bearish mirror of detectBullishPushPull.
 */
function detectBearishPushPull(
  candles: Candle[], entryIdx: number, avgBody: number,
  maxPush: number, maxPull: number, minBodyRatio: number,
  minPips: number, revTol: number
): PushPullOutput["patterns"][number] | null {
  const c0 = candles[entryIdx];
  const c1 = candles[entryIdx - 1];

  if (entryIdx - 1 < 0) return null;

  let pullCount = 0;
  let pullLow = c1.l;
  let pullHigh = c1.h;

  for (let j = 1; j <= maxPull; j++) {
    const idx = entryIdx - j;
    if (idx < 0) break;
    const c = candles[idx];
    if (j === 1) {
      if (isBearish(c) && c.l < candles[entryIdx - 2]?.l && bodySize(c) > avgBody * minBodyRatio) {
        break;
      }
    }
    pullLow = Math.min(pullLow, c.l);
    pullHigh = Math.max(pullHigh, c.h);
    pullCount++;
  }

  if (pullCount === 0) return null;

  const pushEndIdx = entryIdx - pullCount - 1;
  if (pushEndIdx < 0) return null;

  let pushCount = 0;
  let pushStart = Infinity;
  let pushExtreme = Infinity; // lowest low of push
  let firstPushCandle: Candle | null = null;
  let earliestPushCandle: Candle | null = null;
  let pushMinRange = Infinity;
  const pushCandles: Candle[] = [];

  for (let j = 1; j <= maxPush; j++) {
    const idx = entryIdx - pullCount - j;
    if (idx < 0) break;
    const c = candles[idx];
    if (!isBearish(c)) break;
    // Stop when both body is small AND range is contracted relative to push max range
    if (pushCandles.length > 0 && bodySize(c) < avgBody * minBodyRatio && totalRange(c) < pushMinRange * 0.65) break;
    pushCandles.unshift(c);
    if (firstPushCandle === null) firstPushCandle = c;
    pushMinRange = Math.max(pushMinRange, totalRange(c));
    pushExtreme = Math.min(pushExtreme, c.l);
    pushStart = Math.max(pushStart, c.h);
    pushCount++;
  }
  earliestPushCandle = pushCandles.length > 0 ? pushCandles[0] : firstPushCandle;

  if (pushCount < 1) return null;
  if (!firstPushCandle) return null;

  const pushPullLevel = firstPushCandle.c;
  const classifierCandle = earliestPushCandle ?? firstPushCandle;
  const retraceThreshold = pushPullLevel - (pushPullLevel - pushExtreme) * 0.15;
  const pullDepth = pullHigh - pushPullLevel;

  if (pullHigh < retraceThreshold && pullDepth < minPips) {
    return null;
  }

  let patternName: string;
  let confidence: number;

  if (isDoji(classifierCandle)) {
    patternName = "push_pull_doji";
    confidence = 0.6;
  } else if (pushCount >= 3) {
    patternName = "push_pull_multi";
    confidence = 0.7;
  } else if (pushEndIdx - pushCount >= 0 && isBullish(candles[pushEndIdx - pushCount])) {
    if (Math.abs(pullHigh - pushPullLevel) <= revTol) {
      patternName = "push_pull_reversal";
      confidence = 0.65;
    } else {
      patternName = "push_pull";
      confidence = 0.55;
    }
  }
  // After-pullback: check if any push candle has small body relative to range
  else if (pushCandles.some((pc) => bodyPctOfRange(pc) < 0.35)) {
    patternName = "push_pull_after_pullback";
    confidence = 0.6;
  } else {
    patternName = "push_pull";
    confidence = 0.55;
  }

  if (bodyRatio(classifierCandle, avgBody) >= 1.5) {
    confidence = Math.min(confidence + 0.15, 0.95);
  }

  const retracePct = pushStart > pushExtreme
    ? (pullHigh - pushExtreme) / (pushStart - pushExtreme)
    : 0;
  if (retracePct < 0.2) confidence = Math.max(confidence - 0.15, 0.1);

  return {
    patternName,
    direction: "bearish",
    pushCount,
    pullCount,
    pushStart,
    pushEnd: pushExtreme,
    pullLow,
    pullHigh,
    pushPullLevel,
    confidence,
    ts: c0.ts,
  };
}

// ── Feature Definition ───────────────────────────────────────────────────────

export const pushPullFeature: FeatureDefinition<PushPullInput, PushPullOutput> = {
  name: "features_push_pull",
  version: "1.0.0",
  dependencies: [],
  computePolicy: "onEvent",

  compute(input): PushPullOutput {
    return { patterns: detectPushPull(input.candles) };
  },

  hashInput(input): string {
    return sha256(
      input.candles.map((c) => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}:${c.v ?? 0}`).join("|")
    );
  },

  hashOutput(output): string {
    return sha256(
      output.patterns.map((p) => `${p.ts.toISOString()}:${p.patternName}:${p.direction}:${p.confidence}`).join("|")
    );
  },

  serialize(output): Record<string, unknown>[] {
    return output.patterns.map((p) => ({
      pattern_name: p.patternName,
      direction: p.direction,
      push_count: p.pushCount,
      pull_count: p.pullCount,
      push_start: p.pushStart,
      push_end: p.pushEnd,
      pull_low: p.pullLow,
      pull_high: p.pullHigh,
      push_pull_level: p.pushPullLevel,
      confidence: p.confidence ?? null,
      ts: p.ts,
    }));
  },

  deserialize(rows): PushPullOutput {
    return {
      patterns: rows.map((r) => ({
        patternName: r.pattern_name as string,
        direction: r.direction as Direction,
        pushCount: r.push_count as number,
        pullCount: r.pull_count as number,
        pushStart: r.push_start as number,
        pushEnd: r.push_end as number,
        pullLow: r.pull_low as number,
        pullHigh: r.pull_high as number,
        pushPullLevel: r.push_pull_level as number,
        confidence: r.confidence as number | undefined,
        ts: new Date(r.ts as string),
      })),
    };
  },
};
