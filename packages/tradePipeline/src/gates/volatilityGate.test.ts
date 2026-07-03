import { describe, it, expect } from "vitest";
import { createVolatilityGate } from "./volatilityGate";
import type { MarketContext } from "@tm/shared";

function ctx(symbol: string, atr5: number): MarketContext {
  return {
    symbol,
    ts: new Date(),
    features: {
      features_atr: { values: [{ period: 5, value: atr5 }] },
    },
  } as MarketContext;
}

describe("volatilityGate", () => {
  it("rejects when ATR5 in pips exceeds maxAtr5Pips", async () => {
    const gate = createVolatilityGate({ maxAtr5Pips: 10 });
    // EURUSD: pip size 0.0001, so 0.0020 = 20 pips
    const result = await gate(ctx("EURUSD", 0.002));
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("20.00pips exceeds max=10pips");
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
    expect(result.reason).toContain("20.00pips exceeds max=10pips");
  });
});
