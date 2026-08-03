"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalizeZoneReads, diffRows } = require("./shadow-compare-canonical-zones.js");

test("rewrites aliased zone lateral with anchor-first canonical function", () => {
  const raw = `JOIN LATERAL (\n  SELECT *\n  FROM features_zone z\n  WHERE z.symbol = e.symbol\n    AND z.tf = '15m'\n    AND z.ts <= e.ts\n) z ON TRUE`;
  const result = canonicalizeZoneReads(raw);
  assert.equal(result.replacements, 1);
  assert.match(result.sql, /FROM public\.canonical_zones_as_of\(e\.symbol, '15m', e\.ts\) z/);
  assert.doesNotMatch(result.sql, /FROM features_zone/);
});

test("rewrites unaliased compiler PIT lateral", () => {
  const raw = `LATERAL (\n  SELECT DISTINCT ON (symbol, zone_kind, direction) *\n  FROM features_zone\n  WHERE symbol = s.symbol\n    AND tf = '5m'\n    AND ts <= s.ts\n) AS pit_zone`;
  const result = canonicalizeZoneReads(raw);
  assert.match(result.sql, /canonical_zones_as_of\(s\.symbol, '5m', s\.ts\) features_zone/);
});

test("fails closed when no zone read was rewritten", () => {
  assert.throws(() => canonicalizeZoneReads("SELECT * FROM features_bias"), /replacements=0/);
});

test("reports missing and changed signals separately", () => {
  const raw = [
    { ts: new Date("2026-07-10T10:00:00Z"), symbol: "XAUUSD", side: "buy", zone_top: 1 },
    { ts: new Date("2026-07-10T11:00:00Z"), symbol: "XAUUSD", side: "sell", zone_top: 2 },
  ];
  const canonical = [
    { ts: new Date("2026-07-10T10:00:00Z"), symbol: "XAUUSD", side: "buy", zone_top: 1.5 },
    { ts: new Date("2026-07-10T12:00:00Z"), symbol: "XAUUSD", side: "buy", zone_top: 3 },
  ];
  const result = diffRows(raw, canonical);
  assert.equal(result.changed.length, 1);
  assert.equal(result.rawOnly.length, 1);
  assert.equal(result.canonicalOnly.length, 1);
});
