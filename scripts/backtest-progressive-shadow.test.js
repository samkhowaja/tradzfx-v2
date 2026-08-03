const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildGeometry, evaluateInputs, latestAsOf, parseDays, summarize } = require("./backtest-progressive-shadow.js");

const ts = (value) => new Date(`2026-01-01T00:${String(value).padStart(2, "0")}:00Z`);
const candle = (minute, o, h, l, c) => ({ ts: ts(minute), o, h, l, c });
const atr = (minute, value, valid = true) => ({ ts: ts(minute), period: 14, value, effective_value: value, is_valid: valid, input_hash: `atr-${minute}` });
const setup = (side = "buy") => ({ setup_instance_id: `setup-${side}`, plan_hash: "plan", side, source_ts: ts(0), confirmation_ts: ts(15), source_key: "source", evidence_json: { evidenceHash: "evidence" } });

describe("progressive outcome contract", () => {
  it("validates day bounds", () => {
    assert.equal(parseDays(["--days=90"]), 90);
    assert.throws(() => parseDays(["--days=0"]), /1 to 3650/);
  });

  it("selects latest ATR without future leakage", () => {
    assert.equal(latestAsOf([atr(0, 2), atr(2, 99)], ts(1)).effective_value, 2);
  });

  it("builds symmetric buy and sell geometry", () => {
    assert.deepEqual(buildGeometry(setup("buy"), atr(0, 2), candle(1, 100, 100, 100, 100)), { entry: 100, stopLoss: 98, takeProfit: 104, risk: 2 });
    assert.deepEqual(buildGeometry(setup("sell"), atr(0, 2), candle(1, 100, 100, 100, 100)), { entry: 100, stopLoss: 102, takeProfit: 96, risk: 2 });
  });

  it("fails closed on invalid ATR", () => {
    assert.equal(buildGeometry(setup(), atr(0, 2, false), candle(1, 100, 100, 100, 100)).blocker, "missing_valid_atr");
  });

  it("waits for confirmation candle completion and resolves ambiguity as loss", () => {
    const result = evaluateInputs({
      setups: [setup("buy")], atr: [atr(0, 2), atr(15, 2)],
      candles: [candle(15, 50, 200, 1, 50), candle(30, 100, 105, 97, 101)],
    });
    assert.equal(result.trades[0].effectiveEntry, 100);
    assert.equal(result.trades[0].outcome, "loss");
    assert.equal(result.trades[0].r, -1);
  });

  it("reports timeout separately from resolved statistics", () => {
    const result = evaluateInputs({
      setups: [setup("buy")], atr: [atr(15, 2)],
      candles: [candle(30, 100, 101, 99, 100.5)],
    });
    assert.equal(result.summary.timeouts, 1);
    assert.equal(result.summary.resolved, 0);
    assert.equal(result.summary.winRate, null);
  });

  it("computes R statistics and drawdown", () => {
    const summary = summarize([{ outcome: "win", r: 2 }, { outcome: "loss", r: -1 }, { outcome: "timeout", r: 0 }]);
    assert.equal(summary.netR, 1);
    assert.equal(summary.profitFactor, 2);
    assert.equal(summary.maxDrawdownR, 1);
  });
});
