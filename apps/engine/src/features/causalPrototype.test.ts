import { describe, expect, it } from "vitest";
import { classifyPivotScale, createCausalState, detectCausal, MAX_ACTIVE_LEVELS_PER_KIND, type CausalCandle, type CausalPivot } from "./causalPrototype";

const D = 60_000;
const t = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
const candle = (minute: number, h: number, l: number, c: number): CausalCandle => ({ ts: t(minute), h, l, c });

function pivot(levelId: string, kind: "high" | "low", minute: number, price: number, availableMinute: number): CausalPivot {
  return { levelId, kind, price, centerTs: t(minute), availableAt: t(availableMinute) };
}

describe("causal prototype", () => {
  it("classifies new extremes external and contained swings internal", () => {
    const prior = [pivot("h0", "high", 0, 100, 1), pivot("l0", "low", 0, 50, 1)];
    expect(classifyPivotScale(pivot("h1", "high", 1, 101, 2), prior)).toBe("external");
    expect(classifyPivotScale(pivot("h2", "high", 1, 99, 2), prior)).toBe("internal");
    expect(classifyPivotScale(pivot("l1", "low", 1, 49, 2), prior)).toBe("external");
    expect(classifyPivotScale(pivot("l2", "low", 1, 51, 2), prior)).toBe("internal");
  });

  it("classifies large pivot histories without stack overflow", () => {
    const prior = Array.from({ length: 2000 }, (_, i) => pivot(`h${i}`, "high", i, 100 + i, i + 1));
    expect(classifyPivotScale(pivot("new-high", "high", 2001, 2201, 2002), prior)).toBe("external");
  });

  it("consumes internal break without emitting an event", () => {
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4),
      candles: [candle(1, 10, 8, 9), candle(2, 10, 8, 9.5)],
      pivots: [pivot("h0", "high", 0, 10, 1), pivot("h1", "high", 1, 9, 1)],
    });
    expect(out.events).toHaveLength(0);
    expect(out.state.brokenLevels.has("h1")).toBe(true);
  });

  it("excludes incomplete edge candle", () => {
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(2),
      candles: [candle(0, 10, 8, 9), candle(1, 10, 9, 9), candle(2, 20, 10, 19)],
      pivots: [pivot("h0", "high", 0, 10, 1)],
    });
    expect(out.events).toHaveLength(0);
  });

  it("activates level only after pivot availability", () => {
    const level = pivot("h0", "high", 0, 10, 3);
    const early = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(3),
      candles: [candle(1, 11, 9, 9), candle(2, 12, 10, 9)], pivots: [level],
    });
    expect(early.events).toHaveLength(0);

    const late = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4),
      candles: [candle(1, 11, 9, 9), candle(2, 12, 10, 9), candle(3, 13, 10, 12)], pivots: [level],
    });
    expect(late.events).toHaveLength(1);
    expect(late.events[0].availableAt).toEqual(t(4));
  });

  it("consumes level and suppresses duplicate event", () => {
    const state = createCausalState();
    const input = {
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4),
      candles: [candle(1, 11, 9, 9), candle(2, 12, 10, 9), candle(3, 13, 10, 12)],
      pivots: [pivot("h0", "high", 0, 10, 1)], state,
    };
    expect(detectCausal(input).events).toHaveLength(1);
    expect(detectCausal(input).events).toHaveLength(0);
    expect(state.brokenLevels.has("h0")).toBe(true);
  });

  it("replays deterministically", () => {
    const input = {
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4),
      candles: [candle(1, 11, 9, 11), candle(2, 12, 10, 11), candle(3, 13, 10, 12)],
      pivots: [pivot("h0", "high", 0, 10, 1)],
    };
    const a = detectCausal(input).events;
    const b = detectCausal(input).events;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("does not emit MSS from pivot confirmation alone", () => {
    const level = { ...pivot("h0", "high", 0, 10, 1), confirmationTs: t(2) };
    const early = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(2),
      candles: [candle(1, 10, 9, 9)], pivots: [level],
    });
    expect(early.events).toHaveLength(0);

    const late = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(3),
      candles: [candle(1, 10, 9, 9), candle(2, 10, 9, 9)], pivots: [level],
    });
    expect(late.events).toHaveLength(0);
  });

  it("suppresses opposite break without opposing sweep", () => {
    const state = createCausalState();
    state.trend = "bullish";
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(3), state,
      candles: [candle(1, 11, 9, 9), candle(2, 12, 8, 7)],
      pivots: [pivot("l0", "low", 0, 8, 1)],
    });
    expect(out.events).toHaveLength(0);
    expect(state.brokenLevels.has("l0")).toBe(true);
  });

  it("emits MSS only after opposing liquidity sweep", () => {
    const state = createCausalState();
    state.trend = "bullish";
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4), state,
      candles: [
        candle(1, 11, 7, 7),
      ],
      pivots: [
        pivot("h0", "high", 0, 10, 1),
        pivot("l0", "low", 0, 8, 1),
      ],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].eventType).toBe("mss");
    expect(out.events[0].direction).toBe("bearish");
    expect(out.events[0].availableAt).toEqual(t(2));
  });

  it("does not carry a prior-candle sweep into a later break", () => {
    const state = createCausalState();
    state.trend = "bullish";
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4), state,
      candles: [candle(1, 11, 9, 9), candle(2, 9, 8, 7)],
      pivots: [pivot("h0", "high", 0, 10, 1), pivot("l0", "low", 0, 8, 1)],
    });
    expect(out.events).toHaveLength(0);
  });

  it("deterministically selects earliest swept level when multiple levels sweep on one candle", () => {
    const state = createCausalState();
    state.trend = "bullish";
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(3), state,
      candles: [candle(1, 11, 7, 7)],
      pivots: [
        { ...pivot("H1", "high", 0, 10, 1), scale: "external" },
        { ...pivot("H2", "high", 0, 10.5, 1), scale: "external" },
        { ...pivot("L1", "low", 0, 8, 1), scale: "external" },
      ],
    });
    const mss = out.events.find((event) => event.eventType === "mss");
    expect(mss).toBeDefined();
    expect(mss?.sweptLevel).toBe(10);
    expect(mss?.sweptLevelId).toBe("H1");
    expect(mss?.sweptKind).toBe("high");
  });

  it("sets event availability to later of candle completion and pivot availability", () => {
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(5),
      candles: [candle(1, 11, 9, 12), candle(4, 12, 10, 13)],
      pivots: [pivot("h0", "high", 0, 10, 3)],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].eventTs).toEqual(t(4));
    expect(out.events[0].availableAt).toEqual(t(5));
  });

  it("preserves active levels across gaps without interpolating events", () => {
    const level = pivot("h0", "high", 0, 10, 1);
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: new Date(Date.UTC(2026, 0, 4, 22, 1)),
      candles: [
        { ts: new Date("2026-01-02T22:00:00Z"), h: 10, l: 9, c: 9.5 },
        { ts: new Date("2026-01-04T22:00:00Z"), h: 11, l: 9.5, c: 10.5 },
      ],
      pivots: [{ ...level, availableAt: new Date("2026-01-02T22:01:00Z") }],
    });
    expect(out.events).toHaveLength(1);
    expect(out.events[0].eventTs).toEqual(new Date("2026-01-04T22:00:00Z"));
  });

  it("keeps event availability monotonic", () => {
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(5),
      candles: [candle(1, 11, 9, 12), candle(2, 12, 8, 7), candle(3, 13, 7, 14)],
      pivots: [pivot("h0", "high", 0, 10, 1), pivot("l0", "low", 0, 8, 1)],
    });
    for (let i = 1; i < out.events.length; i++) {
      expect(out.events[i].availableAt.getTime()).toBeGreaterThanOrEqual(out.events[i - 1].availableAt.getTime());
    }
  });

  it("retains confirmed external levels beyond bounded internal retention", () => {
    const pivots = Array.from({ length: MAX_ACTIVE_LEVELS_PER_KIND + 1 }, (_, i) => ({
      ...pivot(`h${i}`, "high", i, 100, 1),
      scale: "external" as const,
      confirmationTs: t(1),
    }));
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(4),
      candles: [candle(2, 100, 99, 99), candle(3, 101, 99, 101)], pivots,
    });
    expect(out.state.brokenLevels.has("h0")).toBe(true);
    expect(out.events.some((event) => event.levelId === "h0" && event.eventType === "bos")).toBe(true);
    expect(out.events.find((event) => event.levelId === "h0")?.availableAt.getTime()).toBeGreaterThanOrEqual(t(1).getTime());
  });

  it("keeps distinct levels with same timestamp or price and deduplicates exact IDs", () => {
    const out = detectCausal({
      symbol: "EURUSD", tf: "1m", tfMs: D, anchorTs: t(3),
      candles: [candle(2, 20, 1, 15)],
      pivots: [
        pivot("same-ts-a", "high", 0, 10, 1),
        pivot("same-ts-b", "high", 0, 11, 1),
        pivot("same-price-later", "high", 1, 10, 1),
        pivot("same-ts-a", "high", 0, 10, 1),
      ],
    });
    expect(out.events).toHaveLength(2);
    expect(new Set(out.events.map((event) => event.levelId)).size).toBe(2);
  });
});
