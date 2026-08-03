import { describe, expect, it } from "vitest";
import { evaluateHealthFreshness } from "./healthReadiness";

describe("evaluateHealthFreshness", () => {
  it("is ready during weekend closure", () => {
    const result = evaluateHealthFreshness({
      symbol: "EURUSD",
      latestCandle: new Date("2026-07-10T20:59:00.000Z"),
      latestFeature: new Date("2026-07-10T20:59:00.000Z"),
    }, new Date("2026-07-12T20:59:00.000Z"));
    expect(result.status).toBe("READY");
    expect(result.candleAgeMinutes).toBe(0);
    expect(result.featureAgeMinutes).toBe(0);
  });

  it("is ready during XAUUSD maintenance break", () => {
    const result = evaluateHealthFreshness({
      symbol: "XAUUSD",
      latestCandle: new Date("2026-07-09T20:59:00.000Z"),
      latestFeature: new Date("2026-07-09T20:59:00.000Z"),
    }, new Date("2026-07-09T21:59:00.000Z"));
    expect(result.status).toBe("READY");
  });

  it("blocks stale open-market evidence", () => {
    const result = evaluateHealthFreshness({
      symbol: "EURUSD",
      latestCandle: new Date("2026-07-09T11:30:00.000Z"),
      latestFeature: new Date("2026-07-09T11:30:00.000Z"),
    }, new Date("2026-07-09T12:00:00.000Z"));
    expect(result.status).toBe("BLOCKED");
    expect(result.candleVerdict).toBe("STALE_STATE");
    expect(result.featureVerdict).toBe("STALE_STATE");
  });
});
