/**
 * Tests for push-pull pattern detection.
 *
 * Synthetic candle arrays exercise each pattern variant:
 *   push_pull, push_pull_reversal, push_pull_doji,
 *   push_pull_after_pullback, push_pull_multi
 */

import { describe, it, expect } from "vitest";
import type { Candle } from "@tm/shared";
import { pushPullFeature } from "./pushPull";

/** Helper: build a Candle from OHLC and ts offset. */
function c(
  o: number, h: number, l: number, c_: number,
  idx: number,
  baseTs = new Date("2025-01-01T00:00:00Z"),
): Candle {
  return {
    ts: new Date(baseTs.getTime() + idx * 60_000),
    o, h, l, c: c_,
    v: 1000,
    symbol: "XAUUSD",
    tf: "5m",
    spread: 0,
    broker: "MT5",
  };
}

/** Build a run of N bullish candles (closes step up). */
function bullRun(startPrice: number, count: number, step: number, startIdx: number): Candle[] {
  const out: Candle[] = [];
  let prev = startPrice;
  for (let i = 0; i < count; i++) {
    const open = prev;
    const close = prev + step;
    const high = Math.max(open, close) + step * 0.3;
    const low = Math.min(open, close) - step * 0.1;
    out.push(c(open, high, low, close, startIdx + i));
    prev = close;
  }
  return out;
}

/** Build a run of N bearish candles (closes step down). */
function bearRun(startPrice: number, count: number, step: number, startIdx: number): Candle[] {
  const out: Candle[] = [];
  let prev = startPrice;
  for (let i = 0; i < count; i++) {
    const open = prev;
    const close = prev - step;
    const high = Math.max(open, close) + step * 0.1;
    const low = Math.min(open, close) - step * 0.3;
    out.push(c(open, high, low, close, startIdx + i));
    prev = close;
  }
  return out;
}

/** Build 1 bearish pullback candle. */
function bearPull(open: number, step: number, idx: number): Candle {
  const close = open - step;
  return c(open, open + step * 0.05, close - step * 0.1, close, idx);
}

/** Build 1 bullish pullback candle. */
function bullPull(open: number, step: number, idx: number): Candle {
  const close = open + step;
  return c(open, close + step * 0.1, open - step * 0.05, close, idx);
}

/**
 * Helper: compute push-pull patterns for a complete candle array.
 * Calls compute directly (no DB, no DAG).
 */
function detect(candles: Candle[]) {
  const result = pushPullFeature.compute({ candles });
  return result.patterns;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("pushPullFeature", () => {
  describe("bullish push_pull (standard 2-push, 1-pull)", () => {
    it("detects bullish push-pull", () => {
      // 4 noise → 2 push (bull) → 1 pull (bear) → entry trigger (bull breakout)
      const candles: Candle[] = [
        // Noise
        c(100.0, 100.5, 99.8, 100.2, 0),
        c(100.2, 100.6, 99.9, 100.3, 1),
        c(100.3, 100.7, 100.0, 100.4, 2),
        c(100.4, 100.8, 100.1, 100.5, 3),
        // Push phase: 2 bullish candles
        c(100.5, 101.5, 100.4, 101.3, 4),
        c(101.3, 102.0, 101.0, 101.8, 5),
        // Pull phase: 1 bearish candle (retraces into first push close)
        c(101.8, 101.9, 100.8, 101.0, 6),
        // Entry trigger: bullish breakout
        c(101.0, 102.5, 100.9, 102.3, 7),
      ];

      const patterns = detect(candles);
      expect(patterns.length).toBeGreaterThanOrEqual(1);

      const pp = patterns.find((p) => p.patternName === "push_pull");
      expect(pp).toBeDefined();
      expect(pp!.direction).toBe("bullish");
      expect(pp!.pushCount).toBeGreaterThanOrEqual(1);
      expect(pp!.pullCount).toBeGreaterThanOrEqual(1);
      expect(pp!.pushPullLevel).toBeGreaterThan(0);
      expect(pp!.confidence).toBeGreaterThan(0);
    });

    it("does not detect when no pullback exists", () => {
      // All bullish → no pullback → no push-pull
      const candles: Candle[] = [];
      for (let i = 0; i < 10; i++) {
        candles.push(c(100 + i * 0.5, 101 + i * 0.5, 99.5 + i * 0.5, 100.5 + i * 0.5, i));
      }

      const patterns = detect(candles);
      const pp = patterns.find((p) => p.patternName === "push_pull");
      expect(pp).toBeUndefined();
    });
  });

  describe("bearish push_pull", () => {
    it("detects bearish push-pull", () => {
      // Noise → 2 push (bear) → 1 pull (bull) → entry trigger (bear breakout)
      const candles: Candle[] = [
        c(100.0, 100.5, 99.5, 99.8, 0),
        c(99.8, 100.3, 99.3, 99.6, 1),
        c(99.6, 100.1, 99.1, 99.4, 2),
        c(99.4, 99.9, 99.0, 99.3, 3),
        // Push: 2 bearish
        c(99.3, 99.5, 98.0, 98.5, 4),
        c(98.5, 98.7, 97.5, 97.8, 5),
        // Pull: 1 bullish retrace
        c(97.8, 99.0, 97.6, 98.7, 6),
        // Entry: bearish breakout
        c(98.7, 98.9, 97.0, 97.3, 7),
      ];

      const patterns = detect(candles);
      const pp = patterns.find((p) => p.patternName === "push_pull");
      expect(pp).toBeDefined();
      expect(pp!.direction).toBe("bearish");
      expect(pp!.pushCount).toBeGreaterThanOrEqual(1);
      expect(pp!.pullCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("push_pull_multi (3+ push candles)", () => {
    it("detects multi-candle push", () => {
      // 4 noise → 3 push (bull, strong bodies) → 1 pull → entry
      const candles: Candle[] = [
        c(100.0, 100.5, 99.5, 100.2, 0),
        c(100.2, 100.6, 99.8, 100.3, 1),
        c(100.3, 100.7, 100.0, 100.4, 2),
        c(100.4, 100.8, 100.1, 100.5, 3),
        // Push 1: strong body
        c(100.5, 102.0, 100.3, 101.7, 4),
        // Push 2: even stronger
        c(101.7, 103.5, 101.5, 103.2, 5),
        // Push 3: strong
        c(103.2, 105.0, 103.0, 104.7, 6),
        // Pull: bearish retrace (must retrace below first push close 101.7)
        c(104.7, 105.0, 100.5, 101.0, 7),
        // Entry: bullish breakout above pull high
        c(101.0, 105.5, 100.8, 105.2, 8),
      ];

      const patterns = detect(candles);
      const multi = patterns.find((p) => p.patternName === "push_pull_multi");
      expect(multi).toBeDefined();
      expect(multi!.direction).toBe("bullish");
      expect(multi!.pushCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("push_pull_doji (first push candle is doji)", () => {
    it("detects doji-based push-pull", () => {
      // First push candle has tiny body (doji-like)
      const candles: Candle[] = [
        c(100.0, 100.5, 99.5, 100.2, 0),
        c(100.2, 100.6, 99.8, 100.3, 1),
        c(100.3, 100.7, 100.0, 100.4, 2),
        c(100.4, 100.8, 100.1, 100.5, 3),
        // Push 1: doji (tiny body, wide range)
        c(100.5, 102.0, 100.2, 100.6, 4),
        // Push 2: strong
        c(100.6, 103.0, 100.5, 102.8, 5),
        // Pull
        c(102.8, 103.0, 100.8, 101.2, 6),
        // Entry
        c(101.2, 103.5, 101.0, 103.2, 7),
      ];

      const patterns = detect(candles);
      const doji = patterns.find((p) => p.patternName === "push_pull_doji");
      expect(doji).toBeDefined();
      expect(doji!.direction).toBe("bullish");
    });
  });

  describe("push_pull_after_pullback (first push candle is small-bodied)", () => {
    it("detects after-pullback pattern", () => {
      // First push candle has small body (<35% of range) but not doji
      const candles: Candle[] = [
        c(100.0, 100.5, 99.5, 100.2, 0),
        c(100.2, 100.6, 99.8, 100.3, 1),
        c(100.3, 100.7, 99.9, 100.4, 2),
        c(100.4, 100.8, 100.1, 100.5, 3),
        // Push 1: tiny body relative to range (e.g. long wick)
        c(100.5, 102.5, 100.0, 101.0, 4),
        // Push 2
        c(101.0, 102.8, 100.8, 102.5, 5),
        // Pull
        c(102.5, 102.7, 101.0, 101.5, 6),
        // Entry
        c(101.5, 103.2, 101.3, 103.0, 7),
      ];

      const patterns = detect(candles);
      const afterPull = patterns.find((p) => p.patternName === "push_pull_after_pullback");
      expect(afterPull).toBeDefined();
      expect(afterPull!.direction).toBe("bullish");
    });
  });

  describe("serialize / deserialize round-trip", () => {
    it("round-trips output through serialize + deserialize", () => {
      const input = { candles: [] };
      // Can't test with empty candles (no patterns detected).
      // Instead test the round-trip with a realistic output.
      const output = {
        patterns: [{
          patternName: "push_pull",
          direction: "bullish" as const,
          pushCount: 2,
          pullCount: 1,
          pushStart: 100.5,
          pushEnd: 102.0,
          pullLow: 100.8,
          pullHigh: 101.9,
          pushPullLevel: 101.3,
          confidence: 0.65,
          ts: new Date("2025-01-01T00:08:00Z"),
        }],
      };

      const rows = pushPullFeature.serialize(output);
      expect(rows).toHaveLength(1);
      expect(rows[0].pattern_name).toBe("push_pull");
      expect(rows[0].direction).toBe("bullish");
      expect(rows[0].push_pull_level).toBe(101.3);

      const deserialized = pushPullFeature.deserialize(rows);
      expect(deserialized.patterns[0].patternName).toBe("push_pull");
      expect(deserialized.patterns[0].pushPullLevel).toBe(101.3);
      expect(deserialized.patterns[0].ts).toEqual(new Date("2025-01-01T00:08:00Z"));
    });
  });

  describe("hash determinism", () => {
    it("same input → same hash", () => {
      const input = { candles: [c(100, 101, 99, 100.5, 0), c(100.5, 102, 100, 101, 1)] };
      const h1 = pushPullFeature.hashInput(input);
      const h2 = pushPullFeature.hashInput(input);
      expect(h1).toBe(h2);
    });

    it("different input → different hash", () => {
      const input1 = { candles: [c(100, 101, 99, 100.5, 0)] };
      const input2 = { candles: [c(101, 102, 100, 101.5, 0)] };
      expect(pushPullFeature.hashInput(input1)).not.toBe(pushPullFeature.hashInput(input2));
    });

    it("same output → same hash", () => {
      const out = {
        patterns: [{
          patternName: "push_pull",
          direction: "bullish" as const,
          pushCount: 2,
          pullCount: 1,
          pushStart: 0,
          pushEnd: 0,
          pullLow: 0,
          pullHigh: 0,
          pushPullLevel: 0,
          ts: new Date("2025-01-01T00:00:00Z"),
        }],
      };
      expect(pushPullFeature.hashOutput(out)).toBe(pushPullFeature.hashOutput(out));
    });
  });
});
