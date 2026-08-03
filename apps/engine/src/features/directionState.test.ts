import { describe, it, expect } from "vitest";
import { reconcileDirection } from "./directionState";
import type { RegimeBiasOutput, HtfBiasOutput } from "@tm/shared";

function bias(direction: "bullish" | "bearish" | "neutral", regime: RegimeBiasOutput["regime"] = "trending", confidence = 0.8): RegimeBiasOutput {
  return {
    direction,
    confidence,
    regime,
    score: { htfAlignment: 0, hhhl: 0, structure: 0, emaSlope: 0, volume: 0, session: 0, volatility: 0 },
    reason: "test",
    factors: [],
  };
}
function htf(direction: "bullish" | "bearish" | "neutral", state: HtfBiasOutput["state"] = "SOFT_WARN", confidence = 0.7): HtfBiasOutput {
  return { direction, confidence, state, score: 0, reason: "test" };
}

describe("reconcileDirection (Direction Arbiter)", () => {
  it("agree bullish -> bullish, regime carried, confidence=max", () => {
    const r = reconcileDirection(bias("bullish", "trending", 0.8), htf("bullish", "READY", 0.6));
    expect(r.direction).toBe("bullish");
    expect(r.agreement).toBe(true);
    expect(r.regime).toBe("trending");
    expect(r.confidence).toBeCloseTo(0.8);
    expect(r.reason).toMatch(/agree bullish/);
  });

  it("agree bearish -> bearish", () => {
    const r = reconcileDirection(bias("bearish", "low_volatility", 0.5), htf("bearish", "SOFT_WARN", 0.9));
    expect(r.direction).toBe("bearish");
    expect(r.agreement).toBe(true);
    expect(r.regime).toBe("low_volatility");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("disagree (both non-neutral, not READY) -> neutral, regime forced ranging", () => {
    const r = reconcileDirection(bias("bullish", "trending", 0.8), htf("bearish", "SOFT_WARN", 0.7));
    expect(r.direction).toBe("neutral");
    expect(r.agreement).toBe(false);
    expect(r.regime).toBe("ranging");
    expect(r.confidence).toBeCloseTo(0.7); // min on disagree
    expect(r.reason).toMatch(/disagree/);
  });

  it("HTF READY overrides disagreement -> htf direction", () => {
    const r = reconcileDirection(bias("bullish", "trending", 0.8), htf("bearish", "READY", 0.9));
    expect(r.direction).toBe("bearish");
    expect(r.agreement).toBe(false);
    expect(r.regime).toBe("ranging");
    expect(r.reason).toMatch(/READY override/);
  });

  it("bias-only (htf neutral) -> bias direction", () => {
    const r = reconcileDirection(bias("bullish", "volatile", 0.7), htf("neutral", "BLOCK", 0));
    expect(r.direction).toBe("bullish");
    expect(r.agreement).toBe(false);
    expect(r.reason).toMatch(/bias-only/);
  });

  it("both neutral -> neutral", () => {
    const r = reconcileDirection(bias("neutral"), htf("neutral"));
    expect(r.direction).toBe("neutral");
    expect(r.agreement).toBe(false);
  });

  it("missing inputs -> neutral insufficient", () => {
    expect(reconcileDirection(undefined, htf("bullish")).direction).toBe("neutral");
    expect(reconcileDirection(bias("bullish"), undefined).direction).toBe("neutral");
    expect(reconcileDirection(undefined, undefined).reason).toMatch(/insufficient/);
  });

  it("confidence is clamped to [0,1]", () => {
    const r = reconcileDirection(bias("bullish", "trending", 1.5), htf("bullish", "READY", 2));
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
  });

  it("normalizes legacy 0..100 producer confidence", () => {
    const r = reconcileDirection(bias("bullish", "trending", 70), htf("bullish", "READY", 90));
    expect(r.confidence).toBeCloseTo(0.9);
  });
});
