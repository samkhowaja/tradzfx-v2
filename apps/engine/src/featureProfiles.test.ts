import { describe, expect, it } from "vitest";
import {
  LIVE_COMPLETE_FEATURES,
  resolveFeatureProfileRuns,
} from "./featureProfiles";

describe("resolveFeatureProfileRuns", () => {
  it("expands configured timeframes independently from strategy variants", () => {
    const runs = resolveFeatureProfileRuns("live-complete", 1, ["1m", "15m"]);

    expect(runs.map((run) => run.tf)).toEqual(["1m", "15m"]);
    expect(runs[0].features).toHaveLength(LIVE_COMPLETE_FEATURES.length);
    expect(runs[1].features).toHaveLength(LIVE_COMPLETE_FEATURES.length - 1);
    expect(runs[0].features).not.toBe(runs[1].features);
  });

  it("schedules spread only at its canonical 1m timeframe", () => {
    const runs = resolveFeatureProfileRuns("live-complete", 1, ["1m", "5m"]);

    expect(runs[0].features).toContain("features_spread");
    expect(runs[1].features).not.toContain("features_spread");
  });

  it("rejects unknown profile versions", () => {
    expect(() => resolveFeatureProfileRuns("live-complete", 2, ["1m"]))
      .toThrow("Unsupported feature profile: live-complete@2");
  });

  it("rejects empty timeframe coverage", () => {
    expect(() => resolveFeatureProfileRuns("live-complete", 1, []))
      .toThrow("Feature profile requires at least one timeframe");
  });
});
