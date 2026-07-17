import { describe, it, expect } from "vitest";
import { createVolatilityGate, pctToColumn } from "./volatilityGate";
import type { MarketContext } from "@tm/shared";

function ctx(symbol: string, atr5: number, session?: string, profile?: Record<string, number>): MarketContext {
  return {
    symbol,
    ts: new Date(),
    features: {
      features_atr: { values: [{ period: 5, value: atr5 }] },
      features_session: session ? { session, utcHour: 0 } : undefined,
      market_volatility_profile: profile,
    },
  } as MarketContext;
}

function ctxR(
  symbol: string,
  atr5: number,
  profile: Record<string, number>,
  ds: { agreement: boolean; regime: string } | undefined
): MarketContext {
  return {
    symbol,
    ts: new Date(),
    features: {
      features_atr: { values: [{ period: 5, value: atr5 }] },
      features_session: { session: "NY", utcHour: 13 },
      market_volatility_profile: profile,
      features_direction_state: ds,
    },
  } as MarketContext;
}

describe("volatilityGate", () => {
  it("rejects when ATR5 in pips exceeds maxAtr5Pips", async () => {
    const gate = createVolatilityGate({ maxAtr5Pips: 10 });
    // EURUSD: pip size 0.0001, so 0.0020 = 20 pips
    const result = await gate(ctx("EURUSD", 0.002));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("ATR5=20.0p exceeds max=10.0p");
  });

  it("passes when ATR5 in pips is within range", async () => {
    const gate = createVolatilityGate({ maxAtr5Pips: 20, minAtr5Pips: 2 });
    const result = await gate(ctx("EURUSD", 0.0008));
    expect(result.passed).toBe(true);
  });

  it("uses the registry pip size for XAUUSD", async () => {
    const gate = createVolatilityGate({ maxAtr5Pips: 10 });
    // XAUUSD: pip size 0.1, so 2.0 = 20 pips
    const result = await gate(ctx("XAUUSD", 2.0));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("ATR5=20.0p exceeds max=10.0p");
  });

  it("applies session-aware maxAtr5Pips overrides", async () => {
    const gate = createVolatilityGate({
      maxAtr5Pips: 10,
      sessionMaxAtr5Pips: { LONDON: 25 },
    });
    // 20 pips during LONDON should pass because the override is 25.
    const result = await gate(ctx("EURUSD", 0.002, "LONDON"));
    expect(result.passed).toBe(true);
  });

  it("falls back to flat maxAtr5Pips when session has no override", async () => {
    const gate = createVolatilityGate({
      maxAtr5Pips: 10,
      sessionMaxAtr5Pips: { LONDON: 25 },
    });
    // 20 pips during NY should still fail because there is no NY override.
    const result = await gate(ctx("EURUSD", 0.002, "NY"));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("exceeds max=10.0p");
  });

  it("applies session-aware minAtr5Pips overrides", async () => {
    const gate = createVolatilityGate({
      minAtr5Pips: 5,
      sessionMinAtr5Pips: { ASIA: 2 },
    });
    // 3 pips during ASIA should pass because the floor is lowered to 2.
    const result = await gate(ctx("EURUSD", 0.0003, "ASIA"));
    expect(result.passed).toBe(true);
  });

  it("uses the percentile cap from an injected market_volatility_profile", async () => {
    // XAUUSD pip size 0.1 -> atr5=2.0 is 20 pips. Profile p95=25p -> 20p passes;
    // with p95=15p the same bar is blocked. Proves asset-class-safe caps.
    const pass = createVolatilityGate({ maxAtrPercentile: 0.95 });
    const ok = await pass(ctx("XAUUSD", 2.0, "NY", { p50: 10, p95: 25, p99: 40 }));
    expect(ok.passed).toBe(true);

    const block = createVolatilityGate({ maxAtrPercentile: 0.95 });
    const no = await block(ctx("XAUUSD", 2.0, "NY", { p50: 5, p95: 15, p99: 30 }));
    expect(no.passed).toBe(false);
    expect(no.reason).toContain("policy=p95");
    expect(no.reason).toContain("XAUUSD/NY");
  });

  it("falls back to absolute pips when percentile policy has no profile", async () => {
    const gate = createVolatilityGate({ maxAtrPercentile: 0.95, maxAtr5Pips: 10 });
    const result = await gate(ctx("EURUSD", 0.002)); // 20 pips, no profile injected
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("exceeds max=10.0p");
  });

  it("normalizes legacy maxAtr5/maxAtrPips aliases to maxAtr5Pips", async () => {
    const gate = createVolatilityGate({ maxAtr5: 10 } as any);
    const result = await gate(ctx("EURUSD", 0.002)); // 20 pips > 10p cap via alias
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("exceeds max=10.0p");
  });
});

describe("volatilityGate.regimeRelax (post-freeze, keyed on features_direction_state)", () => {
  // XAUUSD pipSize=0.1 -> atr5=2.0 is 20 pips. p95=15 blocks (20>15); p99=40 widens.
  const profile = { p50: 8, p95: 15, p99: 40 };

  it("disabled (default) blocks exactly as today, even with direction_state present", async () => {
    const gate = createVolatilityGate({ maxAtrPercentile: 0.95 });
    const r = await gate(ctxR("XAUUSD", 2.0, profile, { agreement: true, regime: "trending" }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("exceeds max=15.0p");
  });

  it("enabled + agreed trend (percentile p99) relaxes the over-vol ceiling", async () => {
    const gate = createVolatilityGate({
      maxAtrPercentile: 0.95,
      regimeRelax: { enabled: true, agreement: true, regimeIn: ["trending"], mode: "percentile", relaxToPercentile: 0.99 },
    });
    const r = await gate(ctxR("XAUUSD", 2.0, profile, { agreement: true, regime: "trending" }));
    expect(r.passed).toBe(true); // 20p > p95(15) but <= p99(40)
  });

  it("enabled + disagreement still blocks", async () => {
    const gate = createVolatilityGate({
      maxAtrPercentile: 0.95,
      regimeRelax: { enabled: true, agreement: true, regimeIn: ["trending"], mode: "percentile", relaxToPercentile: 0.99 },
    });
    const r = await gate(ctxR("XAUUSD", 2.0, profile, { agreement: false, regime: "ranging" }));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("exceeds max=15.0p");
  });

  it("enabled + regime not in regimeIn still blocks", async () => {
    const gate = createVolatilityGate({
      maxAtrPercentile: 0.95,
      regimeRelax: { enabled: true, agreement: true, regimeIn: ["trending"], mode: "percentile", relaxToPercentile: 0.99 },
    });
    const r = await gate(ctxR("XAUUSD", 2.0, profile, { agreement: true, regime: "volatile" }));
    expect(r.passed).toBe(false);
  });

  it("enabled + mode bypass passes even extreme vol on a matching bar", async () => {
    const gate = createVolatilityGate({
      maxAtrPercentile: 0.95,
      regimeRelax: { enabled: true, agreement: true, regimeIn: ["trending"], mode: "bypass" },
    });
    // atr5=5.0 -> 50 pips: over p95(15) AND over p99(40); bypass still passes.
    const r = await gate(ctxR("XAUUSD", 5.0, profile, { agreement: true, regime: "trending" }));
    expect(r.passed).toBe(true);
  });

  it("enabled but missing direction_state -> no relax (today's behavior)", async () => {
    const gate = createVolatilityGate({
      maxAtrPercentile: 0.95,
      regimeRelax: { enabled: true, agreement: true, regimeIn: ["trending"], mode: "percentile", relaxToPercentile: 0.99 },
    });
    const r = await gate(ctxR("XAUUSD", 2.0, profile, undefined));
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("exceeds max=15.0p");
  });
});


describe("pctToColumn / eager percentile validation (SK-62)", () => {
  it("resolves canonical percentiles to profile columns", () => {
    expect(pctToColumn(0.05)).toBe("p05");
    expect(pctToColumn(0.25)).toBe("p25");
    expect(pctToColumn(0.5)).toBe("p50");
    expect(pctToColumn(0.75)).toBe("p75");
    expect(pctToColumn(0.95)).toBe("p95");
    expect(pctToColumn(0.99)).toBe("p99");
    expect(pctToColumn(95)).toBe("p95"); // accepts 0..100 too
  });

  it("THROWS on unknown percentiles instead of silently coercing to p95", () => {
    // SK-62: the old `?? "p95"` made NY:0.98 a no-op. Now it must fail loud.
    for (const bad of [0.98, 0.97, 0.9, 0.8, 0.6]) {
      expect(() => pctToColumn(bad)).toThrow(/unknown ATR percentile/);
    }
  });

  it("createVolatilityGate fails at creation for a bad session percentile (the NY:0.98 case)", () => {
    expect(() =>
      createVolatilityGate({ maxAtrPercentile: 0.95, sessionMaxAtrPercentile: { NY: 0.98 } })
    ).toThrow(/unknown ATR percentile/);
  });

  it("createVolatilityGate fails at creation for a bad regimeRelax.relaxToPercentile", () => {
    expect(() =>
      createVolatilityGate({
        maxAtrPercentile: 0.95,
        regimeRelax: { enabled: true, mode: "percentile", relaxToPercentile: 0.98 },
      })
    ).toThrow(/unknown ATR percentile/);
  });

  it("createVolatilityGate accepts a fully-valid percentile config (no throw)", () => {
    expect(() =>
      createVolatilityGate({
        maxAtrPercentile: 0.95,
        sessionMaxAtrPercentile: { NY: 0.95 },
        regimeRelax: { enabled: true, mode: "percentile", relaxToPercentile: 0.99 },
      })
    ).not.toThrow();
  });
});
