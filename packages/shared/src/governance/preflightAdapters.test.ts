import { describe, expect, it } from "vitest";
import { buildHtfAnchorMaps, buildReadOnlyPreflightChecks, diagnoseHtfSourceWindow, findFirstIncompleteHtfAnchor, validateHtfAnchors } from "./preflightAdapters";

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
});