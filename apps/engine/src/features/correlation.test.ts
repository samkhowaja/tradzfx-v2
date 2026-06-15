import { describe, it, expect } from "vitest";
import { correlationFeature } from "./correlation";
import type { Candle } from "@tm/shared";

function makeCandles(
  count: number,
  primaryFn: (i: number) => number,
  refFn: (i: number) => number
): { candles: Candle[]; reference: Candle[] } {
  const candles: Candle[] = [];
  const reference: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(Date.UTC(2026, 0, 1, 0, i));
    const pc = primaryFn(i);
    const rc = refFn(i);
    candles.push({ symbol: "EURUSD", ts, o: pc, h: pc + 0.0001, l: pc - 0.0001, c: pc, v: 100 });
    reference.push({ symbol: "DXY", ts, o: rc, h: rc + 0.01, l: rc - 0.01, c: rc, v: 100 });
  }
  return { candles, reference };
}

describe("correlationFeature", () => {
  it("returns empty correlations when reference candles are missing", () => {
    const { candles } = makeCandles(60, (i) => 1.0 + i * 0.0001, (i) => 1.0 + i * 0.0001);
    const out = correlationFeature.compute({ candles, referenceCandles: {} });
    expect(out.correlations).toHaveLength(0);
  });

  it("computes strong positive correlation", () => {
    const { candles, reference } = makeCandles(
      60,
      (i) => 1.0 + i * 0.0001,
      (i) => 100.0 + i * 0.02
    );
    const out = correlationFeature.compute({ candles, referenceCandles: { DXY: reference } });

    expect(out.correlations).toHaveLength(1);
    const c = out.correlations[0];
    expect(c.referenceSymbol).toBe("DXY");
    expect(c.correlation1h).toBeGreaterThan(0.99);
    expect(c.divergenceDetected).toBe(false);
  });

  it("computes strong negative correlation", () => {
    const { candles, reference } = makeCandles(
      60,
      (i) => 1.0 + i * 0.0001,
      (i) => 100.0 - i * 0.02
    );
    const out = correlationFeature.compute({ candles, referenceCandles: { DXY: reference } });

    expect(out.correlations).toHaveLength(1);
    const c = out.correlations[0];
    expect(c.correlation1h).toBeLessThan(-0.99);
    expect(c.divergenceDetected).toBe(false);
  });

  it("detects divergence when short-term slopes oppose a positive correlation", () => {
    // 60 bars of broadly positive correlation, then last 20 diverge
    const primaryFn = (i: number) => {
      if (i < 40) return 1.0 + i * 0.0001;
      return 1.0 + i * 0.0002; // accelerate up
    };
    const refFn = (i: number) => {
      if (i < 40) return 100.0 + i * 0.02;
      return 100.0 + 40 * 0.02 - (i - 40) * 0.02; // turn down
    };
    const { candles, reference } = makeCandles(60, primaryFn, refFn);
    const out = correlationFeature.compute({ candles, referenceCandles: { DXY: reference } });

    const c = out.correlations[0];
    expect(c.correlation1h).toBeGreaterThan(0.3);
    expect(c.divergenceDetected).toBe(true);
    expect(c.divergenceType).toBe("bullish");
  });

  it("does not compute 1h correlation with fewer than 60 aligned bars", () => {
    const { candles, reference } = makeCandles(30, (i) => 1.0 + i * 0.0001, (i) => 100 + i * 0.02);
    const out = correlationFeature.compute({ candles, referenceCandles: { DXY: reference } });

    const c = out.correlations[0];
    expect(c.correlation1h).toBeUndefined();
    expect(c.correlation4h).toBeUndefined();
    expect(c.correlation1d).toBeUndefined();
  });

  it("serializes and deserializes output", () => {
    const { candles, reference } = makeCandles(
      60,
      (i) => 1.0 + i * 0.0001,
      (i) => 100.0 + i * 0.02
    );
    const out = correlationFeature.compute({ candles, referenceCandles: { DXY: reference } });
    const rows = correlationFeature.serialize(out);
    const restored = correlationFeature.deserialize(rows);

    expect(restored.correlations).toHaveLength(1);
    expect(restored.correlations[0].referenceSymbol).toBe("DXY");
    expect(restored.correlations[0].correlation1h).toBe(out.correlations[0].correlation1h);
    expect(restored.correlations[0].divergenceDetected).toBe(out.correlations[0].divergenceDetected);
  });
});
