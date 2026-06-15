/**
 * Strategy Loader.
 * Loads strategy specs from YAML files.
 */

import * as fs from "fs";
import * as YAML from "yaml";
import type { StrategySpec } from "@tm/shared";

export function loadStrategyFromYaml(path: string): StrategySpec {
  const content = fs.readFileSync(path, "utf8");
  return YAML.parse(content) as StrategySpec;
}

export function loadStrategyFromString(content: string): StrategySpec {
  return YAML.parse(content) as StrategySpec;
}
