import { describe, expect, it } from "vitest";
import { compareOldVsNew, type ComparableEvent } from "./diffHarness";
import type { CausalCandle, CausalEvent } from "./causalPrototype";

const candle = (minute: number): CausalCandle => ({
  ts: new Date(Date.UTC(2026, 0, 1, 0, minute)),
  h: 101,
  l: 99,
  c: 100,
});

const oldEvent = (eventTs: Date): ComparableEvent => ({
  identity: "old|h0",
  eventType: "bos",
  direction: "bullish",
  levelId: "h0",
  eventTs,
});

const newEvent = (eventTs: Date, availableAt: Date): CausalEvent => ({
  identity: "EURUSD|1m|h0|bos|bullish",
  eventType: "bos",
  direction: "bullish",
  levelId: "h0",
  level: 100,
  eventTs,
  availableAt,
});

describe("structure diff harness", () => {
  it("classifies shifted event with completed-candle proof as causal correction", () => {
    const oldTs = candle(1).ts;
    const newTs = candle(2).ts;
    const report = compareOldVsNew(
      [oldEvent(oldTs)],
      [newEvent(newTs, candle(3).ts)],
      [candle(2)],
      60_000
    );

    expect(report.timestampShifted).toHaveLength(1);
    expect(report.timestampShifted[0].classification).toBe("CAUSAL_CORRECTION");
  });

  it("classifies added event without completed source candle as potential bug", () => {
    const eventTs = candle(2).ts;
    const report = compareOldVsNew(
      [],
      [newEvent(eventTs, candle(2).ts)],
      [candle(2)],
      60_000
    );

    expect(report.added).toHaveLength(1);
    expect(report.added[0].classification).toBe("POTENTIAL_BUG");
  });

  it("reports removed and identity-changed events separately", () => {
    const eventTs = candle(2).ts;
    const old = { ...oldEvent(eventTs), levelId: "old-level" };
    const replacement = { ...newEvent(eventTs, candle(3).ts), levelId: "new-level" };
    const report = compareOldVsNew([old], [replacement], [candle(2)], 60_000);

    expect(report.removed).toHaveLength(1);
    expect(report.identityChanged).toHaveLength(1);
  });
});
