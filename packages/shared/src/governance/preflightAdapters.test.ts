import { describe, expect, it } from "vitest";
import { buildHtfAnchorMaps, buildReadOnlyPreflightChecks, diagnoseHtfSourceWindow, expectedHtfSourceSlots, findFirstIncompleteHtfAnchor, trustedWindowChain, validateHtfAnchors } from "./preflightAdapters";

describe("read-only preflight adapters", () => {
  it("uses SELECT-only queries and fails closed for caller-owned evidence", async () => {
    const statements: string[] = [];
    const db = { query: async (text: string) => {
      statements.push(text);
      return { rows: [{ rows: 1, ineligible: 0 }] };
    } } as never;
    const result = await buildReadOnlyPreflightChecks(db, {
      strategyId: "s", symbol: "XAUUSD", timeframe: "1m",
      fromTs: "2026-08-11T00:00:00Z", toTs: "2026-08-11T01:00:00Z",
    });
    expect(statements.every((sql) => /^\s*SELECT/i.test(sql))).toBe(true);
    expect(result.warmup.ok).toBe(false);
    expect(result.dxy.ok).toBe(false);
    expect(result.parity.ok).toBe(false);
  });

  it("marks watukushay_no1 DXY policy explicitly not required", async () => {
    const db = { query: async () => ({ rows: [{ rows: 1, ineligible: 0 }] }) } as never;
    const result = await buildReadOnlyPreflightChecks(db, {
      strategyId: "watukushay_no1", symbol: "XAUUSD", timeframe: "15m",
      fromTs: "2026-07-19T00:00:00Z", toTs: "2026-07-24T00:00:00Z",
    });
    expect(result.dxy.status).toBe("NOT_REQUIRED");
    expect(result.dxy.ok).toBe(true);
    expect(result.parity.status).toBe("NOT_RUN");
  });

  it("fails when expected HTF anchor is absent", () => {
    const result = validateHtfAnchors(
      ["2026-08-11T00:00:00.000Z", "2026-08-11T01:00:00.000Z"],
      ["2026-08-11T00:00:00.000Z"],
      new Map([["2026-08-11T00:00:00.000Z", Array.from({ length: 60 }, (_, i) => new Date(Date.parse("2026-08-11T00:00:00Z") + i * 60000).toISOString())]]),
      60,
    );
    expect(result.missingHtf).toBe(1);
    expect(result.closedBarChecked).toBe(false);
  });

  it("fails when source count is complete but anchors are shifted", () => {
    const shifted = Array.from({ length: 15 }, (_, i) => new Date(Date.parse("2026-08-11T00:01:00Z") + i * 60000).toISOString());
    const result = validateHtfAnchors(
      ["2026-08-11T00:00:00.000Z"],
      ["2026-08-11T00:00:00.000Z"],
      new Map([["2026-08-11T00:00:00.000Z", shifted]]),
      15,
    );
    expect(result.incompleteSource).toBe(1);
    expect(result.closedBarChecked).toBe(false);
  });

  it("rejects duplicate source timestamps instead of collapsing them", () => {
    expect(() => buildHtfAnchorMaps([
      { htf_anchor: "2026-08-11T00:00:00Z", source_ts: "2026-08-11T00:00:00Z", source_key: "a" },
      { htf_anchor: "2026-08-11T00:00:00Z", source_ts: "2026-08-11T00:00:00Z", source_key: "a" },
    ])).toThrow("duplicate canonical source timestamp");
  });

  it("rejects extra HTF anchors", () => {
    const result = validateHtfAnchors(
      ["2026-08-11T00:00:00.000Z"],
      ["2026-08-11T00:00:00.000Z", "2026-08-11T01:00:00.000Z"],
      new Map([["2026-08-11T00:00:00.000Z", Array.from({ length: 60 }, (_, i) => new Date(Date.parse("2026-08-11T00:00:00Z") + i * 60000).toISOString())]]),
      60,
    );
    expect(result.extraHtf).toBe(1);
    expect(result.closedBarChecked).toBe(false);
  });

  it("reports first incomplete HTF anchor", () => {
    const complete = Array.from({ length: 15 }, (_, i) => new Date(Date.parse("2026-08-11T00:00:00Z") + i * 60000).toISOString());
    const incomplete = complete.slice(0, 14);
    expect(findFirstIncompleteHtfAnchor(
      ["2026-08-11T00:00:00.000Z", "2026-08-11T00:15:00.000Z"],
      new Map([
        ["2026-08-11T00:00:00.000Z", complete],
        ["2026-08-11T00:15:00.000Z", incomplete],
      ]),
      15,
    )).toBe("2026-08-11T00:15:00.000Z");
  });

  it("returns null when every HTF source window is complete", () => {
    const sources = Array.from({ length: 5 }, (_, i) => new Date(Date.parse("2026-08-11T00:00:00Z") + i * 60000).toISOString());
    expect(findFirstIncompleteHtfAnchor(
      ["2026-08-11T00:00:00.000Z"],
      new Map([["2026-08-11T00:00:00.000Z", sources]]),
      5,
    )).toBeNull();
  });

  it("reports missing source and last present source", () => {
    const sources = [
      "2026-08-11T00:00:00.000Z",
      "2026-08-11T00:01:00.000Z",
      "2026-08-11T00:03:00.000Z",
    ];
    expect(diagnoseHtfSourceWindow("2026-08-11T00:00:00.000Z", sources, 4)).toEqual({
      anchor: "2026-08-11T00:00:00.000Z",
      expectedCount: 4,
      actualCount: 3,
      firstMissingSource: "2026-08-11T00:02:00.000Z",
      lastPresentSource: "2026-08-11T00:03:00.000Z",
    });
  });

  // Calendar-aware source expectations (Sunday reopen / broker halt-edge policy).
  // XAUUSD 2026-07-19 is a Sunday: FX week opens 21:00 UTC, broker break-edge
  // resume is 22:05 UTC. So the 22:00 15m anchor expects only 22:05..22:14 (10 slots);
  // 22:00..22:04 are expected closure, not missing bars.
  const sundayReopenSources = Array.from({ length: 10 }, (_, i) =>
    new Date(Date.parse("2026-07-19T22:05:00Z") + i * 60_000).toISOString());

  it("passes a Sunday-reopen 15m anchor whose only missing slots are expected closure", () => {
    const result = validateHtfAnchors(
      ["2026-07-19T22:00:00.000Z"],
      ["2026-07-19T22:00:00.000Z"],
      new Map([["2026-07-19T22:00:00.000Z", sundayReopenSources]]),
      15,
      "XAUUSD",
    );
    expect(result).toEqual({ missingHtf: 0, incompleteSource: 0, extraHtf: 0, closedBarChecked: true });
  });

  it("without symbol threading the same Sunday-reopen anchor still fails (raw-minute expectation)", () => {
    const result = validateHtfAnchors(
      ["2026-07-19T22:00:00.000Z"],
      ["2026-07-19T22:00:00.000Z"],
      new Map([["2026-07-19T22:00:00.000Z", sundayReopenSources]]),
      15,
    );
    expect(result.incompleteSource).toBe(1);
    expect(result.closedBarChecked).toBe(false);
  });

  it("stays fail-closed for a genuinely missing tradable slot mid-session", () => {
    const withGap = sundayReopenSources.filter((ts) => ts !== "2026-07-19T22:07:00.000Z");
    const result = validateHtfAnchors(
      ["2026-07-19T22:00:00.000Z"],
      ["2026-07-19T22:00:00.000Z"],
      new Map([["2026-07-19T22:00:00.000Z", withGap]]),
      15,
      "XAUUSD",
    );
    expect(result.incompleteSource).toBe(1);
    expect(result.closedBarChecked).toBe(false);
  });

  it("findFirstIncompleteHtfAnchor skips expected-closure anchors but flags real gaps", () => {
    expect(findFirstIncompleteHtfAnchor(
      ["2026-07-19T22:00:00.000Z"],
      new Map([["2026-07-19T22:00:00.000Z", sundayReopenSources]]),
      15,
      "XAUUSD",
    )).toBeNull();
    const withGap = sundayReopenSources.filter((ts) => ts !== "2026-07-19T22:09:00.000Z");
    expect(findFirstIncompleteHtfAnchor(
      ["2026-07-19T22:00:00.000Z"],
      new Map([["2026-07-19T22:00:00.000Z", withGap]]),
      15,
      "XAUUSD",
    )).toBe("2026-07-19T22:00:00.000Z");
  });

  it("diagnoses the Sunday-reopen anchor against tradable-expected slots only", () => {
    expect(diagnoseHtfSourceWindow("2026-07-19T22:00:00.000Z", sundayReopenSources, 15, "XAUUSD")).toEqual({
      anchor: "2026-07-19T22:00:00.000Z",
      expectedCount: 10,
      actualCount: 10,
      firstMissingSource: null,
      lastPresentSource: "2026-07-19T22:14:00.000Z",
    });
  });

  it("diagnoses a genuine mid-session gap as the first missing tradable slot", () => {
    const withGap = sundayReopenSources.filter((ts) => ts !== "2026-07-19T22:07:00.000Z");
    const diagnosis = diagnoseHtfSourceWindow("2026-07-19T22:00:00.000Z", withGap, 15, "XAUUSD");
    expect(diagnosis.expectedCount).toBe(10);
    expect(diagnosis.actualCount).toBe(9);
    expect(diagnosis.firstMissingSource).toBe("2026-07-19T22:07:00.000Z");
  });

  it("expectedHtfSourceSlots excludes weekend, daily-halt, and break-edge slots", () => {
    // XAUUSD Friday 2026-07-17 20:45 15m anchor: 20:45..20:49 tradable,
    // 20:50..20:59 break-edge halt, 21:00+ daily halt then weekend close.
    expect(expectedHtfSourceSlots("2026-07-17T20:45:00.000Z", 15, "XAUUSD")).toEqual([
      "2026-07-17T20:45:00.000Z",
      "2026-07-17T20:46:00.000Z",
      "2026-07-17T20:47:00.000Z",
      "2026-07-17T20:48:00.000Z",
      "2026-07-17T20:49:00.000Z",
    ]);
    // A fully open mid-week anchor expects all 15 slots.
    expect(expectedHtfSourceSlots("2026-08-11T00:00:00.000Z", 15, "XAUUSD")).toHaveLength(15);
  });

  it("trustedWindowChain covers a contiguous chain", () => {
    const result = trustedWindowChain([
      { window_id: 1, window_start: "2026-07-08T00:00:00Z", window_end: "2026-07-10T00:00:00Z" },
      { window_id: 2, window_start: "2026-07-10T00:00:00Z", window_end: "2026-07-15T00:00:00Z" },
      { window_id: 3, window_start: "2026-07-14T00:00:00Z", window_end: "2026-07-20T00:00:00Z" },
    ], "2026-07-08T00:00:00Z", "2026-07-19T00:00:00Z");
    expect(result.covered).toBe(true);
    expect(result.windowIds).toEqual([1, 2, 3]);
    expect(result.firstGapStart).toBeNull();
  });

  it("trustedWindowChain rejects a mid-chain gap and reports it", () => {
    const result = trustedWindowChain([
      { window_id: 1, window_start: "2026-07-08T00:00:00Z", window_end: "2026-07-10T00:00:00Z" },
      { window_id: 2, window_start: "2026-07-12T00:00:00Z", window_end: "2026-07-20T00:00:00Z" },
    ], "2026-07-08T00:00:00Z", "2026-07-19T00:00:00Z");
    expect(result.covered).toBe(false);
    expect(result.firstGapStart).toBe("2026-07-10T00:00:00.000Z");
    expect(result.firstGapEnd).toBe("2026-07-12T00:00:00.000Z");
  });

  it("trustedWindowChain rejects a trailing gap after the last window", () => {
    const result = trustedWindowChain([
      { window_id: 1, window_start: "2026-07-08T00:00:00Z", window_end: "2026-07-10T00:00:00Z" },
    ], "2026-07-08T00:00:00Z", "2026-07-19T00:00:00Z");
    expect(result.covered).toBe(false);
    expect(result.firstGapStart).toBe("2026-07-10T00:00:00.000Z");
    expect(result.firstGapEnd).toBe("2026-07-19T00:00:00.000Z");
  });

  it("trustedWindowChain rejects when no window reaches the range start", () => {
    const result = trustedWindowChain([
      { window_id: 1, window_start: "2026-07-18T01:34:00Z", window_end: "2026-07-19T01:58:00Z" },
    ], "2026-07-08T03:35:00Z", "2026-07-23T00:00:00Z");
    expect(result.covered).toBe(false);
    expect(result.firstGapStart).toBe("2026-07-08T03:35:00.000Z");
    expect(result.firstGapEnd).toBe("2026-07-18T01:34:00.000Z");
  });

  it("trustedWindowChain ignores empty/inverted windows", () => {
    const result = trustedWindowChain([
      { window_id: 9, window_start: "2026-07-10T00:00:00Z", window_end: "2026-07-10T00:00:00Z" },
      { window_id: 1, window_start: "2026-07-08T00:00:00Z", window_end: "2026-07-19T00:00:00Z" },
    ], "2026-07-08T00:00:00Z", "2026-07-19T00:00:00Z");
    expect(result.covered).toBe(true);
    expect(result.windowIds).toEqual([1]);
  });
});