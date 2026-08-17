import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { loadStrategyFromYaml } from "./loader";
import { resolveDxyDependency } from "./strategyDependencies";

const specsDir = path.join(__dirname, "specs");

describe("DXY dependency declarations", () => {
  it("uses explicit policy for known DXY-sensitive specs", () => {
    expect(loadStrategyFromYaml(path.join(specsDir, "xauusd_v1.yaml")).dxyDependency).toBe("optional");
    expect(loadStrategyFromYaml(path.join(specsDir, "watukushay_no1.yaml")).dxyDependency).toBe("not_required");
  });

  it("uses explicit not-required policy for symbol-local specs", () => {
    const spec = loadStrategyFromYaml(path.join(specsDir, "orb_classic.yaml"));
    expect(spec.dxyDependency).toBe("not_required");
    expect(resolveDxyDependency(spec)).toBe("not_required");
  });
});