import { describe, it, expect } from "vitest";
import { orderBlockFeature, OrderBlockInput } from "./orderBlock";
import type { Candle, StructureOutput } from "@tm/shared";

function makeCandle(ts: Date, o: number, h: number, l: number, c: number): Candle {
  return { symbol: "XAUUSD", ts, o, h, l, c, v: 100 };
}

function input(candles: Candle[], events: StructureOutput["events"]): OrderBlockInput {
  return { candles, features_structure: { events } };
}

describe("orderBlockFeature", () => {
  it("detects a bullish order block from the last bearish candle before a bullish break", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2505, 2500, 2501), // bearish opposing candle
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2512, 2501, 2511), // bullish break
    ];
    const events: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 2505, ts: candles[4].ts },
    ];
    const out = orderBlockFeature.compute(input(candles, events));
    expect(out.orderBlocks).toHaveLength(1);
    expect(out.orderBlocks[0].obKind).toBe("bullish");
    expect(out.orderBlocks[0].top).toBe(2505);
    expect(out.orderBlocks[0].bottom).toBe(2500);
    expect(out.orderBlocks[0].sourceEventTs).toEqual(candles[4].ts);
    expect(out.orderBlocks[0].sourceEventType).toBe("bos");
    expect(out.orderBlocks[0].sourceEventDirection).toBe("bullish");
    expect(out.orderBlocks[0].sourceEventLevel).toBe(2505);
  });

  it("detects a bearish order block from the last bullish candle before a bearish break", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2505, 2507, 2505, 2506),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2506, 2508, 2506, 2507),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2507, 2509, 2507, 2508),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2500, 2508, 2500, 2507), // bullish opposing candle
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2507, 2507, 2490, 2491), // bearish break
    ];
    const events: StructureOutput["events"] = [
      { eventType: "bos", direction: "bearish", level: 2500, ts: candles[4].ts },
    ];
    const out = orderBlockFeature.compute(input(candles, events));
    expect(out.orderBlocks).toHaveLength(1);
    expect(out.orderBlocks[0].obKind).toBe("bearish");
  });

  it("skips events outside the configured lookback window", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2505, 2503, 2504),
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2504, 2512, 2504, 2511),
    ];
    const events: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 2505, ts: candles[4].ts },
    ];
    const out = orderBlockFeature.compute(input(candles, events));
    // No bearish opposing candle in the default lookback.
    expect(out.orderBlocks.length).toBe(0);
  });

  it("skips structure events unavailable at candle snapshot", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2505, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2512, 2501, 2511),
    ];
    const events: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 2505, ts: candles[4].ts, availableAtTs: new Date(t0.getTime() + 5 * 60000) },
    ];
    expect(orderBlockFeature.compute(input(candles, events)).orderBlocks).toHaveLength(0);
  });

  it("serializes and deserializes order block rows", () => {
    const t0 = new Date(Date.UTC(2026, 0, 1, 12, 0));
    const candles: Candle[] = [
      makeCandle(new Date(t0.getTime() + 0 * 60000), 2500, 2502, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 1 * 60000), 2501, 2503, 2501, 2502),
      makeCandle(new Date(t0.getTime() + 2 * 60000), 2502, 2504, 2502, 2503),
      makeCandle(new Date(t0.getTime() + 3 * 60000), 2503, 2505, 2500, 2501),
      makeCandle(new Date(t0.getTime() + 4 * 60000), 2501, 2512, 2501, 2511),
    ];
    const events: StructureOutput["events"] = [
      { eventType: "bos", direction: "bullish", level: 2505, ts: candles[4].ts },
    ];
    const out = orderBlockFeature.compute(input(candles, events));
    const rows = orderBlockFeature.serialize(out);
    const restored = orderBlockFeature.deserialize(rows);
    expect(restored.orderBlocks.length).toBe(1);
    expect(restored.orderBlocks[0].obKind).toBe("bullish");
    expect(restored.orderBlocks[0].sourceEventTs).toEqual(candles[4].ts);
    expect(restored.orderBlocks[0].sourceEventType).toBe("bos");
    expect(restored.orderBlocks[0].sourceEventDirection).toBe("bullish");
    expect(restored.orderBlocks[0].sourceEventLevel).toBe(2505);
  });
});
