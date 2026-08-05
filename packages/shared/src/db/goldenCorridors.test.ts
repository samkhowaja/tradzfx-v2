import { describe, expect, it } from "vitest";
import { assertGoldenCorridor, findGoldenCorridor } from "./goldenCorridors";

const CORRIDOR_ROW = {
  corridor_id: "3",
  symbol: "USDJPY",
  timeframe: "5m",
  window_start: new Date("2026-07-18T01:41:00Z"),
  window_end: new Date("2026-08-04T07:53:00Z"),
  window_id: "51",
  set_hash: "efc48db82879",
  harness_version: "parity-harness-v1@20260805",
  detector_version: "det-v1",
  canonical_version: "canon-v1",
  certified_at: new Date("2026-08-05T00:00:00Z"),
  certified_by: "salman",
  notes: "USDJPY cert cell",
};

function fakePool(rows: any[], capture?: { sql?: string; params?: unknown[] }) {
  return {
    async query(sql: string, params?: unknown[]) {
      if (capture) { capture.sql = sql; capture.params = params; }
      return { rows, rowCount: rows.length };
    },
  } as any;
}

const INSIDE = {
  symbol: "USDJPY",
  timeframe: "5m",
  jobStart: new Date("2026-07-25T10:00:00Z"),
  jobEnd: new Date("2026-07-25T10:15:00Z"),
};

describe("findGoldenCorridor", () => {
  it("queries market.golden_corridors with containment bounds", async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    const row = await findGoldenCorridor(fakePool([CORRIDOR_ROW], cap), INSIDE);
    expect(row?.corridor_id).toBe("3");
    expect(cap.sql).toContain("FROM market.golden_corridors");
    expect(cap.sql).toMatch(/window_start\s*<=\s*\$3/);
    expect(cap.sql).toMatch(/window_end\s*>=\s*\$4/);
    expect(cap.params).toEqual([
      "USDJPY",
      "5m",
      INSIDE.jobStart,
      INSIDE.jobEnd,
    ]);
  });

  it("returns null when no corridor covers the interval", async () => {
    const row = await findGoldenCorridor(fakePool([]), INSIDE);
    expect(row).toBeNull();
  });
});

describe("assertGoldenCorridor", () => {
  it("passes when an active corridor covers the job window", async () => {
    const v = await assertGoldenCorridor(fakePool([CORRIDOR_ROW]), INSIDE);
    expect(v.covered).toBe(true);
    expect(v.corridor?.set_hash).toBe("efc48db82879");
  });

  it("refuses with BLOCKED_NOT_GOLDEN when nothing covers the window", async () => {
    const v = await assertGoldenCorridor(fakePool([]), INSIDE);
    expect(v.covered).toBe(false);
    expect(v.reason).toMatch(/^BLOCKED_NOT_GOLDEN/);
    expect(v.reason).toContain("USDJPY 5m");
    expect(v.reason).toContain("2026-07-25T10:00:00.000Z");
  });

  it("refuses outside the certified window even when symbol/tf match", async () => {
    // fakePool returns rows only for covered queries; outside returns []
    const v = await assertGoldenCorridor(fakePool([]), {
      ...INSIDE,
      jobStart: new Date("2026-09-01T10:00:00Z"),
      jobEnd: new Date("2026-09-01T10:15:00Z"),
    });
    expect(v.covered).toBe(false);
  });

  it("refuses on set-hash mismatch when expectedSetHash is given", async () => {
    const v = await assertGoldenCorridor(fakePool([CORRIDOR_ROW]), {
      ...INSIDE,
      expectedSetHash: "deadbeefcafe",
    });
    expect(v.covered).toBe(false);
    expect(v.reason).toMatch(/^BLOCKED_SET_HASH_MISMATCH/);
  });

  it("passes set-hash check when hashes match", async () => {
    const v = await assertGoldenCorridor(fakePool([CORRIDOR_ROW]), {
      ...INSIDE,
      expectedSetHash: "efc48db82879",
    });
    expect(v.covered).toBe(true);
  });

  it("fails open with gate_offline on DB error", async () => {
    const broken = {
      async query() { throw new Error("connection reset"); },
    } as any;
    const v = await assertGoldenCorridor(broken, INSIDE);
    expect(v.covered).toBe(true);
    expect(v.reason).toMatch(/^gate_offline/);
    expect(v.reason).toContain("connection reset");
  });
});
