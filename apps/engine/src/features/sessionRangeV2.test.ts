import { describe, expect, it } from "vitest";
import type { Candle } from "@tm/shared";
import { computeSessionRanges } from "./sessionRangeV2";

function candle(ts: string, o: number, h: number, l: number, c: number): Candle {
  return { symbol: "XAUUSD", ts: new Date(ts), o, h, l, c };
}

describe("session range v2", () => {
  it("exposes only completed candles and explicit evolving knowledge time", () => {
    const result = computeSessionRanges({ candles: [
      candle("2026-07-15T12:00:00Z", 10, 12, 9, 11),
      candle("2026-07-15T12:05:00Z", 11, 14, 10, 13),
      candle("2026-07-15T12:10:00Z", 13, 20, 8, 15),
    ] }, "XAUUSD", "5m", new Date("2026-07-15T12:10:00Z"));
    const ny = result.ranges.find(r => r.sessionId === "NY_KILLZONE");
    expect(ny).toBeDefined();
    expect(ny?.asOfTs.toISOString()).toBe("2026-07-15T12:10:00.000Z");
    expect(ny?.high).toBe(14);
    expect(ny?.low).toBe(9);
    expect(ny?.isComplete).toBe(false);
    expect(ny?.completedAt).toBeNull();
  });

  it("marks final state complete only at scheduled exclusive end", () => {
    const candles: Candle[] = [];
    for (let minute = 0; minute < 180; minute += 5) {
      const ts = new Date(Date.parse("2026-07-15T12:00:00Z") + minute * 60_000);
      candles.push(candle(ts.toISOString(), 10, 11, 9, 10));
    }
    const result = computeSessionRanges({ candles }, "XAUUSD", "5m", new Date("2026-07-15T15:00:00Z"));
    const ny = result.ranges.find(r => r.sessionId === "NY_KILLZONE");
    expect(ny?.isComplete).toBe(true);
    expect(ny?.completedAt?.toISOString()).toBe("2026-07-15T15:00:00.000Z");
    expect(ny?.coverageRatio).toBe(1);
  });
});
