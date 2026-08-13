import { describe, expect, it } from "vitest";
import { loadStrategyFromYaml } from "./loader";
import { extractStrategyDependencies } from "./strategyDependencies";
import path from "node:path";

describe("strategy dependency extraction", () => {
  it("captures watukushay_no1 transitive slow-MA and gate dependencies", () => {
    const file = path.resolve(__dirname, "specs", "watukushay_no1.yaml");
    const deps = extractStrategyDependencies(loadStrategyFromYaml(file));
    expect(deps.maxLookbackBars).toBe(250);
    expect(deps.requiresDxy).toBe(false);
    expect(deps.dependencies).toEqual(expect.arrayContaining([
      expect.objectContaining({ feature: "features_bias", timeframe: "1h" }),
      expect.objectContaining({ feature: "features_moving_average", timeframe: "1h" }),
      expect.objectContaining({ feature: "features_atr", timeframe: "15m" }),
    ]));
  });
});
