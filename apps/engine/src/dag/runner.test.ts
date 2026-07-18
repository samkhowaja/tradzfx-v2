import { describe, it, expect } from "vitest";
import { getCandleTableForTf } from "@tm/shared";
import { buildOrderBlockLogicalId, resolveFeatureRowTs, shouldApplyEventGate } from "./runner";

describe("buildOrderBlockLogicalId", () => {
  const lineage = {
    formation_ts: new Date("2026-07-17T10:00:00.000Z"),
    source_event_ts: new Date("2026-07-17T10:15:00.000Z"),
    source_event_type: "bos",
    source_event_direction: "bullish",
    source_event_level: 2505,
  };

  it("returns deterministic fixed binary identity from immutable lineage", () => {
    const first = buildOrderBlockLogicalId("XAUUSD", "15m", lineage);
    const second = buildOrderBlockLogicalId("XAUUSD", "15m", { ...lineage });
    expect(Buffer.isBuffer(first)).toBe(true);
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
  });

  it("excludes geometry and lifecycle state from identity", () => {
    const first = buildOrderBlockLogicalId("XAUUSD", "15m", {
      ...lineage,
      top: 2505,
      bottom: 2500,
      is_fresh: true,
    });
    const second = buildOrderBlockLogicalId("XAUUSD", "15m", {
      ...lineage,
      top: 2510,
      bottom: 2495,
      is_fresh: false,
      invalidated_at: new Date("2026-07-17T12:00:00.000Z"),
    });
    expect(second).toEqual(first);
  });

  it("fails closed when exact lineage is unavailable", () => {
    expect(buildOrderBlockLogicalId("XAUUSD", "15m", {})).toBeNull();
  });
});

describe("getCandleTableForTf", () => {
  it("maps each supported timeframe to its canonical candle relation", () => {
    expect(getCandleTableForTf("1m")).toBe("market.candles_1m_canonical");
    expect(getCandleTableForTf("5m")).toBe("market.candles_5m_canonical");
    expect(getCandleTableForTf("15m")).toBe("market.candles_15m_canonical");
    expect(getCandleTableForTf("1h")).toBe("market.candles_1h_canonical");
    expect(getCandleTableForTf("4h")).toBe("market.candles_4h_canonical");
    expect(getCandleTableForTf("1d")).toBe("market.candles_1d_utc_canonical");
  });
});

describe("resolveFeatureRowTs", () => {
  it("anchors dense rows to latest fetched candle", () => {
    const sourceMaxTs = new Date("2026-07-17T10:00:00.000Z");
    expect(resolveFeatureRowTs(undefined, sourceMaxTs)).toBe(sourceMaxTs);
    expect(resolveFeatureRowTs("2026-07-17T10:00:45.976Z", sourceMaxTs)).toBe(sourceMaxTs);
  });

  it("preserves event feature timestamps", () => {
    const eventTs = new Date("2026-07-17T09:15:00.000Z");
    expect(resolveFeatureRowTs(eventTs, new Date("2026-07-17T10:00:00.000Z"))).toBe(eventTs);
  });
});

describe("shouldApplyEventGate", () => {
  it("keeps onEvent optimization enabled for normal runs", () => {
    expect(shouldApplyEventGate("onEvent")).toBe(true);
    expect(shouldApplyEventGate("onEvent", false)).toBe(true);
  });

  it("bypasses onEvent optimization only for explicit historical repair", () => {
    expect(shouldApplyEventGate("onEvent", true)).toBe(false);
    expect(shouldApplyEventGate(undefined, true)).toBe(false);
  });
});
