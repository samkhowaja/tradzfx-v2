import { describe, it, expect } from "vitest";
import { computePersistOutcome } from "./runner";

/**
 * SK-62: a producer run must tell the truth about rows that did not persist.
 * The old code recorded status='done' and rows_inserted=attempted even when the
 * batch INSERT threw — so a fully-rejected batch looked healthy.
 */
describe("computePersistOutcome (SK-62 rows_rejected)", () => {
  it("success: all rows inserted, none rejected", () => {
    const o = computePersistOutcome(10, 10, 10, null);
    expect(o.rows_inserted).toBe(10);
    expect(o.rows_rejected).toBe(0);
    expect(o.rows_deduped).toBe(0);
    expect(o.status).toBe("done");
    expect(o.error_message).toBeNull();
  });

  it("success: null rowCount defaults to attempted (no rejection)", () => {
    const o = computePersistOutcome(10, 10, null, null);
    expect(o.rows_inserted).toBe(10);
    expect(o.rows_rejected).toBe(0);
    expect(o.status).toBe("done");
  });

  it("dedup (rows_seen > rows_attempted) is reported separately, not as rejection", () => {
    const o = computePersistOutcome(12, 10, 10, null);
    expect(o.rows_deduped).toBe(2);
    expect(o.rows_inserted).toBe(10);
    expect(o.rows_rejected).toBe(0);
    expect(o.status).toBe("done");
  });

  it("partial rowCount counts the shortfall as rejected (still done)", () => {
    const o = computePersistOutcome(10, 10, 7, null);
    expect(o.rows_inserted).toBe(7);
    expect(o.rows_rejected).toBe(3);
    expect(o.status).toBe("done");
  });

  it("REGRESSION: a failed INSERT is error + 0 inserted, never done", () => {
    // This is the bug SK-62 fixes: previously this would have been ledgered as
    // status='done', rows_inserted=10 (the attempted count), masking the failure.
    const o = computePersistOutcome(10, 10, null, "new row violates check constraint");
    expect(o.status).toBe("error");
    expect(o.rows_inserted).toBe(0);
    expect(o.rows_rejected).toBe(10);
    expect(o.error_message).toContain("check constraint");
  });
});
