import { describe, expect, it, vi } from "vitest";
import type { AtrOutput, Candle } from "@tm/shared";
import { computeVolatilityNormalized } from "./volatilityNormalized";

function candle(ts: string, close = 1.1): Candle {
  return { symbol: "EURUSD", ts: new Date(ts), o: close, h: close, l: close, c: close };
}

const atr: AtrOutput = {
  values: [{ period: 5, value: 0.0012, effectiveValue: 0.001, isValid: true }],
};

describe("features_volatility_normalized", () => {
  it("uses effective ATR and only same-session rows at or before anchor", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      { ts: "2026-07-18T10:00:00Z", value: 0.0008, effective_value: 0.0008, engine_ver: "1.2.0" },
      { ts: "2026-07-18T02:00:00Z", value: 0.02, effective_value: 0.02, engine_ver: "1.2.0" },
    ] });
    const output = await computeVolatilityNormalized(
      { candles: [candle("2026-07-18T10:00:00Z")], features_atr: atr },
      { tf: "5m", pool: { query }, symbol: "EURUSD", endTs: new Date("2026-07-18T10:00:00Z") }
    );

    expect(query).toHaveBeenCalledWith(expect.stringContaining("ts <= $4"), [
      "EURUSD", "5m", 5, new Date("2026-07-18T10:00:00Z"), 5_000,
    ]);
    expect(output.values[0]).toMatchObject({
      atrRaw: 0.0012,
      atrEffective: 0.001,
      atrPips: 10,
      session: "LONDON",
      sampleCount: 1,
      isValid: false,
      qualityReason: "warmup",
    });
  });

  it("produces deterministic percentile, robust score, and regime after warmup", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      ts: new Date(Date.UTC(2026, 0, index + 1, 10)).toISOString(),
      value: 0.0005 + index * 0.000005,
      effective_value: 0.0005 + index * 0.000005,
      engine_ver: "1.2.0",
    }));
    const output = await computeVolatilityNormalized(
      { candles: [candle(rows[99].ts)], features_atr: atr },
      { tf: "5m", pool: { query: vi.fn().mockResolvedValue({ rows }) }, symbol: "EURUSD", endTs: new Date(rows[99].ts) }
    );
    const value = output.values[0];

    expect(value.sampleCount).toBe(100);
    expect(value.percentileRank).toBeGreaterThan(0.95);
    expect(value.robustZ).toBeGreaterThan(0);
    expect(value.regime).toBe("extreme_high");
    expect(value.isValid).toBe(true);
  });

  it("emits no row for missing or invalid ATR", async () => {
    const output = await computeVolatilityNormalized(
      { candles: [candle("2026-07-18T10:00:00Z")], features_atr: { values: [] } },
      { tf: "5m", pool: { query: vi.fn() }, symbol: "EURUSD", endTs: new Date("2026-07-18T10:00:00Z") }
    );
    expect(output.values).toEqual([]);
  });
});
