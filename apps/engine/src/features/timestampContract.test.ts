import { describe, expect, it } from "vitest";
import type { Candle, Queryable } from "@tm/shared";
import { getRecentCandles } from "@tm/shared";
import { pivotFeature } from "./pivot";

function candle(minute: number): Candle {
  const ts = new Date(Date.UTC(2026, 6, 30, 10, minute));
  return { symbol: "EURUSD", ts, o: 1, h: 1.1, l: 0.9, c: 1.05 };
}

describe("CANDLE_TIMESTAMP_SEMANTICS", () => {
  it("treats candle ts as bar start and completion at ts plus timeframe duration", () => {
    const start = new Date("2026-07-30T10:00:00.000Z");
    expect(start.getTime() + 300_000).toBe(new Date("2026-07-30T10:05:00.000Z").getTime());
  });

  it("pivot confirmation uses actual right-side candle plus timeframe duration", () => {
    const candles = Array.from({ length: 17 }, (_, index) => ({
      ...candle(index),
      h: index === 8 ? 2 : 1.1,
      l: index === 8 ? 0.5 : 0.9,
    }));
    const result = pivotFeature.compute({ candles }, { tf: "5m" });
    const pivot = result.pivots.find((candidate) => candidate.ts.getUTCMinutes() === 8);

    expect(pivot).toBeDefined();
    expect(pivot.confirmationTs.getTime()).toBeGreaterThan(pivot.ts.getTime());
  });

  it("getRecentCandles excludes incomplete edge candle", async () => {
    const pool: Queryable = {
      query: async (_text: string, params?: unknown[]) => {
        expect(params?.[1]).toEqual(new Date("2026-07-30T10:00:00.000Z"));
        return { rows: [candle(0)] };
      },
    };

    const rows = await getRecentCandles(
      pool,
      "EURUSD",
      "5m",
      new Date("2026-07-30T10:05:00.000Z"),
      1,
      { allowRealtimeFallback: false },
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].ts).toEqual(new Date("2026-07-30T10:00:00.000Z"));
  });
});
