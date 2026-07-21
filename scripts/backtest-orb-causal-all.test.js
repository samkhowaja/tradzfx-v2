const test = require("node:test");
const assert = require("node:assert/strict");
const { causalSignals } = require("./backtest-orb-causal-all");

function fixture(confirmationBias = "bearish") {
  const date = "2026-05-15";
  return {
    spec: {
      id: "orb_scalper_1m",
      filters: { timeWindows: [{ utcStart: "13:30", utcEnd: "16:00" }] },
      setup: [
        { feature: "features_bias", tf: "15m" },
        { feature: "features_opening_range", tf: "15m", session: "london" },
      ],
      entry: [{ feature: "features_displacement", tf: "15m" }],
    },
    input: {
      ranges: [{ symbol: "XAUUSD", tf: "15m", ts: `${date}T07:15:00Z`, date_key: date, session: "london", range_minutes: 15, high: 2400, low: 2390, midpoint: 2395 }],
      bias: [
        { tf: "15m", ts: `${date}T13:30:00Z`, direction: "bearish" },
        { tf: "15m", ts: `${date}T13:45:00Z`, direction: confirmationBias },
      ],
      candles: [
        { ts: `${date}T13:30:00Z`, o: 2392, h: 2393, l: 2388, c: 2389 },
        { ts: `${date}T13:45:00Z`, o: 2389, h: 2390, l: 2385, c: 2386 },
      ],
      disp: [{ tf: "15m", ts: `${date}T13:45:00Z`, grade: "HIGH", direction: "bearish" }],
      patterns: [], retests: [], atr: [],
    },
  };
}

test("requires bias direction at confirmation to match breakout and displacement", () => {
  const { spec, input } = fixture("bullish");
  const result = causalSignals(spec, input);
  assert.equal(result.signals.length, 0);
  assert.equal(result.rejections.no_post_breakout_confirmation_with_bias_alignment, 1);
});

test("emits when breakout, displacement, and confirmation bias agree", () => {
  const { spec, input } = fixture("bearish");
  const result = causalSignals(spec, input);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].side, "sell");
  assert.equal(result.signals[0].biasDirection, "bearish");
});
