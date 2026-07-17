import { describe, expect, it, vi } from "vitest";
import {
  getFeaturePipelineSymbol,
  listEnabledFeaturePipelineSymbols,
} from "./featureUniverse";

const validRow = {
  symbol: "XAUUSD",
  enabled: true,
  canonical_broker_id: "1xtrade",
  required_timeframes: ["1m", "15m", "1h"],
  required_feature_profile: "live-core",
  profile_version: 1,
  expected_data_clock_lag_seconds: 900,
  changed_at: new Date("2026-07-17T00:00:00Z"),
  changed_by: "operator",
};

describe("feature pipeline universe", () => {
  it("lists enabled entries in typed form", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [validRow] });
    const rows = await listEnabledFeaturePipelineSymbols({ query } as any);

    expect(rows[0]).toMatchObject({
      symbol: "XAUUSD",
      canonicalBrokerId: "1xtrade",
      requiredTimeframes: ["1m", "15m", "1h"],
      requiredFeatureProfile: "live-core",
      expectedDataClockLagSeconds: 900,
    });
    expect(query.mock.calls[0][0]).toContain("WHERE enabled = true");
  });

  it("normalizes symbol lookup", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [validRow] });
    await getFeaturePipelineSymbol({ query } as any, " xauusd ");
    expect(query.mock.calls[0][1]).toEqual(["XAUUSD"]);
  });

  it("rejects invalid persisted timeframes", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...validRow, required_timeframes: ["2h"] }],
    });
    await expect(listEnabledFeaturePipelineSymbols({ query } as any)).rejects.toThrow(
      "Invalid feature-universe timeframes"
    );
  });
});
