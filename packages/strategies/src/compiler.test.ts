import { describe, it, expect } from "vitest";
import { compileStrategy } from "./compiler";
import { buildLookbackInterval, sessionGapPaddingMinutes } from "./sqlBuilder";
import type { StrategyCondition, StrategySpec } from "@tm/shared";

function baseSpec(overrides: Partial<StrategySpec> = {}): StrategySpec {
  return {
    id: "test",
    name: "Test",
    version: "1",
    signalSource: "zone",
    filters: { symbols: ["EURUSD"] },
    setup: [
      {
        id: "bias",
        feature: "features_bias",
        tf: "15m",
        predicate: "direction != 'neutral'",
        required: true,
      },
    ],
    entry: [
      {
        id: "structure",
        feature: "features_structure",
        tf: "15m",
        predicate: "event_type IN ('bos','mss')",
        required: true,
      },
    ],
    risk: {
      sl: "atr(15m) * 1.2",
      tp: "sl * 3.0",
      minRR: 3,
      timeoutBars: 10,
    },
    gates: [],
    ...overrides,
  };
}

describe("compileStrategy", () => {
  it("uses custom risk.sl and risk.tp formulas", () => {
    const spec = baseSpec({
      risk: {
        sl: "atr(15m) * 2.0",
        tp: "sl * 2.5",
        minRR: 2.5,
        timeoutBars: 10,
      },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    // ATR binds via COALESCE(effective_value, value) (winsorized ATR, P0-A / SK-64).
    expect(sql).toMatch(/COALESCE\(a_15m\.effective_value,\s*a_15m\.value\)\s*\*\s*2\.0/);
    expect(sql).toMatch(/COALESCE\(a_15m\.effective_value,\s*a_15m\.value\)[\s\S]{0,40}?\*\s*2\.50/);
  });

  it("emits entry_type and offset entry_price for limit orders", () => {
    const spec = baseSpec({
      entryConfig: { type: "limit", zonePips: 0.0005 },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("'limit' as entry_type");
    expect(sql).toContain("- 0.0005");
  });

  it("emits entry_type and offset entry_price for stop orders", () => {
    const spec = baseSpec({
      entryConfig: { type: "stop", zonePips: 0.0005 },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("'stop' as entry_type");
    expect(sql).toContain("+ 0.0005");
  });

  it("does not emit entry_type column when entryConfig is absent", () => {
    const spec = baseSpec();
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).not.toContain("entry_type");
  });

  it("supports pip-based stop-loss expressions", () => {
    const spec = baseSpec({
      risk: {
        sl: "10 pips",
        tp: "sl * 2.0",
        minRR: 2,
        timeoutBars: 10,
      },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("(10 * (COALESCE(p.pip_size");
    expect(sql).toContain(" * 2.00");
  });

  it("uses a bounded LATERAL lookup for zones instead of MAX(ts)", () => {
    const spec = baseSpec({ signalSource: "zone" });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).not.toMatch(/JOIN features_zone z ON[^]*MAX\(ts\) FROM features_zone/s);
    expect(sql).toContain("JOIN LATERAL");
    expect(sql).toContain("FROM features_zone z");
    expect(sql).toContain("z.mitigated_at IS NULL OR z.mitigated_at > e.ts");
    expect(sql).toContain("z.invalidated_at IS NULL OR z.invalidated_at > e.ts");
    expect(sql).toContain("z.ts >= e.ts - INTERVAL");
  });

  it("ranks zone signal by nearest price level, then quality/strength", () => {
    const spec = baseSpec({ signalSource: "zone" });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("z.rank_score DESC NULLS LAST");
    expect(sql).toContain("z.strength_score DESC NULLS LAST");
    expect(sql).toContain("z.quality_score DESC NULLS LAST");
  });

  it("uses a bounded LATERAL lookup for FVGs through features_zone", () => {
    const spec = baseSpec({
      signalSource: "fvg",
      entry: [
        {
          id: "fvg",
          feature: "features_zone",
          tf: "5m",
          predicate: "zone_kind = 'fvg' AND direction IN ('bullish', 'bearish')",
          required: true,
          groupBy: ["direction"],
        },
      ],
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).not.toMatch(/JOIN features_fvg f ON[^]*MAX\(ts\) FROM features_fvg/s);
    expect(sql).toContain("JOIN LATERAL");
    expect(sql).toContain("FROM features_zone f");
    expect(sql).toContain("f.zone_kind = 'fvg'");
    // Anchor alias is `e` (consistent with risk/ATR SQL which hardcode e.*).
    expect(sql).toContain("f.invalidated_at IS NULL OR f.invalidated_at > e.ts");
    expect(sql).not.toContain("f.is_fresh IS TRUE");
    expect(sql).toContain("f.ts >= e.ts - INTERVAL");
    expect(sql).toContain("FROM market.candles_5m_canonical ctf");
    expect(sql).toContain("FROM market.candles_15m_canonical c15");
    expect(sql).not.toContain("FROM raw.symbol_broker_policy bp");
    expect(sql).not.toContain("ctf.broker");
    expect(sql).not.toContain("c15.broker");
    // Registry-bounded lookback (96 bars @5m = 480 min) padded by the
    // no-session-filter weekend gap (2940 min) → 3420 min = 57 hours (P3-C).
    expect(sql).toContain("f.ts >= e.ts - INTERVAL '57 hours'");
  });

  it("checks both mitigated_at and invalidated_at for zone setup freshness", () => {
    const spec = baseSpec({
      setup: [
        ...baseSpec().setup,
        {
          id: "zone",
          feature: "features_zone",
          tf: "15m",
          predicate: "zone_kind = 'demand'",
          required: true,
        },
      ],
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("pit_zone.mitigated_at IS NULL OR pit_zone.mitigated_at > b.ts");
    expect(sql).toContain("pit_zone.invalidated_at IS NULL OR pit_zone.invalidated_at > b.ts");
  });

  it("joins multiple bias/htf_bias conditions for multi-timeframe confluence", () => {
    const spec = baseSpec({
      setup: [
        {
          id: "bias",
          feature: "features_bias",
          tf: "15m",
          predicate: "direction != 'neutral'",
          required: true,
        },
        {
          id: "htf_bias",
          feature: "features_htf_bias",
          tf: "1h",
          predicate: "direction = features_bias.direction",
          required: true,
        },
      ],
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("bias_candidates");
    expect(sql).toContain("FROM features_bias");
    expect(sql).toContain("pit_htf_bias");
    expect(sql).toContain("pit_htf_bias.direction = b.direction");
  });

  it("applies a bounded lookback to setup/entry event feature laterals", () => {
    const spec = baseSpec({
      setup: [
        {
          id: "bias",
          feature: "features_bias",
          tf: "15m",
          predicate: "direction != 'neutral'",
          required: true,
        },
      ],
      entry: [
        {
          id: "structure",
          feature: "features_structure",
          tf: "15m",
          predicate: "event_type IN ('bos','mss')",
          required: true,
          lookbackBars: 10,
        },
      ],
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL();

    expect(sql).toContain("pit_structure");
    // 10 bars * 15 minutes = 150 minutes, padded by the no-session-filter
    // weekend gap (2940 min) → 3090 minutes (P3-C session-gap padding).
    expect(sql).toContain("INTERVAL '3090 minutes'");
  });

  const pitFrom = new Date("2026-04-10T00:00:00.000Z");
  const pitTo = new Date("2026-07-09T00:00:00.000Z");

  it("strips raw is_fresh from level predicates in PIT mode (keeps the as-of window)", () => {
    const spec = baseSpec({
      setup: [
        ...baseSpec().setup,
        {
          id: "zone",
          feature: "features_zone",
          tf: "15m",
          predicate: "zone_kind = 'demand' AND is_fresh = true",
          required: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec, { mode: "pit", from: pitFrom, to: pitTo, symbol: "EURUSD" });

    // Mutable flag removed entirely (outer WHERE and LATERAL pushdown).
    expect(sql).not.toMatch(/is_fresh/i);
    // As-of lifecycle window still enforced.
    expect(sql).toContain("pit_zone.invalidated_at IS NULL OR pit_zone.invalidated_at > b.ts");
    expect(sql).toContain("pit_zone.mitigated_at IS NULL OR pit_zone.mitigated_at > b.ts");
    // The real predicate term survives.
    expect(sql).toContain("zone_kind = 'demand'");
  });

  it("strips raw is_fresh from entry predicates in PIT mode", () => {
    const spec = baseSpec({
      entry: [
        {
          id: "ifvg",
          feature: "features_ifvg",
          tf: "5m",
          predicate: "fill_pct >= 0.5 AND is_fresh = true",
          required: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec, { mode: "pit", from: pitFrom, to: pitTo, symbol: "EURUSD" });

    expect(sql).not.toMatch(/is_fresh/i);
    expect(sql).toContain("pit_ifvg.invalidated_at IS NULL OR pit_ifvg.invalidated_at > s.ts");
  });

  it("keeps is_fresh in LIVE mode (current-state freshness is correct live)", () => {
    const spec = baseSpec({
      setup: [
        ...baseSpec().setup,
        {
          id: "zone",
          feature: "features_zone",
          tf: "15m",
          predicate: "zone_kind = 'demand' AND is_fresh = true",
          required: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec); // default mode = live

    expect(sql).toMatch(/is_fresh/i);
  });

  it("honors ignoreLifecycle by omitting the as-of validity window", () => {
    const spec = baseSpec({
      setup: [
        ...baseSpec().setup,
        {
          id: "zone",
          feature: "features_zone",
          tf: "15m",
          predicate: "zone_kind = 'demand'",
          required: true,
          ignoreLifecycle: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec, { mode: "pit", from: pitFrom, to: pitTo, symbol: "EURUSD" });

    expect(sql).not.toContain("pit_zone.invalidated_at");
    expect(sql).not.toContain("pit_zone.mitigated_at");
    expect(sql).toContain("zone_kind = 'demand'");
  });

  it("does not reference zone_kind/quality_score inside the features_ifvg LATERAL (table lacks those columns)", () => {
    // Regression guard for the PIT compiler parity fix: features_ifvg has neither
    // a zone_kind nor a quality_score column, so its LATERAL must group by symbol
    // only (empty equalityGroupByDefaults) and order by strength_score/ts only.
    // (Assertions are scoped to the ifvg LATERAL window; the final zone signal
    // pick legitimately references features_zone.zone_kind/quality_score.)
    const spec = baseSpec({
      entry: [
        {
          id: "ifvg",
          feature: "features_ifvg",
          tf: "5m",
          predicate: "fill_pct >= 0.5",
          required: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec, { mode: "pit", from: pitFrom, to: pitTo, symbol: "EURUSD" });

    expect(sql).toMatch(/SELECT DISTINCT ON \(symbol,?[^)]*\) \*\s+FROM features_ifvg/);
    expect(sql).not.toMatch(/FROM features_ifvg[\s\S]{0,300}?zone_kind/i);
    expect(sql).not.toMatch(/FROM features_ifvg[\s\S]{0,300}?quality_score/i);
  });

  it("does not reference quality_score inside the features_order_block LATERAL (table lacks that column)", () => {
    const spec = baseSpec({
      entry: [
        {
          id: "ob",
          feature: "features_order_block",
          tf: "15m",
          predicate: "ob_kind = 'bullish'",
          required: true,
        },
      ],
    });
    const { sql } = compileStrategy(spec, { mode: "pit", from: pitFrom, to: pitTo, symbol: "EURUSD" });

    expect(sql).toContain("pit_ob");
    expect(sql).not.toMatch(/FROM features_order_block[\s\S]{0,300}?quality_score/i);
  });
});


describe("Direction Arbiter / regime predicates (SK-30)", () => {
  it("features_direction_state anchor projects regime and bare `regime` resolves to b.regime", () => {
    const spec = baseSpec({
      setup: [
        {
          id: "bias",
          feature: "features_direction_state",
          tf: "1h",
          predicate: "direction != 'neutral' AND regime = 'trending'",
          required: true,
        },
      ],
    });
    const sql = compileStrategy(spec).latestSignalSQL();
    expect(sql).toMatch(/FROM features_direction_state/);
    // anchor CTE must project regime (and state, since direction_state has both)
    // and the predicate must reference b.regime.
    expect(sql).toMatch(/SELECT symbol, ts, direction, regime, state\s+FROM features_direction_state/);
    expect(sql).toMatch(/b\.regime\s*=\s*'trending'/);
  });

  it("features_htf_bias anchor projects state and bare `state` resolves to b.state (SK-30 latent bug)", () => {
    const spec = baseSpec({
      setup: [
        {
          id: "bias",
          feature: "features_htf_bias",
          tf: "15m",
          predicate: "direction != 'neutral' AND state IN ('READY','SOFT_WARN')",
          required: true,
        },
      ],
    });
    const sql = compileStrategy(spec).latestSignalSQL();
    expect(sql).toMatch(/FROM features_htf_bias/);
    expect(sql).toMatch(/SELECT symbol, ts, direction, state\s+FROM features_htf_bias/);
    expect(sql).toMatch(/b\.state\s+IN\s*\('READY',\s*'SOFT_WARN'\)/);
  });
});

describe("sessionGapPaddingMinutes (P3-C)", () => {
  it("pads a full weekend gap when no session filter is set", () => {
    expect(sessionGapPaddingMinutes(undefined)).toBe(2940);
    expect(sessionGapPaddingMinutes({ filters: {} } as StrategySpec)).toBe(2940);
  });

  it("pads the weekend gap for NY-only specs (spans Fri to Mon)", () => {
    const spec = { filters: { sessions: ["NY"] } } as StrategySpec;
    // NY closed period until next NY (19h = 1140 min) + weekend (48h = 2940) = 4080 min.
    expect(sessionGapPaddingMinutes(spec)).toBe(4080);
  });

  it("pads the ASIA closed period for ASIA-only specs", () => {
    const spec = { filters: { sessions: ["ASIA"] } } as StrategySpec;
    // ASIA closed period until next ASIA (17h = 1020 min); no weekend span.
    expect(sessionGapPaddingMinutes(spec)).toBe(1020);
  });

  it("tolerates a singular filters.session for parity with the gate script", () => {
    const spec = { filters: { session: "NY" } } as StrategySpec;
    expect(sessionGapPaddingMinutes(spec)).toBe(4080);
  });
});

describe("buildLookbackInterval padding (P3-C)", () => {
  const cond: StrategyCondition = {
    id: "z",
    feature: "features_zone",
    tf: "15m",
    predicate: "zone_kind = 'demand'",
    required: true,
    lookbackBars: 10,
  };

  it("adds weekend padding to an explicit lookback when no session filter", () => {
    // 10 bars * 15m = 150 min + 2940 min weekend = 3090 min.
    expect(buildLookbackInterval(cond)).toBe("3090 minutes");
  });

  it("adds NY weekend padding when session filter is NY", () => {
    const spec = { filters: { sessions: ["NY"] } } as StrategySpec;
    // 150 + 4080 = 4230 min.
    expect(buildLookbackInterval(cond, spec)).toBe("4230 minutes");
  });

  it("falls back to registry default lookback when lookbackBars omitted", () => {
    const noBars: StrategyCondition = { ...cond, lookbackBars: undefined };
    // features_zone default 96 bars * 15m = 1440 min + 2940 = 4380 min = 73 hours.
    expect(buildLookbackInterval(noBars)).toBe("73 hours");
  });
});
