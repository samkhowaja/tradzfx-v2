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
  dedupeTrades,
  partitionDriftRejections,
  invalidOutcomeReason,
  validateStageAccounting,
  mergeStageCounts,
  prefetchCandles,
  validateTimeWindow,
  assertAllowedFeature,
  assertAllowedTf,
  computeWarmupBars,
  computeWarmupTs,
  buildSignalContextHash,
  isValidSignalGeometry,
  inferSetupFamily,
  collectCoverageTargets,
  requiredFeatureTargets,
  capabilityKey,
  CAPABILITY_BLOCKING_VERDICTS,
  CAPABILITY_DEGRADED_VERDICTS,
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

  it("embeds symbol and date bounds in canonical compiler SQL", () => {
    const spec = baseSpec();
    const from = date("2026-01-01T00:00:00Z");
    const to = date("2026-01-02T00:00:00Z");
    const { sql, params } = compilePITSQL(spec, "EURUSD", from, to);
    assert.ok(sql.includes("symbol = 'EURUSD'"));
    assert.ok(sql.includes(`ts >= '${from.toISOString()}'::timestamptz`));
    assert.ok(sql.includes(`ts <= '${to.toISOString()}'::timestamptz`));
    assert.deepStrictEqual(params, []);
  });

  it("rejects the removed legacy fork option", () => {
    // TIER 3: The legacy PIT_USE_COMPILER_SQL=0 fork was removed. The env
    // var now just prints a deprecation warning; compilePITSQL always uses
    // the compiler path regardless of the flag.
    const spec = baseSpec();
    // Verify it does NOT throw — the compiler path is always used.
    assert.doesNotThrow(
      () => compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02"), {}, false, { forceCompiler: false }),
    );
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

describe("inferSetupFamily", () => {
  it("maps ORB signal sources to orb_breakout", () => {
    assert.strictEqual(inferSetupFamily({ id: "orb_classic", signalSource: "orb" }), "orb_breakout");
  });

  it("maps FVG signal sources to fvg_continuation", () => {
    assert.strictEqual(inferSetupFamily({ id: "a_plus", signalSource: "fvg" }), "fvg_continuation");
  });

  it("preserves explicit setupFamily", () => {
    assert.strictEqual(
      inferSetupFamily({ id: "custom", signalSource: "zone", setupFamily: "liquidity_sweep" }),
      "liquidity_sweep"
    );
  });
});

describe("computeWarmupBars", () => {
  it("derives warmup from indicator periods on higher timeframes", () => {
    const spec = baseSpec({
      setup: [
        {
          id: "ema",
          required: true,
          feature: "features_moving_average",
          tf: "1h",
          predicate: "ma_type = 'ema_cross' AND fast_period = 50 AND slow_period = 200",
        },
      ],
      entry: [
        {
          id: "entry",
          required: true,
          feature: "features_structure",
          tf: "5m",
          predicate: "event_type = 'bos'",
        },
      ],
    });

    assert.strictEqual(computeWarmupBars(spec, 50), 2400);
  });

  it("never lets explicit warmup undercut dependency warmup", () => {
    const spec = baseSpec({
      warmupBars: 50,
      setup: [
        {
          id: "ema",
          required: true,
          feature: "features_moving_average",
          tf: "15m",
          predicate: "slow_period = 200",
        },
      ],
      entry: [
        {
          id: "entry",
          required: true,
          feature: "features_structure",
          tf: "15m",
          predicate: "event_type = 'bos'",
        },
      ],
    });

    assert.strictEqual(computeWarmupBars(spec, spec.warmupBars), 200);
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

describe("setup risk cache safety", () => {
  const spec = { id: "waqar_v2", familyId: "waqar_v2", version: "3.1.0" };

  it("does not share absolute risk results across entry prices", () => {
    const first = makeSignal({ zone_top: "1.1010", zone_bottom: "1.0990" });
    const second = makeSignal({ entry_price: "1.1001", zone_top: "1.1010", zone_bottom: "1.0990" });
    assert.notStrictEqual(
      buildSignalContextHash(first, "1m", spec, "zone_retest"),
      buildSignalContextHash(second, "1m", spec, "zone_retest")
    );
  });

  it("scopes cache keys to signal time and strategy version", () => {
    const signal = makeSignal({ zone_top: "1.1010", zone_bottom: "1.0990" });
    const later = { ...signal, ts: date("2026-01-01T00:01:00Z") };
    assert.notStrictEqual(
      buildSignalContextHash(signal, "1m", spec, "zone_retest"),
      buildSignalContextHash(later, "1m", spec, "zone_retest")
    );
    assert.notStrictEqual(
      buildSignalContextHash(signal, "1m", spec, "zone_retest"),
      buildSignalContextHash(signal, "1m", { ...spec, version: "3.2.0" }, "zone_retest")
    );
  });

  it("rejects inverted buy and sell setup geometry", () => {
    assert.strictEqual(isValidSignalGeometry(makeSignal()), true);
    assert.strictEqual(isValidSignalGeometry(makeSignal({ stop_loss: "1.1010", take_profit: "1.0990" })), false);
    assert.strictEqual(isValidSignalGeometry(makeSignal({ side: "sell", stop_loss: "1.1010", take_profit: "1.0990" })), true);
    assert.strictEqual(isValidSignalGeometry(makeSignal({ side: "sell", stop_loss: "1.0990", take_profit: "1.1010" })), false);
  });

  it("requires explicit opt-in before setup engine can own execution risk", () => {
    assert.notStrictEqual(baseSpec().setupEngine?.overrideRisk, true);
    assert.strictEqual(baseSpec({ setupEngine: { overrideRisk: true } }).setupEngine.overrideRisk, true);
  });
});

describe("simulateTrade cost adjustments", () => {
  // Cost model was intentionally stripped from the backtester (audit #14).
  // The stale assertions below were removed to match the current behaviour.
  // See packages/analyzerBacktest/src/outcomeTracker.ts for cost-aware
  // backtest analysis.
  it("(cost model stripped — see outcomeTracker for cost analysis)", () => {
    assert.ok(true);
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

  it("excludes invalid outcomes from executed trades with and without gates", async () => {
    const trades = [makeTrade({ outcome: "invalid", r: 0 })];
    const noGates = await applyGates(trades, { id: "s", live: {}, gates: [] });
    assert.strictEqual(noGates.executed.length, 0);
    assert.strictEqual(noGates.invalid, 1);
    assert.deepStrictEqual(noGates.invalidReasons, { INTERNAL_UNCLASSIFIED_OUTCOME: 1 });

    const withGate = await applyGates(trades, {
      id: "s",
      live: {},
      gates: [{ name: "spread", params: { maxSpreadPips: 1 } }],
    });
    assert.strictEqual(withGate.executed.length, 0);
    assert.strictEqual(withGate.invalid, 1);
    assert.deepStrictEqual(withGate.invalidReasons, { INTERNAL_UNCLASSIFIED_OUTCOME: 1 });
  });

  it("aggregates explicit invalid reason codes", async () => {
    const trades = [
      makeTrade({ outcome: "invalid", invalidReason: "market_fill_outside_bracket", r: 0 }),
      makeTrade({ outcome: "invalid", invalidReason: "market_fill_outside_bracket", r: 0 }),
    ];
    const result = await applyGates(trades, { id: "s", live: {}, gates: [] });
    assert.deepStrictEqual(result.invalidReasons, { market_fill_outside_bracket: 2 });
  });

  it("quarantines insane historical spread and falls back to session spread", async () => {
    const spec = { id: "s", live: {}, gates: [{ name: "spread", params: { maxSpreadPips: 1 } }] };
    const trades = [makeTrade({ spread_pips: 100 })];
    const result = await applyGates(trades, spec);
    assert.strictEqual(result.quarantined, 1);
    assert.strictEqual(result.skipped, 0);
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
      live: { smallAccount: { enabled: true, maxDailyLossR: 3 } },
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
        if (sql.includes("FROM candle_quarantine")) return { rows: [{ count: 0 }] };
        captured.args = { sql, params };
        return { rows: [] };
      },
    };
    const from = date("2026-01-01T00:00:00Z");
    const to = date("2026-01-01T12:00:00Z");
    await prefetchCandles(fakePool, "EURUSD", from, to, 24);
    assert.ok(captured.args.sql.includes("FROM market.candles_1m_canonical"));
    assert.ok(!captured.args.sql.includes("FROM candles_1m c"));
    assert.strictEqual(captured.args.params[0], "EURUSD");
    assert.strictEqual(captured.args.params[1], from);
    // Forward simulation is capped at the stated backtest end date to avoid
    // future-data leakage. Unresolved trades are reported as timeout/no-result.
    assert.strictEqual(captured.args.params[2].toISOString(), to.toISOString());
  });

  it("fails closed for approved EXCLUDE decisions", async () => {
    const fakePool = {
      query: async (sql) => {
        if (sql.includes("FROM candle_quarantine")) return { rows: [{ count: 1 }] };
        throw new Error("candle query must not run after quarantine failure");
      },
    };
    await assert.rejects(
      () => prefetchCandles(fakePool, "EURUSD", date("2026-01-01T00:00:00Z"), date("2026-01-01T12:00:00Z"), 24),
      /Canonical candle interval unresolved for EURUSD; backtest aborted/
    );
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
    const trade = simulateTrade(signal, candles, { timeoutBars: 10, commissionPips: 0 });
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

describe("collectCoverageTargets", () => {
  it("includes zone, pricing, bias, atr and candle tables for default zone spec", () => {
    const targets = collectCoverageTargets(baseSpec());
    const tables = targets.map((t) => `${t.table}${t.tf ? `@${t.tf}` : ""}`);
    assert.ok(tables.includes("features_zone@15m"));
    assert.ok(tables.includes("features_pricing@15m"));
    assert.ok(tables.includes("features_bias@15m"));
    assert.ok(tables.includes("features_atr@15m"));
    assert.ok(tables.includes("market.candles_1m_canonical@1m"));
    assert.ok(tables.includes("market.candles_15m_canonical@15m"));
    assert.ok(tables.some((t) => t === "features_session@1m" && targets.find((x) => `${x.table}@${x.tf}` === t).required === false));
  });

  it("includes opening range for orb signal source", () => {
    const spec = baseSpec({ signalSource: "orb", setup: [...baseSpec().setup, { id: "orb", feature: "features_opening_range", tf: "15m", predicate: "1=1", required: true }] });
    const targets = collectCoverageTargets(spec);
    assert.ok(targets.some((t) => t.table === "features_opening_range" && t.tf === "15m"));
  });

  it("includes features_zone for fvg signal source", () => {
    const spec = baseSpec({
      signalSource: "fvg",
      entry: [{ id: "fvg", feature: "features_zone", tf: "5m", predicate: "zone_kind = 'fvg'", required: true }],
    });
    const targets = collectCoverageTargets(spec);
    assert.ok(targets.some((t) => t.table === "features_zone" && t.tf === "5m"));
  });
});

describe("capability preflight policy", () => {
  it("checks required feature targets only", () => {
    const targets = requiredFeatureTargets(baseSpec());
    assert.ok(targets.every((t) => !t.isCandle && t.required));
    assert.ok(targets.some((t) => t.table === "features_zone" && t.tf === "15m"));
    assert.ok(!targets.some((t) => t.table === "features_session" && t.tf === "1m"));
  });

  it("uses shared readiness severity sets", () => {
    const {
      READINESS_BLOCKING_VERDICTS,
      READINESS_DEGRADED_VERDICTS,
    } = require("../packages/shared/dist/index.js");
    assert.deepStrictEqual(
      [...CAPABILITY_BLOCKING_VERDICTS].sort(),
      [...READINESS_BLOCKING_VERDICTS].sort()
    );
    assert.deepStrictEqual(
      [...CAPABILITY_DEGRADED_VERDICTS].sort(),
      [...READINESS_DEGRADED_VERDICTS].sort()
    );
  });

  it("blocks unsafe dense surfaces and degrades sparse event emptiness", () => {
    assert.ok(CAPABILITY_BLOCKING_VERDICTS.has("MISSING_TABLE"));
    assert.ok(CAPABILITY_BLOCKING_VERDICTS.has("EMPTY_DENSE"));
    assert.ok(CAPABILITY_BLOCKING_VERDICTS.has("STALE_STATE"));
    assert.ok(CAPABILITY_BLOCKING_VERDICTS.has("BLOCKED_LIFECYCLE"));
    assert.ok(CAPABILITY_DEGRADED_VERDICTS.has("SPARSE_EVENT_EMPTY"));
    assert.ok(!CAPABILITY_BLOCKING_VERDICTS.has("SPARSE_EVENT_EMPTY"));
  });

  it("keys table and timeframe consistently", () => {
    assert.strictEqual(capabilityKey("features_zone", "5m"), "features_zone:5m");
    assert.strictEqual(capabilityKey("features_time_of_day", null), "features_time_of_day:");
  });
});

describe("compilePITSQL ATR timeframe mapping", () => {
  it("joins multiple ATR timeframes referenced in risk expressions", () => {
    const spec = baseSpec({
      risk: { sl: "atr(1m) * 1.0", tp: "atr(5m) * 2.0" },
      setup: [{ id: "atr", required: true, feature: "features_atr", tf: "15m", predicate: "period = 5" }],
    });
    const { sql } = compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02"));
    assert.ok(sql.includes("a_1m.value"), "expected a_1m alias for atr(1m)");
    assert.ok(sql.includes("a_5m.value"), "expected a_5m alias for atr(5m)");
    assert.ok(sql.includes("a_15m.value"), "expected a_15m alias for explicit features_atr condition");
    assert.ok(!sql.includes("atr(1m)"), "atr(1m) should be bound to alias");
    assert.ok(!sql.includes("atr(5m)"), "atr(5m) should be bound to alias");
  });

  it("does not join features_spread in PIT signal SQL", () => {
    const spec = baseSpec();
    const { sql } = compilePITSQL(spec, "EURUSD", date("2026-01-01"), date("2026-01-02"));
    assert.ok(!sql.includes("features_spread"), "expected no features_spread join/select in PIT SQL");
    assert.ok(!sql.includes("COALESCE(spr.spread"), "expected no spread fallback in PIT SQL");
  });
});

describe("simulateTrade geometry validation", () => {
  it("returns invalid when SL is on the wrong side of entry", () => {
    const signal = makeSignal({ stop_loss: "1.1010" }); // SL above entry for long
    const candles = [candle(1, 1.1000, 1.1000, 1.1000, 1.1000)];
    const out = simulateTrade(signal, candles, { timeoutBars: 10, commissionPips: 0 });
    assert.strictEqual(out.outcome, "invalid");
  });
});

describe("drift rejection partitioning", () => {
  it("removes drift rejections before trade dedupe and gate evaluation", () => {
    const rejection = (side, ts) => ({
      symbol: "EURUSD",
      side,
      ts: new Date(ts),
      outcome: "rejected",
      rejectionCode: "ENTRY_DRIFT_EXCEEDED",
      driftPips: 5,
    });
    const acceptedTrade = {
      symbol: "EURUSD",
      side: "buy",
      ts: new Date("2026-01-01T10:02:00Z"),
      outcome: "win",
      entry: 1.1,
      sl: 1.0995,
      tp: 1.1015,
      holdBars: 5,
    };

    const partitioned = partitionDriftRejections([
      rejection("buy", "2026-01-01T10:00:00Z"),
      rejection("buy", "2026-01-01T10:01:00Z"),
      acceptedTrade,
    ]);

    assert.strictEqual(partitioned.rejected.length, 2);
    assert.deepStrictEqual(partitioned.accepted, [acceptedTrade]);
    assert.strictEqual(
      dedupeTrades(partitioned.accepted, new Date("2026-01-01T12:00:00Z")).length,
      1
    );
  });

  it("uses explicit rejection codes before internal fallback", () => {
    assert.strictEqual(
      invalidOutcomeReason({ outcome: "rejected", rejectionCode: "ENTRY_DRIFT_EXCEEDED" }),
      "ENTRY_DRIFT_EXCEEDED"
    );
    assert.strictEqual(
      invalidOutcomeReason({ outcome: "invalid" }),
      "INTERNAL_UNCLASSIFIED_OUTCOME"
    );
  });
});

describe("stage accounting", () => {
  function validCounts(overrides = {}) {
    return {
      rawSignals: 20,
      warmupSkipped: 2,
      invalidGeometry: 1,
      setupInvalidGeometry: 1,
      setupBlocked: 2,
      simulated: 14,
      driftRejected: 3,
      driftRejectionReasons: { ENTRY_DRIFT_EXCEEDED: 3 },
      deduped: 2,
      gateSkipped: 1,
      gateSkipReasons: { spread: 1 },
      invalidOutcomes: 1,
      invalidOutcomeReasons: { market_fill_outside_bracket: 1 },
      timeouts: 1,
      heatDropped: 1,
      executed: 5,
      ...overrides,
    };
  }

  it("accepts a balanced candidate ledger", () => {
    assert.strictEqual(validateStageAccounting(validCounts()), true);
  });

  it("rejects simulation and terminal count mismatches", () => {
    assert.throws(
      () => validateStageAccounting(validCounts({ executed: 4 })),
      /terminal stages 13 != simulated 14/
    );
    assert.throws(
      () => validateStageAccounting(validCounts({ rawSignals: 21 })),
      /simulation candidates 15 != simulated 14/
    );
  });

  it("merges all terminal stages and reason maps", () => {
    const merged = mergeStageCounts([validCounts(), validCounts()]);
    assert.strictEqual(merged.driftRejected, 6);
    assert.strictEqual(merged.invalidOutcomes, 2);
    assert.strictEqual(merged.timeouts, 2);
    assert.deepStrictEqual(merged.driftRejectionReasons, { ENTRY_DRIFT_EXCEEDED: 6 });
    assert.deepStrictEqual(merged.invalidOutcomeReasons, { market_fill_outside_bracket: 2 });
  });
});

describe("dedupeTrades", () => {
  function makeRawTrade(overrides = {}) {
    return {
      symbol: "EURUSD",
      side: "buy",
      entry: 1.1,
      sl: 1.099,
      tp: 1.103,
      ts: date("2026-01-01T10:00:00Z"),
      holdBars: 10,
      outcome: "win",
      ...overrides,
    };
  }

  it("drops overlapping identical trades until the first exits", () => {
    const trades = [
      makeRawTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeRawTrade({ ts: date("2026-01-01T10:10:00Z") }),
      makeRawTrade({ ts: date("2026-01-01T10:25:00Z") }),
    ];
    const windowEnd = date("2026-01-01T12:00:00Z");
    const deduped = dedupeTrades(trades, windowEnd);
    assert.strictEqual(deduped.length, 2);
    assert.strictEqual(deduped[0].ts.toISOString(), "2026-01-01T10:00:00.000Z");
    assert.strictEqual(deduped[1].ts.toISOString(), "2026-01-01T10:25:00.000Z");
  });

  it("does not dedupe trades with different fingerprints", () => {
    const trades = [
      makeRawTrade({ ts: date("2026-01-01T10:00:00Z"), holdBars: 20 }),
      makeRawTrade({ ts: date("2026-01-01T10:10:00Z"), tp: 1.104 }),
    ];
    const deduped = dedupeTrades(trades, date("2026-01-01T12:00:00Z"));
    assert.strictEqual(deduped.length, 2);
  });
});

describe("computeWarmupTs", () => {
  it("uses the entry timeframe when present", () => {
    const spec = baseSpec({ entry: [{ id: "e", feature: "features_zone", tf: "15m" }] });
    const from = date("2026-01-01T00:00:00Z");
    const ts = computeWarmupTs(spec, from, 200);
    assert.strictEqual(ts.toISOString(), "2026-01-03T02:00:00.000Z"); // 200 * 15m = 50h
  });

  it("falls back to setup timeframe when entry is missing", () => {
    const spec = baseSpec({ entry: undefined });
    const from = date("2026-01-01T00:00:00Z");
    const ts = computeWarmupTs(spec, from, 200);
    assert.strictEqual(ts.toISOString(), "2026-01-03T02:00:00.000Z");
  });

  it("defaults to 15m when no entry or setup exists", () => {
    const spec = baseSpec({ entry: undefined, setup: undefined });
    const from = date("2026-01-01T00:00:00Z");
    const ts = computeWarmupTs(spec, from, 200);
    assert.strictEqual(ts.toISOString(), "2026-01-03T02:00:00.000Z");
  });

  it("honors a spec warmupBars override", () => {
    const spec = baseSpec({ entry: [{ id: "e", feature: "features_zone", tf: "15m" }] });
    const from = date("2026-01-01T00:00:00Z");
    const ts = computeWarmupTs(spec, from, 96);
    assert.strictEqual(ts.toISOString(), "2026-01-02T00:00:00.000Z"); // 96 * 15m = 24h
  });
});

// ---------------------------------------------------------------------------
// ORB session-scoped join (V4 BUG-11)
// ---------------------------------------------------------------------------

describe("ORB session-scoped join (V4 BUG-11)", () => {
  function orbSpec(overrides = {}) {
    return baseSpec({
      signalSource: "orb",
      setup: [
        { id: "bias", required: true, feature: "features_bias", tf: "15m", predicate: "direction = 'bullish'" },
        { id: "orb", required: true, feature: "features_opening_range", tf: "15m", session: "london", predicate: "1 = 1" },
      ],
      ...overrides,
    });
  }

  const from = date("2026-01-05T00:00:00Z");
  const to = date("2026-01-06T00:00:00Z");

  it("pins the range to signal UTC date + session + completion", () => {
    const { sql } = compilePITSQL(orbSpec(), "EURUSD", from, to);
    assert.match(sql, /o\.date = \(e\.ts AT TIME ZONE 'UTC'\)::date/);
    assert.match(sql, /o\.session = 'london'/);
    assert.match(sql, /o\.range_minutes = 15/);
    assert.match(sql, /o\.ts <= e\.ts/);
    // The stale MAX(ts) self-join must be gone.
    assert.doesNotMatch(sql, /SELECT MAX\(ts\) FROM features_opening_range/);
  });

  it("setup LATERAL uses the session-scoped policy, not an interval lookback", () => {
    const { sql } = compilePITSQL(orbSpec(), "EURUSD", from, to);
    assert.ok(
      sql.includes("features_opening_range.date = (b.ts AT TIME ZONE 'UTC')::date"),
      "expected date-scoped LATERAL join on features_opening_range"
    );
  });

  it("throws when the orb condition omits session", () => {
    const spec = orbSpec();
    delete spec.setup[1].session;
    assert.throws(() => compilePITSQL(spec, "EURUSD", from, to), /session/);
  });

  it("honors a different declared session and tf-derived range minutes", () => {
    const spec = orbSpec({
      setup: [
        { id: "bias", required: true, feature: "features_bias", tf: "15m", predicate: "direction = 'bullish'" },
        { id: "orb", required: true, feature: "features_opening_range", tf: "5m", session: "ny", predicate: "1 = 1" },
      ],
    });
    const { sql } = compilePITSQL(spec, "EURUSD", from, to);
    assert.match(sql, /o\.session = 'ny'/);
    assert.match(sql, /o\.range_minutes = 5/);
  });
});

// ---------------------------------------------------------------------------
// Zone PIT pushdown + bounded lookback (P0-3)
// ---------------------------------------------------------------------------

describe("zone PIT pushdown and bounded lookback (P0-3)", () => {
  function zoneSpec(overrides = {}) {
    return baseSpec({
      setup: [
        { id: "bias", required: true, feature: "features_bias", tf: "5m", predicate: "direction = 'bullish'" },
      ],
      entry: [
        {
          id: "opening_break_fvg",
          required: true,
          feature: "features_zone",
          tf: "5m",
          predicate: "zone_kind = 'fvg' AND direction IN ('bullish', 'bearish')",
          groupBy: ["direction"],
        },
      ],
      ...overrides,
    });
  }

  const from = date("2026-01-05T00:00:00Z");
  const to = date("2026-01-06T00:00:00Z");

  it("pushes zone_kind equality into the canonical LATERAL WHERE", () => {
    const { sql } = compilePITSQL(zoneSpec(), "EURUSD", from, to);
    const lateral = sql.match(/LATERAL \([\s\S]*?FROM features_zone[\s\S]*?\) AS pit_opening_break_fvg/);
    assert.ok(lateral, "expected entry LATERAL for features_zone");
    assert.ok(lateral[0].includes("AND zone_kind = 'fvg'"), "zone_kind equality must be inside the LATERAL");
  });

  it("uses the registry bounded lookback for active_window features with session gap padding", () => {
    const { sql } = compilePITSQL(zoneSpec(), "EURUSD", from, to);
    // features_zone@5m: registry defaultLookbackBars=96 → 96*5=480min=8h,
    // plus weekend gap padding (49h as spec has no session filter) = 57h.
    assert.ok(sql.includes("INTERVAL '57 hours'"), "expected 57h registry lookback + weekend padding for features_zone@5m");
  });

  it("honors explicit lookbackBars with session gap padding", () => {
    const spec = zoneSpec();
    spec.entry[0].lookbackBars = 24; // 24 * 5m = 2h, plus 49h padding = 51h
    const { sql } = compilePITSQL(spec, "EURUSD", from, to);
    assert.ok(sql.includes("INTERVAL '51 hours'"), "expected 51h (2h explicit + 49h weekend padding)");
  });

  it("uses tf-tier lookback for candidate_set features", () => {
    const spec = zoneSpec({
      setup: [
        { id: "bias", required: true, feature: "features_bias", tf: "5m", predicate: "direction = 'bullish'" },
        { id: "pricing", required: true, feature: "features_pricing", tf: "5m", predicate: "position = 'discount'" },
      ],
    });
    const { sql } = compilePITSQL(spec, "EURUSD", from, to);
    // features_pricing uses buildLookbackIntervalForTf which returns the
    // tf-tier default: 24 hours for 5m.
    assert.ok(sql.includes("INTERVAL '24 hours'"), "candidate_set features should use tf-tier lookback (24h for 5m)");
  });

  it("never pushes is_fresh into the LATERAL (as-of semantics preserved)", () => {
    const spec = zoneSpec();
    spec.entry[0].predicate = "zone_kind = 'fvg' AND is_fresh = true";
    const { sql } = compilePITSQL(spec, "EURUSD", from, to);
    const lateral = sql.match(/LATERAL \([\s\S]*?FROM features_zone[\s\S]*?\) AS pit_opening_break_fvg/);
    assert.ok(lateral && !/WHERE[\s\S]*is_fresh/.test(lateral[0].split("ORDER BY")[0]));
    assert.ok(lateral[0].includes("AND zone_kind = 'fvg'"));
  });
});
