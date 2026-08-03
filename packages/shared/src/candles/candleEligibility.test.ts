import { describe, expect, it, vi } from "vitest";
import { claimCandleForValidation, completeCandleValidation } from "./candleEligibility";

describe("candle eligibility transitions", () => {
  it("claims only pending/error rows", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const pool = { query } as any;
    await expect(claimCandleForValidation(pool, { symbol: "EURUSD", broker: "B", timeframe: "1m", ts: new Date("2026-01-01T00:00:00Z") })).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain("state IN ('PERSISTED', 'ERROR')");
  });

  it("completes only an owned validating row", async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    const pool = { query } as any;
    await expect(completeCandleValidation(pool, { symbol: "EURUSD", broker: "B", timeframe: "1m", ts: new Date("2026-01-01T00:00:00Z") }, {
      state: "CLEAN", validatorVersion: "test", policyId: 1, evidenceFingerprint: "0:clean",
    })).resolves.toBe(true);
    expect(query.mock.calls[0][0]).toContain("state = 'VALIDATING'");
  });
});
