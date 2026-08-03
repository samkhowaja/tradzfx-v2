import { describe, expect, it } from "vitest";
import type { Candle } from "@tm/shared";
import { buildCausalEqualLevels, buildCausalPdhPdl, detectCausalSweeps, type CausalLevel } from "./causalSweepPrototype";

const t = (value: string) => new Date(`2026-07-28T${value}Z`);
function candle(time: string, high: number, low: number, close: number): Candle {
  return { symbol: "EURUSD", ts: t(time), o: close, h: high, l: low, c: close };
}
function highLevel(confirmation = "10:30:00"): CausalLevel {
  return {
    levelId: "high-1", price: 1.1000, kind: "high", scale: "external",
    confirmationTs: t(confirmation), formedTs: t("10:00:00"), targetType: "swing",
  };
}
function pivot(kind: "high" | "low", time: string, price: number, confirmation: string) {
  return { kind, ts: t(time), price, confidence: 1, confirmationTs: t(confirmation) };
}

describe("causal sweep prototype", () => {
  it("builds equal levels with latest confirmation activation", () => {
    const levels = buildCausalEqualLevels([
      pivot("high", "09:00:00", 1.1000, "09:30:00"),
      pivot("high", "10:00:00", 1.10005, "10:30:00"),
    ], 0.0001);
    expect(levels).toHaveLength(1);
    expect(levels[0].price).toBeCloseTo(1.100025, 8);
    expect(levels[0].confirmationTs).toEqual(t("10:30:00"));
    expect(levels[0].targetType).toBe("equal_high");
  });

  it("builds prior-day levels at UTC day start", () => {
    const levels = buildCausalPdhPdl([
      candle("23:55:00", 1.1050, 1.0950, 1.1000),
      { ...candle("00:05:00", 1.1030, 1.0970, 1.1000), ts: new Date("2026-07-29T00:05:00Z") },
    ]);
    expect(levels).toHaveLength(2);
    expect(levels.map((level) => level.targetType)).toEqual(["pdh", "pdl"]);
    expect(levels[0].confirmationTs).toEqual(new Date("2026-07-29T00:00:00Z"));
    expect(levels[0].price).toBe(1.1050);
    expect(levels[1].price).toBe(1.0950);
  });

  it("does not sweep unconfirmed pivot level", () => {
    const events = detectCausalSweeps(
      [candle("10:15:00", 1.1010, 1.0990, 1.1005), candle("10:20:00", 1.1005, 1.0990, 1.0995)],
      [highLevel()], { tf: "5m" },
    );
    expect(events).toHaveLength(0);
  });

  it("sweeps confirmed pivot after close-back", () => {
    const events = detectCausalSweeps(
      [candle("10:35:00", 1.1010, 1.0990, 1.1005), candle("10:40:00", 1.1005, 1.0990, 1.0995)],
      [highLevel()], { tf: "5m" },
    );
    expect(events).toHaveLength(1);
    expect(events[0].sweepTs).toEqual(t("10:35:00"));
    expect(events[0].closeBackTs).toEqual(t("10:40:00"));
    expect(events[0].availableAtTs).toEqual(t("10:45:00"));
  });

  it("emits one sweep per level", () => {
    const events = detectCausalSweeps(
      [candle("10:35:00", 1.1010, 1.0990, 1.1005), candle("10:40:00", 1.1005, 1.0990, 1.0995), candle("11:00:00", 1.1010, 1.0990, 1.0995)],
      [highLevel()], { tf: "5m" },
    );
    expect(events).toHaveLength(1);
  });

  it("ignores extension without close-back", () => {
    const events = detectCausalSweeps(
      [candle("10:35:00", 1.1010, 1.1000, 1.1005), candle("10:40:00", 1.1010, 1.1000, 1.1005), candle("10:45:00", 1.1010, 1.1000, 1.1005)],
      [highLevel()], { tf: "5m" },
    );
    expect(events).toHaveLength(0);
  });

  it("ignores close-back without prior extension", () => {
    const events = detectCausalSweeps([candle("10:35:00", 1.1005, 1.0990, 1.0995)], [highLevel()], { tf: "5m" });
    expect(events).toHaveLength(0);
  });

  it("ignores extension below the minimum ATR penetration", () => {
    const history = Array.from({ length: 14 }, (_, i) => candle(`10:${String(i).padStart(2, "0")}:00`, 1.1000, 1.0990, 1.0995));
    const events = detectCausalSweeps(
      [...history, candle("10:20:00", 1.10005, 1.0990, 1.10001), candle("10:25:00", 1.1001, 1.0990, 1.0995)],
      [highLevel("10:14:00")], { tf: "5m" },
    );
    expect(events).toHaveLength(0);
  });

  it("keeps availability after confirmation and completed close-back", () => {
    const events = detectCausalSweeps(
      [candle("10:35:00", 1.1010, 1.0990, 1.1005), candle("10:40:00", 1.1005, 1.0990, 1.0995)],
      [highLevel()], { tf: "5m" },
    );
    expect(events[0].availableAtTs.getTime()).toBeGreaterThanOrEqual(t("10:30:00").getTime());
    expect(events[0].availableAtTs.getTime()).toBeGreaterThanOrEqual(t("10:45:00").getTime());
  });
});
