const test = require("node:test");
const assert = require("node:assert/strict");
const { activeAt, completedAt, contains, directionFor, firstBetween, parseDays, pricingFor, supportiveOb, supportiveZone } = require("./backtest-location-sweep-displacement-retest.js");

test("parses bounded day argument", () => {
  assert.equal(parseDays(["--days=120"]), 120);
  assert.throws(() => parseDays(["--days=0"]), /--days/);
});
test("uses candle completion as causal knowledge time", () => {
  assert.equal(completedAt("2026-01-01T10:00:00Z","15m").toISOString(), "2026-01-01T10:15:00.000Z");
  assert.equal(completedAt("2026-01-01T10:00:00Z","5m").toISOString(), "2026-01-01T10:05:00.000Z");
});
test("maps side to favorable direction and pricing", () => {
  assert.equal(directionFor("buy"),"bullish"); assert.equal(directionFor("sell"),"bearish");
  assert.equal(pricingFor("buy"),"discount"); assert.equal(pricingFor("sell"),"premium");
});
test("classifies supportive HTF levels", () => {
  assert.equal(supportiveZone("buy",{direction:"bullish",zone_kind:"fvg"}),true);
  assert.equal(supportiveZone("sell",{direction:"bearish",zone_kind:"supply"}),true);
  assert.equal(supportiveOb("buy",{ob_kind:"bullish"}),true);
  assert.equal(supportiveOb("sell",{ob_kind:"bullish"}),false);
});
test("requires price inside level bounds", () => {
  assert.equal(contains({bottom:100,top:110},105),true);
  assert.equal(contains({bottom:100,top:110},111),false);
});
test("applies PIT active lifecycle", () => {
  const row={ts:"2026-01-01T10:00:00Z",invalidated_at:"2026-01-01T12:00:00Z",mitigated_at:null};
  assert.equal(activeAt(row,"2026-01-01T11:00:00Z"),true);
  assert.equal(activeAt(row,"2026-01-01T12:00:00Z"),false);
});
test("finds first matching event inside strict causal window", () => {
  const rows=[{ts:"2026-01-01T10:00:00Z",grade:"HIGH"},{ts:"2026-01-01T10:15:00Z",grade:"LOW"},{ts:"2026-01-01T10:30:00Z",grade:"HIGH"}];
  assert.equal(firstBetween(rows,"2026-01-01T10:00:00Z","2026-01-01T11:00:00Z",r=>r.grade==="HIGH").ts,"2026-01-01T10:30:00Z");
});
