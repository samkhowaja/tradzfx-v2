import { describe, it, expect } from "vitest";
import { computeLotSize } from "./orderExecutor";
import type { LiveExecutionConfig } from "@tm/shared";

const baseConfig: Partial<LiveExecutionConfig> = {
  riskPerTradePct: 1.0,
  accountBalance: 10000,
  lotSize: 0.01,
};

describe("computeLotSize", () => {
  it("uses fixed lot size when risk-based sizing is disabled", () => {
    const lot = computeLotSize(2500.0, 2499.5, { lotSize: 0.05 }, "XAUUSD", "buy");
    expect(lot).toBe(0.05);
  });

  it("reduces XAUUSD long size due to side asymmetry", () => {
    const longLot = computeLotSize(2500.0, 2499.5, baseConfig, "XAUUSD", "buy");
    const shortLot = computeLotSize(2500.0, 2500.5, baseConfig, "XAUUSD", "sell");

    // Long risk is 60% of short risk, so long lot should be ~60% of short lot
    expect(longLot).toBeLessThan(shortLot);
    expect(longLot).toBeCloseTo(shortLot * 0.6, 1);
  });

  it("does not reduce XAUUSD short size", () => {
    const shortLot = computeLotSize(2500.0, 2500.5, baseConfig, "XAUUSD", "sell");
    expect(shortLot).toBeGreaterThan(0.01);
  });

  it("clamps lot size to minimum 0.01", () => {
    // Wide SL and tiny risk → required lot below 0.01 → clamped up
    const lot = computeLotSize(
      2500.0,
      2490.0,
      { ...baseConfig, riskPerTradePct: 0.001 },
      "XAUUSD",
      "buy"
    );
    expect(lot).toBe(0.01);
  });

  it("clamps lot size to maximum 50.0", () => {
    // Tight SL and large risk → required lot above 50.0 → clamped down
    const lot = computeLotSize(
      2500.0,
      2499.9999,
      { ...baseConfig, riskPerTradePct: 50.0 },
      "XAUUSD",
      "buy"
    );
    expect(lot).toBe(50.0);
  });
});
