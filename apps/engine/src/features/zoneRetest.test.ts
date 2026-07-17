import { describe, it, expect } from "vitest";
import { zoneRetestFeature } from "./zoneRetest";
import type { Candle, ZoneOutput } from "@tm/shared";

function candle(tsOffset: number, o: number, h: number, l: number, c: number): Candle {
  return {
    symbol: "EURUSD",
    ts: new Date(Date.UTC(2026, 0, 1, 0, tsOffset)),
    o,
    h,
    l,
    c,
    v: 100,
  };
}

describe("zoneRetestFeature", () => {
  it("returns no retests when there are no zones", () => {
    const candles = [candle(0, 1.0, 1.01, 0.99, 1.0), candle(1, 1.0, 1.01, 0.99, 1.0)];
    const out = zoneRetestFeature.compute({ candles, features_zone: { zones: [] } });
    expect(out.retests).toHaveLength(0);
  });

  it("returns no retests when the latest candle does not intersect the zone", () => {
    const candles = [candle(0, 1.0, 1.01, 0.99, 1.0), candle(1, 1.05, 1.06, 1.04, 1.05)];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 0.995, bottom: 0.99, tapped: false, ts: candles[0].ts }],
    };
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    expect(out.retests).toHaveLength(0);
  });

  it("detects a wick into the zone without closing inside", () => {
    const candles = [
      candle(0, 1.0, 1.0, 1.0, 1.0),
      candle(1, 1.0, 1.006, 0.992, 1.005), // wick down to 0.992 inside demand, close above zone
    ];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 0.995, bottom: 0.99, tapped: false, ts: candles[0].ts }],
    };
    process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF = "false";
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    delete process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF;
    expect(out.retests).toHaveLength(1);
    expect(out.retests[0].wickInto).toBe(true);
    expect(out.retests[0].closeInside).toBe(false);
    expect(out.retests[0].engulfingAtZone).toBe(false);
    expect(out.retests[0].direction).toBe("bullish");
  });

  it("detects a close inside the zone", () => {
    const candles = [
      candle(0, 1.0, 1.0, 1.0, 1.0),
      candle(1, 0.994, 0.996, 0.992, 0.994), // close inside demand zone
    ];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 0.995, bottom: 0.99, tapped: false, ts: candles[0].ts }],
    };
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    expect(out.retests[0].wickInto).toBe(true);
    expect(out.retests[0].closeInside).toBe(true);
  });

  it("detects bullish engulfing at the zone", () => {
    const candles = [
      candle(0, 0.993, 0.994, 0.992, 0.993), // small bearish-ish candle inside zone
      candle(1, 0.992, 0.996, 0.991, 0.995), // bullish engulfing, touches zone
    ];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 0.996, bottom: 0.99, tapped: false, ts: candles[0].ts }],
    };
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    expect(out.retests).toHaveLength(1);
    expect(out.retests[0].engulfingAtZone).toBe(true);
    expect(out.retests[0].direction).toBe("bullish");
  });

  it("detects bearish engulfing at the zone", () => {
    const candles = [
      candle(0, 1.005, 1.006, 1.004, 1.005),
      candle(1, 1.006, 1.006, 0.994, 0.995), // bearish engulfing, intersects supply
    ];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "supply", top: 1.007, bottom: 1.003, tapped: false, ts: candles[0].ts }],
    };
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    expect(out.retests[0].engulfingAtZone).toBe(true);
    expect(out.retests[0].direction).toBe("bearish");
  });

  it("reports neutral direction for doji-like candles", () => {
    const candles = [candle(0, 1.0, 1.0, 1.0, 1.0), candle(1, 1.0, 1.005, 0.995, 1.0)];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 1.001, bottom: 0.999, tapped: false, ts: candles[0].ts }],
    };
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    expect(out.retests[0].direction).toBe("neutral");
  });

  it("produces one retest per intersected zone", () => {
    const candles = [candle(0, 1.0, 1.0, 1.0, 1.0), candle(1, 1.0, 1.006, 0.992, 1.005)];
    const zone: ZoneOutput = {
      zones: [
        { zoneKind: "demand", top: 0.995, bottom: 0.99, tapped: false, ts: candles[0].ts },
        { zoneKind: "fvg", top: 1.009, bottom: 1.007, tapped: false, ts: candles[0].ts },
      ],
    };
    process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF = "false";
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    delete process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF;
    expect(out.retests).toHaveLength(1);
    expect(out.retests[0].zoneKind).toBe("demand");
  });

  it("serializes and deserializes output", () => {
    const candles = [
      candle(0, 1.0, 1.0, 1.0, 1.0),
      candle(1, 1.0, 1.006, 0.992, 1.005),
    ];
    const zone: ZoneOutput = {
      zones: [{ zoneKind: "demand", top: 0.995, bottom: 0.99, tapped: false, ts: candles[0].ts }],
    };
    process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF = "false";
    const out = zoneRetestFeature.compute({ candles, features_zone: zone });
    delete process.env.ZONE_RETEST_REQUIRE_CLOSE_OR_ENGULF;
    const rows = zoneRetestFeature.serialize(out);
    const restored = zoneRetestFeature.deserialize(rows);

    expect(restored.retests).toHaveLength(1);
    expect(restored.retests[0].wickInto).toBe(out.retests[0].wickInto);
    expect(restored.retests[0].engulfingAtZone).toBe(out.retests[0].engulfingAtZone);
  });
});
