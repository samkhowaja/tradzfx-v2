const test = require("node:test");
const assert = require("node:assert/strict");
const shadow = require("./orb-causal-shadow");

test("collector clock and candles ignore weekend feed rows", () => {
  const rows = [
    { ts: new Date("2026-07-19T01:58:00Z") },
    { ts: new Date("2026-07-17T20:45:00Z") },
  ];
  assert.equal(shadow.latestTradableClock(rows), rows[1].ts);
  assert.deepEqual(shadow.tradableCandles(rows), [rows[1]]);
});

test("safety boundary counts observed tradable bars, not elapsed closure minutes", () => {
  const rows = [
    { ts: "2026-07-17T20:44:00Z" },
    { ts: "2026-07-17T20:45:00Z" },
    { ts: "2026-07-20T08:00:00Z" },
  ];
  assert.equal(shadow.observedBars(rows, "2026-07-17T20:45:00Z"), 2);
});
