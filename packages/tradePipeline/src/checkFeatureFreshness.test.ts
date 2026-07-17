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
  it("state feature within the per-tf window is fresh", () => {
    // features_atr@15m has a 20 minute window.
    const d = evaluateFeatureFreshness({
      featureName: "features_atr",
      tf: "15m",
      featureMaxTs: minsAgo(10),
      now: NOW,
    });
    expect(d.ok).toBe(true);
  });

  it("state feature past the per-tf window is stale_state_feature", () => {
    const d = evaluateFeatureFreshness({
      featureName: "features_atr",
      tf: "15m",
      featureMaxTs: minsAgo(30),
      now: NOW,
    });
    expect(d.ok).toBe(false);
    expect(d.reason).toMatch(/stale_state_feature: features_atr@15m/);
    expect(d.reason).toMatch(/> 20min/);
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

  it("event features never block (sparse by design)", () => {
    expect(
      evaluateFeatureFreshness({ featureName: "features_structure", tf: "15m", featureMaxTs: null, now: NOW }).ok,
    ).toBe(true);
    expect(
      evaluateFeatureFreshness({ featureName: "features_sweep", tf: "1m", featureMaxTs: minsAgo(9999), now: NOW }).ok,
    ).toBe(true);
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

  it("features_spread is a registered state feature with a per-tf window", () => {
    expect(
      evaluateFeatureFreshness({ featureName: "features_spread", tf: "1m", featureMaxTs: minsAgo(1), now: NOW }).ok,
    ).toBe(true);
    const stale = evaluateFeatureFreshness({
      featureName: "features_spread",
      tf: "1m",
      featureMaxTs: minsAgo(10),
      now: NOW,
    });
    expect(stale.ok).toBe(false);
    expect(stale.reason).toMatch(/stale_state_feature: features_spread@1m/);
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
