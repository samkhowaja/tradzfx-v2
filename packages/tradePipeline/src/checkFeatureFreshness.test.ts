import { describe, it, expect, vi } from "vitest";

// liveRunner imports @tm/setup-engine at module load; the freshness helper does
// not use it, but stub it so the test stays hermetic and fast.
vi.mock("@tm/setup-engine", () => ({
  evaluateSetup: vi.fn(),
}));

import { evaluateFeatureFreshness } from "./liveRunner";

const NOW = new Date("2026-07-09T12:00:00.000Z").getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

describe("evaluateFeatureFreshness", () => {
  it("state feature within the producer-aware window is fresh", () => {
    // 15m uses max(15m cadence + 5m grace, 2 * 15m) = 30m.
    const d = evaluateFeatureFreshness({
      featureName: "features_atr",
      tf: "15m",
      featureMaxTs: minsAgo(30),
      now: NOW,
    });
    expect(d.ok).toBe(true);
    expect(d.status).toBe("READY");
    expect(d.verdict).toBe("READY");
  });

  it("state feature past the producer-aware window is stale_state_feature", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_atr",
      tf: "15m",
      featureMaxTs: minsAgo(31),
      now: NOW,
    });
    expect(d.ok).toBe(false);
    expect(d.status).toBe("BLOCKED");
    expect(d.verdict).toBe("STALE_STATE");
    expect(d.reason).toMatch(/stale_state_feature: features_atr@15m/);
    expect(d.reason).toMatch(/> 30min/);
  });

  it("state feature with no row is stale_state_feature(no_data)", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_bias",
      tf: "1m",
      featureMaxTs: null,
      now: NOW,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/no_data/);
  });

  it("event features never block but empty evidence is degraded", () => {
    const empty = evaluateFeatureFreshness({
      featureName: "features_structure",
      tf: "15m",
      featureMaxTs: null,
      now: NOW,
    });
    expect(empty.ok).toBe(true);
    expect(empty.status).toBe("DEGRADED");
    expect(empty.verdict).toBe("SPARSE_EVENT_EMPTY");

    const present = evaluateFeatureFreshness({
      featureName: "features_sweep",
      tf: "1m",
      featureMaxTs: minsAgo(9999),
      now: NOW,
    });
    expect(present.ok).toBe(true);
    expect(present.status).toBe("READY");
    expect(present.verdict).toBe("READY_EVENT");
  });

  it("level feature written within the lookback window is fresh (the 5-min bug is gone)", () => {
    // features_zone@15m: lookback 96 bars * 15min = 1440min window. A 2h-old zone
    // must NOT be flagged stale (this is what caused the 400+/week rejections).
    const d = evaluateFeatureFreshness({
      featureName: "features_zone",
      tf: "15m",
      featureMaxTs: minsAgo(120),
      now: NOW,
    });
    expect(d.ok).toBe(true);
  });

  it("level engine that has not written within the lookback window is stale", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_zone",
      tf: "15m",
      featureMaxTs: minsAgo(2000),
      now: NOW,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/stale_state_feature: features_zone@15m/);
    expect(d.reason).toMatch(/level engine/);
  });

  it("level table that has never produced a row is stale", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_ifvg",
      tf: "5m",
      featureMaxTs: null,
      now: NOW,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/level table empty/);
  });

  it("features_spread uses cadence-aware 1m freshness", () => {
    expect(
      evaluateFeatureFreshness({ featureName: "features_spread", tf: "1m", featureMaxTs: minsAgo(20), now: NOW }).ok,
    ).toBe(true);
    const stale = evaluateFeatureFreshness({
      featureName: "features_spread",
      tf: "1m",
      featureMaxTs: minsAgo(21),
      now: NOW,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toMatch(/stale_state_feature: features_spread@1m/);
  });

  it("blocks fresh rows produced by wrong engine version", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_atr",
      tf: "15m",
      featureMaxTs: minsAgo(1),
      now: NOW,
      expectedEngineVersion: "1.2.0",
      observedEngineVersion: "1.1.0",
    });
    expect(d.ok).toBe(false);
    expect(d.status).toBe("BLOCKED");
    expect(d.verdict).toBe("BLOCKED_VERSION");
  });

  it("does not count closed weekend time as stale", () => {
    const fridayClose = new Date("2026-07-10T20:59:00.000Z");
    const sundayPreOpen = new Date("2026-07-12T20:59:00.000Z");
    const d = evaluateFeatureFreshness({
      featureName: "features_spread",
      tf: "1m",
      featureMaxTs: fridayClose,
      now: sundayPreOpen.getTime(),
      symbol: "EURUSD",
    });
    expect(d.ok).toBe(true);
    expect(d.status).toBe("READY");
  });

  it("does not count XAUUSD daily break as stale", () => {
    const beforeBreak = new Date("2026-07-09T20:59:00.000Z");
    const beforeReopen = new Date("2026-07-09T21:59:00.000Z");
    const d = evaluateFeatureFreshness({
      featureName: "features_spread",
      tf: "1m",
      featureMaxTs: beforeBreak,
      now: beforeReopen.getTime(),
      symbol: "XAUUSD",
    });
    expect(d.ok).toBe(true);
    expect(d.status).toBe("READY");
  });

  it("unknown feature with no contracted freshness passes (never blocks)", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_does_not_exist",
      tf: "1m",
      featureMaxTs: null,
      now: NOW,
    });
    expect(d.ok).toBe(true);
  });
});
