import { describe, it, expect } from "vitest";
import { getPointSize, getPipSize, pointsToPips } from "./pipMath";

describe("pip/point contract", () => {
  it("point size follows broker digits", () => {
    expect(getPointSize(5)).toBeCloseTo(0.00001, 12);
    expect(getPointSize(4)).toBeCloseTo(0.0001, 12);
    expect(getPointSize(3)).toBeCloseTo(0.001, 12);
    expect(getPointSize(2)).toBeCloseTo(0.01, 12);
  });

  it("pip = 10 points for 5/3/2-digit quoting (FX, JPY, gold)", () => {
    expect(getPipSize(5)).toBeCloseTo(0.0001, 12);
    expect(getPipSize(3)).toBeCloseTo(0.01, 12);
    expect(getPipSize(2)).toBeCloseTo(0.1, 12);
  });

  it("pip = 1 point for 4-digit quoting (e.g. USDSEK)", () => {
    // The contract that keeps web ingest, the ingestion server, and the EAs
    // in agreement: 4-digit pairs report spread points == pips.
    expect(getPipSize(4)).toBeCloseTo(0.0001, 12);
  });

  it("pointsToPips matches the ingestion server for every quoting convention", () => {
    expect(pointsToPips(25, 5)).toBeCloseTo(2.5, 12); // EURUSD
    expect(pointsToPips(18, 3)).toBeCloseTo(1.8, 12); // USDJPY
    expect(pointsToPips(30, 2)).toBeCloseTo(3.0, 12); // XAUUSD
    expect(pointsToPips(79, 4)).toBeCloseTo(79, 12); // USDSEK: points == pips
  });
});
