/**
 * Unit tests for scripts/backtest-pit-v2.js
 *
 * Run with: node --test scripts/backtest-pit-v2.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert");

const mod = require("./backtest-pit-v2.js");
const {
  compilePITSQL,
  simulateTrade,
  buildGateEvaluators,
  applyGates,
  computeStats,
  evaluatePortfolioHeat,
  prefetchCandles,
  validateTimeWindow,
  assertAllowedFeature,
  assertAllowedTf,
} = mod;

function baseSpec(overrides = {}) {
  return {
    id: "test_spec",
    signalSource: "zone",
    setup: [
      {
        id: "bias",
        required: true,
        feature: "features_bias",
        tf: "15m",
        predicate: "direction = 'bullish'",
      },
      {
        id: "pricing",
        required: true,
        feature: "features_pricing",
        tf: "15m",
        predicate: "position = 'discount'",
      },
    ],
    entry: [
      {
        id: "zone",
        required: true,
        feature: "features_zone",
        tf: "15m",
        predicate: "zone_kind = 'demand'",
      },
    ],
    risk: { sl: "1 pips", tp: "sl * 2" },
    filters: { symbols: ["EURUSD"] },
    ...overrides,
  };
}

function date(iso) {
  return new Date(iso);
}

// ---------------------------------------------------------------------------
// Phase 1: SQL sanitization
// ---------------------------------------------------------------------------

describe("compilePITSQL sanitization", () => {
  it("rejects a disallowed feature table", () => {
    const spec = baseSpec({
      setup: [{ id: "bad", required: true, feature: "features_hacked", tf: "15m", predicate: "1=1" }],
    });
    assert.throws(() => compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02")), /Disallowed feature table/);
  });

  it("rejects a disallowed timeframe", () => {
    const spec = baseSpec({
      setup: [{ id: "bad", required: true, feature: "features_bias", tf: "1week", predicate: "1=1" }],
    });
    assert.throws(() => compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02")), /Disallowed timeframe/);
  });

  it("rejects a disallowed groupBy column", () => {
    const spec = baseSpec({
      entry: [{ id: "zone", required: true, feature: "features_zone", tf: "15m", predicate: "1=1", groupBy: ["hacked"] }],
    });
    assert.throws(() => compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02")), /Disallowed groupBy column/);
  });

  it("rejects a symbol not in the spec filter list", () => {
    const spec = baseSpec();
    assert.throws(() => compilePITSQL(spec, "GBPUSD", date("2026-01-01"), date("2026-01-02")), /not in allowed list/);
  });

  it("rejects bad time windows", () => {
    const spec = baseSpec({ filters: { symbols: ["EURUSD"], timeWindows: [{ utcStart: "25:00", utcEnd: "12:00" }] } });
    assert.throws(() => compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02")), /hours out of range/);
  });

  it("parameterizes symbol and date bounds", () => {
    const spec = baseSpec();
    const from = date("2026-01-01T00:00:00Z");
    const to = date("2026-01-02T00:00:00Z");
    const { sql, params } = compilePITSQL(spec, "EURUSD", from, to);
    assert.ok(sql.includes("symbol = $1"));
    assert.ok(sql.includes("ts >= $2::timestamp"));
    assert.ok(sql.includes("ts <= $3::timestamp"));
    assert.strictEqual(params[0], "EURUSD");
    assert.strictEqual(params[1], from);
    assert.strictEqual(params[2], to);
  });

  it("parameterizes structure freshness when used", () => {
    const spec = baseSpec({
      entry: [{ id: "struct", required: true, feature: "features_structure", tf: "15m", predicate: "1=1" }],
    });
    const { sql, params } = compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02"), { structureFreshnessMinutes: 60 });
    assert.ok(sql.includes("($4 * interval '1 minute')"));
    assert.strictEqual(params[3], 60);
  });
});

describe("validateTimeWindow", () => {
  it("accepts valid windows", () => {
    const v = validateTimeWindow({ utcStart: "08:00", utcEnd: "12:00" });
    assert.strictEqual(v.startMin, 480);
    assert.strictEqual(v.endMin, 720);
  });

  it("rejects invalid minute format", () => {
    assert.throws(() => validateTimeWindow({ utcStart: "8:00", utcEnd: "12:00" }), /must match HH:MM/);
  });
});

describe("assertAllowedFeature and assertAllowedTf", () => {
  it("allows whitelisted values", () => {
    assert.strictEqual(assertAllowedFeature("features_zone"), undefined);
    assert.strictEqual(assertAllowedTf("1h"), undefined);
  });

  it("rejects unknown values", () => {
    assert.throws(() => assertAllowedFeature("features_bad"), /Disallowed feature table/);
    assert.throws(() => assertAllowedTf("10m"), /Disallowed timeframe/);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: transaction costs
// ---------------------------------------------------------------------------

function makeSignal(overrides = {}) {
  return {
    ts: date("2026-01-01T00:00:00Z"),
    symbol: "EURUSD",
    side: "buy",
    entry_price: "1.1000",
    stop_loss: "1.0990",
    take_profit: "1.1030",
    entry_type: "market",
    atr_5: 0.001,
    spread_pips: 0.5,
    ...overrides,
  };
}

function candle(tsOffsetMin, o, h, l, c) {
  return {
    ts: new Date(date("2026-01-01T00:00:00Z").getTime() + tsOffsetMin * 60000),
    o: String(o),
    h: String(h),
    l: String(l),
    c: String(c),
  };
}

describe("simulateTrade cost adjustments", () => {
  it("worsens long market entry by spread/2 + slippage", () => {
    const signal = makeSignal();
    const candles = [candle(1, 1.1000, 1.1001, 1.1000, 1.1001), candle(2, 1.1001, 1.1035, 1.1000, 1.1035)];
    const out = simulateTrade(signal, candles, { timeoutBars: 10, spreadPips: 1, slippagePips: 1, pipSize: 0.0001 });
    assert.ok(out.effectiveEntry > 1.1000, `expected effectiveEntry > 1.1000, got ${out.effectiveEntry}`);
    assert.strictEqual(out.outcome, "win");
  });

  it("worsens short market entry", () => {
    const signal = makeSignal({ side: "sell", entry_price: "1.1000", stop_loss: "1.1010", take_profit: "1.0970" });
    const candles = [candle(1, 1.1000, 1.1000, 1.0999, 1.0999), candle(2, 1.0999, 1.0999, 1.0965, 1.0965)];
    const out = simulateTrade(signal, candles, { timeoutBars: 10, spreadPips: 1, slippagePips: 1, pipSize: 0.0001 });
    assert.ok(out.effectiveEntry < 1.1000, `expected effectiveEntry < 1.1000, got ${out.effectiveEntry}`);
    assert.strictEqual(out.outcome, "win");
  });

  it("reduces win R after cost on SL/TP exit", () => {
    const signal = makeSignal();
    const candles = [candle(1, 1.1000, 1.1000, 1.1000, 1.1000), candle(2, 1.1000, 1.1035, 1.1000, 1.1035)];
    const gross = simulateTrade(signal, candles, { timeoutBars: 10, spreadPips: 0, slippagePips: 0, pipSize: 0.0001 });
    const cost = simulateTrade(signal, candles, { timeoutBars: 10, spreadPips: 2, slippagePips: 0, pipSize: 0.0001 });
    assert.strictEqual(gross.outcome, "win");
    assert.strictEqual(cost.outcome, "win");
    assert.ok(cost.r < gross.r, `cost-adjusted R ${cost.r} should be below gross R ${gross.r}`);
  });

  it("applies slippage only on limit fill", () => {
    const signal = makeSignal({ entry_type: "limit", entry_price: "1.0995" });
    const candles = [candle(1, 1.1000, 1.1000, 1.0994, 1.0994), candle(2, 1.0994, 1.1035, 1.0994, 1.1035)];
    const out = simulateTrade(signal, candles, { timeoutBars: 10, spreadPips: 2, slippagePips: 1, pipSize: 0.0001 });
    assert.strictEqual(out.outcome, "win");
    // effective entry = 1.0995 + 1 pip slippage = 1.0996; spread should not be added.
    assert.strictEqual(out.effectiveEntry, 1.0996);
  });
});

// ---------------------------------------------------------------------------
// Phase 3: gates
// ---------------------------------------------------------------------------

describe("buildGateEvaluators", () => {
  it("creates spread, volatility, familyPosition and smallAccount evaluators", () => {
    const evaluators = buildGateEvaluators(
      [
        { name: "spread", params: { maxSpreadPips: 1 } },
        { name: "volatility", params: { maxAtr5Pips: 20 } },
        { name: "familyPosition", params: { maxPerFamilyPerSymbol: 1 } },
        { name: "smallAccount", params: { enabled: true, maxPositionsTotal: 1 } },
      ],
      { id: "s", live: {} }
    );
    assert.strictEqual(evaluators.length, 4);
    assert.deepStrictEqual(evaluators.map((e) => e.name), ["spread", "volatility", "familyPosition", "smallAccount"]);
  });
});

describe("applyGates with synthetic trades", () => {
  function makeTrade(overrides = {}) {
    return {
      symbol: "EURUSD",
      side: "buy",
      ts: date("2026-01-01T10:00:00Z"),
      outcome: "win",
      r: 1,
      holdBars: 10,
      atr_5: 0.0005,
      spread_pips: 0.5,
      ...overrides,
    };
  }

  it("spread gate blocks when spread too wide", async () => {
    const spec = { id: "s", live: {}, gates: [{ name: "spread", params: { maxSpreadPips: 1 } }] };
    const trades = [makeTrade({ spread_pips: 2 })];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.spread, 1);
  });

  it("volatility gate blocks when ATR too high", async () => {
    const spec = { id: "s", live: {}, gates: [{ name: "volatility", params: { maxAtr5Pips: 10 } }] };
    // EURUSD pipSize 0.0001 -> 0.002 = 20 pips
    const trades = [makeTrade({ atr_5: 0.002 })];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.volatility, 1);
  });

  it("familyPosition gate blocks second trade in same family/symbol", async () => {
    const spec = { id: "s", familyId: "fam1", live: {}, gates: [{ name: "familyPosition", params: { maxPerFamilyPerSymbol: 1 } }] };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:10:00Z") }),
    ];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.familyPosition, 1);
  });

  it("smallAccount gate blocks on max total positions", async () => {
    const spec = {
      id: "s",
      live: { smallAccount: { enabled: true, maxPositionsTotal: 1 } },
      gates: [{ name: "smallAccount", params: {} }],
    };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:10:00Z") }),
    ];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.smallAccount, 1);
  });

  it("smallAccount gate blocks on daily loss limit", async () => {
    const spec = {
      id: "s",
      live: { smallAccount: { enabled: true, maxDailyLossPct: 3 } },
      gates: [{ name: "smallAccount", params: {} }],
    };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), outcome: "loss", r: -5, holdBars: 1 }),
      makeTrade({ ts: date("2026-01-01T10:05:00Z") }),
    ];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.smallAccount, 1);
  });

  it("smallAccount gate blocks on consecutive losses", async () => {
    const spec = {
      id: "s",
      live: { smallAccount: { enabled: true, maxConsecutiveLosses: 2 } },
      gates: [{ name: "smallAccount", params: {} }],
    };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), outcome: "loss", r: -1, holdBars: 1 }),
      makeTrade({ ts: date("2026-01-01T10:05:00Z"), outcome: "loss", r: -1, holdBars: 1 }),
      makeTrade({ ts: date("2026-01-01T10:10:00Z") }),
    ];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.smallAccount, 1);
  });

  it("smallAccount gate blocks on cooldown", async () => {
    const spec = {
      id: "s",
      live: { smallAccount: { enabled: true, cooldownMinutes: 15 } },
      gates: [{ name: "smallAccount", params: {} }],
    };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 1 }),
      makeTrade({ ts: date("2026-01-01T10:05:00Z") }),
    ];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(result.reasons.smallAccount, 1);
  });
});

describe("evaluatePortfolioHeat", () => {
  function makeTrade(overrides = {}) {
    return {
      symbol: "EURUSD",
      side: "buy",
      ts: date("2026-01-01T10:00:00Z"),
      outcome: "win",
      r: 1,
      holdBars: 10,
      ...overrides,
    };
  }

  it("passes the first N trades up to the total heat limit", () => {
    const spec = { gates: [{ name: "portfolioHeat", params: { maxConcurrentTotal: 2 } }] };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:05:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:10:00Z"), holdBars: 20 }),
    ];
    const marked = evaluatePortfolioHeat(trades, spec);
    assert.strictEqual(marked.filter((t) => t.heatDropped).length, 1);
    assert.strictEqual(computeStats(marked).total, 2);
  });

  it("enforces per-symbol heat limit", () => {
    const spec = { gates: [{ name: "portfolioHeat", params: { maxConcurrentPerSymbol: 1 } }] };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:05:00Z"), holdBars: 20 }),
    ];
    const marked = evaluatePortfolioHeat(trades, spec);
    assert.strictEqual(marked.filter((t) => t.heatDropped).length, 1);
  });

  it("drops do not occupy heat capacity", () => {
    const spec = { gates: [{ name: "portfolioHeat", params: { maxConcurrentTotal: 1 } }] };
    const trades = [
      makeTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 5 }),
      makeTrade({ ts: date("2026-01-01T10:02:00Z"), holdBars: 20 }),
      makeTrade({ ts: date("2026-01-01T10:10:00Z"), holdBars: 20 }),
    ];
    const marked = evaluatePortfolioHeat(trades, spec);
    // First trade closes at 10:05; second is dropped at 10:02; third enters at 10:10 because the drop did not count.
    assert.strictEqual(marked.filter((t) => t.heatDropped).length, 1);
    assert.strictEqual(computeStats(marked).total, 2);
  });

  it("is a no-op when no portfolioHeat gate is configured", () => {
    const trades = [makeTrade(), makeTrade()];
    const marked = evaluatePortfolioHeat(trades, { gates: [] });
    assert.strictEqual(marked.every((t) => t.heatDropped === false), true);
  });
});

// ---------------------------------------------------------------------------
// Phase 4: candle prefetch
// ---------------------------------------------------------------------------

describe("prefetchCandles", () => {
  it("queries the expected range", async () => {
    const captured = { args: null };
    const fakePool = {
      query: async (sql, params) => {
        captured.args = { sql, params };
        return { rows: [] };
      },
    };
    const from = date("2026-01-01T00:00:00Z");
    const to = date("2026-01-01T12:00:00Z");
    await prefetchCandles(fakePool, "EURUSD", from, to, 24);
    assert.ok(captured.args.sql.includes("FROM candles_1m"));
    assert.strictEqual(captured.args.params[0], "EURUSD");
    assert.strictEqual(captured.args.params[1], from);
    // Forward simulation is capped at the stated backtest end date to avoid
    // future-data leakage. Unresolved trades are reported as timeout/no-result.
    assert.strictEqual(captured.args.params[2].toISOString(), to.toISOString());
  });
});

// ---------------------------------------------------------------------------
// Phase 5: smoke test
// ---------------------------------------------------------------------------

describe("smoke test", () => {
  it("runs compile + simulate + gates + stats end-to-end", async () => {
    const spec = baseSpec();
    const { sql, params } = compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02"));
    assert.ok(sql.length > 0);
    assert.ok(Array.isArray(params));

    const signal = makeSignal();
    const candles = [candle(1, 1.1000, 1.1000, 1.1000, 1.1000), candle(2, 1.1000, 1.1035, 1.1000, 1.1035)];
    const trade = simulateTrade(signal, candles, { timeoutBars: 10 });
    assert.ok(["win", "loss", "timeout", "no_fill"].includes(trade.outcome));

    const rawTrades = [{
      ...signal,
      entry: 1.1,
      sl: 1.099,
      tp: 1.103,
      entryType: "market",
      ...trade,
    }];
    const gated = await applyGates(rawTrades, { id: "s", live: {}, gates: [] });
    assert.strictEqual(gated.executed.length, 1);

    const stats = computeStats(gated.executed);
    assert.strictEqual(stats.total, 1);
  });
});
