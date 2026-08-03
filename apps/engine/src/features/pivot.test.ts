import { describe, expect, it } from "vitest";
import type { Candle } from "@tm/shared";
import { pivotFeature } from "./pivot";

function candles(): Candle[] {
  return Array.from({ length: 15 }, (_, index) => {
    const ts = new Date(Date.UTC(2026, 0, 1, 0, index));
    const high = index === 7 ? 110 : 100;
    const low = index === 7 ? 90 : 99;
    return { symbol: "EURUSD", ts, o: 99.5, h: high, l: low, c: 100 };
  });
}

describe("causal pivot confirmation", () => {
  it("does not make pivot available before confirmationTs", () => {
    const result = pivotFeature.compute({ candles: candles() }, { tf: "1m" });
    const pivot = result.pivots.find((candidate) => candidate.ts.getUTCMinutes() === 7);

    expect(pivot).toBeDefined();
    expect(pivot!.confirmationTs).toEqual(new Date("2026-01-01T00:11:00.000Z"));
    expect(pivot!.confirmationTs.getTime()).toBeGreaterThan(pivot!.ts.getTime());
  });

  it("serializes and deserializes confirmationTs", () => {
    const result = pivotFeature.compute({ candles: candles() }, { tf: "1m" });
    const rows = pivotFeature.serialize(result);
    const restored = pivotFeature.deserialize(rows);
    expect(restored.pivots.map((pivot) => pivot.confirmationTs.toISOString())).toEqual(
      result.pivots.map((pivot) => pivot.confirmationTs.toISOString())
    );
  });
});
