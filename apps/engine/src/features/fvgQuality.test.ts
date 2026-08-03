import { describe, expect, it } from "vitest";
import { computeCandleOnlyFvgQuality } from "./fvgQuality";
import type { Candle, ZoneOutput } from "@tm/shared";

const candles: Candle[] = [
  { symbol: "EURUSD", ts: new Date("2026-01-01T00:00:00Z"), o: 1, h: 1.1, l: 0.9, c: 1 },
  { symbol: "EURUSD", ts: new Date("2026-01-01T00:01:00Z"), o: 1, h: 1.2, l: 0.95, c: 1.15 },
];
function zone(overrides: Partial<ZoneOutput["zones"][number]> = {}): ZoneOutput["zones"][number] {
  return { zoneKind: "fvg", direction: "bullish", top: 1.2, bottom: 1.1, ts: candles[1].ts, gapAtrRatio: 1, middleBodyRatio: 1, middleBodyVsAverage: 1, gapSize: 0.1, directionAligned: false, ...overrides };
}

describe("candle-only FVG quality", () => {
  it("stays within 0-100", () => expect(computeCandleOnlyFvgQuality({ zone: zone({ gapAtrRatio: 99 }), htfCandles: candles, session: "london", tf: "5m" }).score).toBeLessThanOrEqual(100));
  it("increases with gap ratio", () => expect(computeCandleOnlyFvgQuality({ zone: zone({ gapAtrRatio: 2 }), htfCandles: candles, session: "london", tf: "5m" }).score).toBeGreaterThan(computeCandleOnlyFvgQuality({ zone: zone({ gapAtrRatio: 0.5 }), htfCandles: candles, session: "london", tf: "5m" }).score));
  it("applies direction bonus and Asia LTF penalty", () => {
    const result = computeCandleOnlyFvgQuality({ zone: zone({ directionAligned: true }), htfCandles: candles, session: "asia", tf: "5m", minScore: 90 });
    expect(result.components.direction).toBe(15);
    expect(result.eligible).toBe(false);
  });
  it("rejects wide spread and volatility spike", () => {
    expect(computeCandleOnlyFvgQuality({ zone: zone(), htfCandles: candles, session: "london", tf: "1h", atr: 1, spread: 0.06 }).reason).toBe("spread_too_wide");
    expect(computeCandleOnlyFvgQuality({ zone: zone(), htfCandles: candles, session: "london", tf: "1h", atrPercentile: 0.91 }).reason).toBe("volatility_spike");
  });
});
