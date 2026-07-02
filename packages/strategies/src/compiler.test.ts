import { describe, it, expect } from "vitest";
import { compileStrategy } from "./compiler";
import type { StrategySpec } from "@tm/shared";

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
    const sql = compiled.latestSignalSQL("EURUSD");

    expect(sql).toContain("a_15m.value * 2.0");
    expect(sql).toContain("(a_15m.value * 2.0)) * 2.50");
  });

  it("emits entry_type and offset entry_price for limit orders", () => {
    const spec = baseSpec({
      entryConfig: { type: "limit", zonePips: 0.0005 },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL("EURUSD");

    expect(sql).toContain("'limit' as entry_type");
    expect(sql).toContain("- 0.0005");
  });

  it("emits entry_type and offset entry_price for stop orders", () => {
    const spec = baseSpec({
      entryConfig: { type: "stop", zonePips: 0.0005 },
    });
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL("EURUSD");

    expect(sql).toContain("'stop' as entry_type");
    expect(sql).toContain("+ 0.0005");
  });

  it("does not emit entry_type column when entryConfig is absent", () => {
    const spec = baseSpec();
    const compiled = compileStrategy(spec);
    const sql = compiled.latestSignalSQL("EURUSD");

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
    const sql = compiled.latestSignalSQL("EURUSD");

    expect(sql).toContain("(10 * (COALESCE(p.pip_size");
    expect(sql).toContain(" * 2.00");
  });
});
