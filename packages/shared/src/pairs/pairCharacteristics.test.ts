import { describe, it, expect } from "vitest";
import {
  getRegistryPipSize,
  getSessionSpread,
  getSessionSlippage,
} from "./pairCharacteristics";

describe("pairCharacteristics registry", () => {
  it("returns the standard pip sizes", () => {
    expect(getRegistryPipSize("EURUSD")).toBe(0.0001);
    expect(getRegistryPipSize("USDJPY")).toBe(0.01);
    expect(getRegistryPipSize("XAUUSD")).toBe(0.1);
    expect(getRegistryPipSize("NAS100")).toBe(1);
  });

  it("is case and symbol-insensitive", () => {
    expect(getRegistryPipSize("eurusd")).toBe(0.0001);
    expect(getRegistryPipSize("xauusd")).toBe(0.1);
  });

  it("falls back to FX pip size for unknown symbols", () => {
    expect(getRegistryPipSize("UNKNOWN")).toBe(0.0001);
  });

  it("computes session spread and slippage", () => {
    expect(getSessionSpread("EURUSD", "LONDON")).toBeGreaterThan(0);
    expect(getSessionSlippage("XAUUSD", 30)).toBeGreaterThan(0);
  });
});
