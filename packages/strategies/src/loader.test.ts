import { describe, it, expect } from "vitest";
import { deepMerge, loadStrategyFromYaml } from "./loader";
import * as path from "path";

const SPECS_DIR = path.join(__dirname, "specs");

describe("deepMerge", () => {
  it("replaces arrays", () => {
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
  });

  it("merges nested objects", () => {
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { c: 3, d: 4 } })).toEqual({
      a: { b: 1, c: 3, d: 4 },
    });
  });

  it("overrides primitives", () => {
    expect(deepMerge({ a: 1 }, { a: 2 })).toEqual({ a: 2 });
  });
});

describe("loadStrategyFromYaml", () => {
  it("loads a full base spec as-is", () => {
    const spec = loadStrategyFromYaml(path.join(SPECS_DIR, "keylevel_bounce.yaml"));
    expect(spec.id).toBe("keylevel_bounce");
    expect(spec.name).toBe("Key-Level Bounce");
  });

  it("merges a thin variant with its base", () => {
    const spec = loadStrategyFromYaml(path.join(SPECS_DIR, "keylevel_bounce_v1_4r.yaml"));
    expect(spec.id).toBe("keylevel_bounce_v1_4r");
    expect(spec.name).toBe("Key-Level Bounce V1 (4R target)");
    expect(spec.risk.tp).toBe("sl * 4.0");
    expect(spec.risk.sl).toBe("50 pips");
    expect(spec.setup.some((c) => c.feature === "features_htf_bias")).toBe(true);
  });
});
