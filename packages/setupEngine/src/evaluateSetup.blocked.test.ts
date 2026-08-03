import { describe, expect, it } from "vitest";
import { evaluateSetup } from "./evaluateSetup";
import type { Queryable } from "@tm/shared";

describe("setup fail-closed contract", () => {
  it("returns BLOCKED_DATA when required lineage input is missing", async () => {
    const pool: Queryable = {
      async query() {
        return { rows: [] };
      },
    };

    const result = await evaluateSetup(pool, {
      symbol: "EURUSD",
      tf: "5m",
      asOf: new Date("2026-08-03T12:00:00Z"),
    });

    expect(result.status).toBe("blocked");
    expect(result.grade).toBe("BLOCK");
    expect(result.blockReasons[0]).toContain("BLOCKED_DATA");
    expect(result.blockedData?.code).toBe("BLOCKED_DATA");
  });
});