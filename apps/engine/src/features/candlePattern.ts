/**
 * Candlestick Pattern Detection feature.
 * Detects common patterns: engulfing, pin bar, hammer, doji, etc.
 */

import type { Candle, FeatureDefinition, CandlePatternOutput } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface CandlePatternInput {
  candles: Candle[];
}

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

function detectPatterns(candles: Candle[]): CandlePatternOutput["patterns"] {
  const patterns: CandlePatternOutput["patterns"] = [];
  if (candles.length < 3) return patterns;

  const patternLookbackBars = parseInt(process.env.CANDLE_PATTERN_LOOKBACK_BARS ?? "3", 10);
  const minConfidence = parseFloat(process.env.CANDLE_PATTERN_MIN_CONFIDENCE ?? "0.5");
  const minBodyPctOfAtr = parseFloat(process.env.CANDLE_PATTERN_MIN_BODY_PCT_OF_ATR ?? "0");

  // Compute ATR for normalization
  let atr = 0;
  for (let i = candles.length - 14; i < candles.length; i++) {
    if (i <= 0) continue;
    const curr = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(curr.h - curr.l, Math.abs(curr.h - prev.c), Math.abs(curr.l - prev.c));
    atr += tr;
  }
  atr = atr / Math.min(14, candles.length - 1);
  if (atr === 0) atr = 0.0001;

  const startIndex = Math.max(2, candles.length - patternLookbackBars);
  for (let i = startIndex; i < candles.length; i++) {
    const c0 = candles[i - 2];
    const c1 = candles[i - 1];
    const c2 = candles[i];
    const bs = bodySize(c2);
    const range = totalRange(c2);
    const bodyPct = range > 0 ? bs / range : 0;
    const upperShadow = isBullish(c2) ? c2.h - c2.c : c2.h - c2.o;
    const lowerShadow = isBullish(c2) ? c2.o - c2.l : c2.c - c2.l;
    const shadowPct = range > 0 ? (upperShadow + lowerShadow) / range : 0;

    // Engulfing
    if (isBullish(c2) && isBearish(c1) && c2.o < c1.c && c2.c > c1.o) {
      patterns.push({
        patternName: "engulfing_bull",
        direction: "bullish",
        confidence: 0.8,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }
    if (isBearish(c2) && isBullish(c1) && c2.o > c1.c && c2.c < c1.o) {
      patterns.push({
        patternName: "engulfing_bear",
        direction: "bearish",
        confidence: 0.8,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Pin bar / Hammer / Hanging man (long shadow, small body at one end)
    if (bs / range < 0.3) {
      if (lowerShadow > upperShadow * 2 && lowerShadow > bs * 2) {
        const isAfterDowntrend = c1.c < c0.c;
        patterns.push({
          patternName: isAfterDowntrend ? "hammer" : "pin_bar",
          direction: "bullish",
          confidence: isAfterDowntrend ? 0.75 : 0.6,
          ts: c2.ts,
          bodyPctOfAtr: bs / atr,
          shadowPctOfAtr: shadowPct,
        });
      }
      if (upperShadow > lowerShadow * 2 && upperShadow > bs * 2) {
        const isAfterUptrend = c1.c > c0.c;
        patterns.push({
          patternName: isAfterUptrend ? "hanging_man" : "pin_bar",
          direction: "bearish",
          confidence: isAfterUptrend ? 0.75 : 0.6,
          ts: c2.ts,
          bodyPctOfAtr: bs / atr,
          shadowPctOfAtr: shadowPct,
        });
      }
    }

    // Doji (very small body)
    if (bs / range < 0.1 && range > atr * 0.1) {
      patterns.push({
        patternName: "doji",
        direction: "neutral",
        confidence: 0.5,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Three White Soldiers
    if (
      isBullish(c0) &&
      isBullish(c1) &&
      isBullish(c2) &&
      c0.c > c0.o &&
      c1.c > c1.o &&
      c2.c > c2.o &&
      c1.c > c0.c &&
      c2.c > c1.c &&
      bodySize(c0) / totalRange(c0) > 0.5 &&
      bodySize(c1) / totalRange(c1) > 0.5 &&
      bodySize(c2) / totalRange(c2) > 0.5
    ) {
      patterns.push({
        patternName: "three_white_soldiers",
        direction: "bullish",
        confidence: 0.85,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Three Black Crows
    if (
      isBearish(c0) &&
      isBearish(c1) &&
      isBearish(c2) &&
      c0.c < c0.o &&
      c1.c < c1.o &&
      c2.c < c2.o &&
      c1.c < c0.c &&
      c2.c < c1.c &&
      bodySize(c0) / totalRange(c0) > 0.5 &&
      bodySize(c1) / totalRange(c1) > 0.5 &&
      bodySize(c2) / totalRange(c2) > 0.5
    ) {
      patterns.push({
        patternName: "three_black_crows",
        direction: "bearish",
        confidence: 0.85,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Morning Star (bearish -> small body -> bullish)
    if (
      isBearish(c0) &&
      bodySize(c1) / totalRange(c1) < 0.3 &&
      isBullish(c2) &&
      c2.c > (c0.o + c0.c) / 2
    ) {
      patterns.push({
        patternName: "morning_star",
        direction: "bullish",
        confidence: 0.8,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Evening Star (bullish -> small body -> bearish)
    if (
      isBullish(c0) &&
      bodySize(c1) / totalRange(c1) < 0.3 &&
      isBearish(c2) &&
      c2.c < (c0.o + c0.c) / 2
    ) {
      patterns.push({
        patternName: "evening_star",
        direction: "bearish",
        confidence: 0.8,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
      });
    }

    // Wick-close / liquidity sweep confirmation
    const recentLows = Math.min(...candles.slice(Math.max(0, i - 3), i).map((c) => c.l));
    const recentHighs = Math.max(...candles.slice(Math.max(0, i - 3), i).map((c) => c.h));

    const lowerWick = isBullish(c2) ? c2.o - c2.l : c2.c - c2.l;
    const upperWick = isBullish(c2) ? c2.h - c2.c : c2.h - c2.o;

    if (
      lowerWick > bs * 2 &&
      lowerWick > atr * 0.4 &&
      c2.l < recentLows &&
      c2.c > c2.o &&
      c2.c > c1.c
    ) {
      patterns.push({
        patternName: "wick_close_bull",
        direction: "bullish",
        confidence: 0.75,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
        isWickClose: true,
      });
    }

    if (
      upperWick > bs * 2 &&
      upperWick > atr * 0.4 &&
      c2.h > recentHighs &&
      c2.c < c2.o &&
      c2.c < c1.c
    ) {
      patterns.push({
        patternName: "wick_close_bear",
        direction: "bearish",
        confidence: 0.75,
        ts: c2.ts,
        bodyPctOfAtr: bs / atr,
        shadowPctOfAtr: shadowPct,
        isWickClose: true,
      });
    }
  }

  return patterns.filter(
    (p) =>
      (p.confidence ?? 0) >= minConfidence &&
      (p.bodyPctOfAtr ?? 0) >= minBodyPctOfAtr
  );
}

export const candlePatternFeature: FeatureDefinition<CandlePatternInput, CandlePatternOutput> = {
  name: "features_candle_pattern",
  version: "1.4.0",
  dependencies: [],

  compute(input): CandlePatternOutput {
    return { patterns: detectPatterns(input.candles) };
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
      confidence: p.confidence ?? null,
      body_pct_of_atr: p.bodyPctOfAtr ?? null,
      shadow_pct_of_atr: p.shadowPctOfAtr ?? null,
      is_wick_close: p.isWickClose ?? false,
      ts: p.ts,
    }));
  },

  deserialize(rows): CandlePatternOutput {
    return {
      patterns: rows.map((r) => ({
        patternName: r.pattern_name as string,
        direction: r.direction as CandlePatternOutput["patterns"][number]["direction"],
        confidence: r.confidence as number | undefined,
        bodyPctOfAtr: r.body_pct_of_atr as number | undefined,
        shadowPctOfAtr: r.shadow_pct_of_atr as number | undefined,
        isWickClose: r.is_wick_close as boolean | undefined,
        ts: new Date(r.ts as string),
      })),
    };
  },
};
