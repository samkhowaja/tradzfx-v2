import { describe, expect, it } from "vitest";
import { simulateExit, simulateFvgs, type FvgSimulationSetup, type SimulationParams } from "./fvgSimulator";
import type { Candle, ZoneOutput } from "@tm/shared";

const zone: ZoneOutput["zones"][number] = { zoneKind: "fvg", direction: "bullish", top: 110, bottom: 100, ts: new Date("2026-01-01T00:00:00Z") };
const params: SimulationParams = { style: "scalp", entryAt: "mid", stopBufferAtr: 0, targetRs: [2], trailing: false, minQualityScore: 0, spreadGateAtrPct: 0.05, volatilityGatePercentile: 0.9, maxBars: 10 };
const candle = (h: number, l: number, c: number): Candle => ({ symbol: "XAUUSD", ts: new Date(), o: 105, h, l, c });
const setup = (candlesAfterFormation: Candle[]): FvgSimulationSetup => ({ zone, candlesAfterFormation, atr: 10, qualityScore: 100 });

describe("FVG fixed-R simulator", () => {
  it("records clean 2R win", () => expect(simulateExit(setup([candle(125, 105, 125)]), params).r).toBe(2));
  it("records stop loss", () => expect(simulateExit(setup([candle(108, 90, 95)]), params).r).toBe(-1));
  it("records expired filled trade", () => expect(simulateExit(setup([candle(108, 105, 108)]), params).exitReason).toBe("expired"));
  it("records unfilled setup", () => expect(simulateExit(setup([candle(99, 90, 95)]), params).filled).toBe(false));
  it("applies quality, spread, and volatility filters", () => {
    const result = simulateFvgs([
      { ...setup([candle(125, 105, 125)]), qualityScore: 1 },
      { ...setup([candle(125, 105, 125)]), spread: 1 },
      { ...setup([candle(125, 105, 125)]), atrPercentile: 0.95 },
    ], { ...params, minQualityScore: 50 });
    expect(result.filteredByQuality).toBe(1);
    expect(result.filteredBySpread).toBe(1);
    expect(result.filteredByVolatility).toBe(1);
    expect(result.label).toBe("CANDLE_ONLY");
  });
});
