import { describe, it, expect } from "vitest";
import { computeActualRR, isBadFill } from "./postFill";

describe("computeActualRR", () => {
  it("returns expected RR for a buy fill at entry", () => {
    const rr = computeActualRR("buy", 1.09, 1.088, 1.095);
    expect(rr).toBeCloseTo(2.5, 4); // reward 0.005 / risk 0.002
  });

  it("returns expected RR for a sell fill at entry", () => {
    const rr = computeActualRR("sell", 1.09, 1.092, 1.085);
    expect(rr).toBeCloseTo(2.5, 4); // reward 0.005 / risk 0.002
  });

  it("reports a bad fill when buy slips closer to SL", () => {
    // Entry 1.09, SL 1.088, TP 1.095 — filled at 1.091 (worse)
    const rr = computeActualRR("buy", 1.091, 1.088, 1.095);
    expect(rr).toBeCloseTo(4 / 3, 4); // 1.33
    expect(isBadFill(rr, 1.5)).toBe(true);
  });

  it("reports a bad fill when sell slips closer to SL", () => {
    // Entry 1.09, SL 1.092, TP 1.085 — filled at 1.089 (worse for sell)
    const rr = computeActualRR("sell", 1.089, 1.092, 1.085);
    expect(rr).toBeCloseTo(4 / 3, 4);
    expect(isBadFill(rr, 1.5)).toBe(true);
  });

  it("does not flag a fill that meets the minimum RR", () => {
    const rr = computeActualRR("buy", 1.09, 1.088, 1.095);
    expect(isBadFill(rr, 1.0)).toBe(false);
  });

  it("returns 0 when risk is zero", () => {
    const rr = computeActualRR("buy", 1.09, 1.09, 1.095);
    expect(rr).toBe(0);
  });
});
