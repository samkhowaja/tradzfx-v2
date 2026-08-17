import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadStrategyFromYaml } from "./loader";

const specsDir = path.join(__dirname, "specs");
const allowed = new Set(["required", "optional", "not_required"]);

describe("DXY dependency governance", () => {
  it("requires every active spec to declare an explicit DXY policy", () => {
    const missing: string[] = [];
    const invalid: string[] = [];

    for (const file of fs.readdirSync(specsDir).filter((entry) => entry.endsWith(".yaml"))) {
      const spec = loadStrategyFromYaml(path.join(specsDir, file));
      if (spec.active !== true) continue;
      if (spec.dxyDependency === undefined) missing.push(spec.id);
      else if (!allowed.has(spec.dxyDependency)) invalid.push(spec.id);
    }

    expect(invalid, "Active specs contain invalid dxyDependency values").toEqual([]);
    expect(missing, "Active specs missing explicit dxyDependency").toEqual([]);
  });
});