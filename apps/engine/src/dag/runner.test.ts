import { describe, it, expect } from "vitest";
import { getCandleTableForTf } from "./runner";

describe("getCandleTableForTf", () => {
  it("maps each supported timeframe to its continuous aggregate table", () => {
    expect(getCandleTableForTf("1m")).toBe("candles_1m");
    expect(getCandleTableForTf("5m")).toBe("candles_5m");
    expect(getCandleTableForTf("15m")).toBe("candles_15m");
    expect(getCandleTableForTf("1h")).toBe("candles_1h");
    expect(getCandleTableForTf("4h")).toBe("candles_4h");
    expect(getCandleTableForTf("1d")).toBe("candles_1d_utc");
  });
});
