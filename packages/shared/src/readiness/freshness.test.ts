import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRESHNESS_GRACE_MINUTES,
  DEFAULT_PRODUCER_CADENCE_MINUTES,
  resolveFreshnessPolicy,
} from "./freshness";

describe("resolveFreshnessPolicy", () => {
  it("uses producer cadence plus grace for short timeframes", () => {
    expect(resolveFreshnessPolicy({ tf: "1m" }).maxAgeMinutes).toBe(20);
    expect(resolveFreshnessPolicy({ tf: "5m" }).maxAgeMinutes).toBe(20);
  });

  it("uses two timeframe bars for longer timeframes", () => {
    expect(resolveFreshnessPolicy({ tf: "15m" }).maxAgeMinutes).toBe(30);
    expect(resolveFreshnessPolicy({ tf: "1h" }).maxAgeMinutes).toBe(120);
    expect(resolveFreshnessPolicy({ tf: "4h" }).maxAgeMinutes).toBe(480);
    expect(resolveFreshnessPolicy({ tf: "1d" }).maxAgeMinutes).toBe(2880);
  });

  it("supports explicit producer cadence and grace", () => {
    expect(
      resolveFreshnessPolicy({ tf: "5m", producerCadenceMinutes: 6, graceMinutes: 1 })
        .maxAgeMinutes
    ).toBe(10);
  });

  it("rejects invalid policy values", () => {
    expect(() => resolveFreshnessPolicy({ tf: "1m", producerCadenceMinutes: -1 })).toThrow(
      /producerCadenceMinutes/
    );
    expect(() => resolveFreshnessPolicy({ tf: "1m", graceMinutes: Number.NaN })).toThrow(
      /graceMinutes/
    );
  });

  it("exports stable operational defaults", () => {
    expect(DEFAULT_PRODUCER_CADENCE_MINUTES).toBe(15);
    expect(DEFAULT_FRESHNESS_GRACE_MINUTES).toBe(5);
  });
});
