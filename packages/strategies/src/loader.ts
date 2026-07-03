/**
 * Strategy Loader.
 * Loads strategy specs from YAML files.
 *
 * Files can be either:
 * - A full base spec (no `overrides` key). These define a strategy family.
 * - A thin variant (has `overrides`). The loader merges the variant's overrides
 *   into the base spec located at `<familyId>.yaml` in the same directory.
 */

import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import type { StrategySpec } from "@tm/shared";

/**
 * Deep-merge two plain objects/arrays. Arrays are replaced, not concatenated.
 * Objects are merged recursively. Primitive values are overridden by `source`.
 */
export function deepMerge<T>(target: T, source: unknown): T {
  if (source === undefined || source === null) return target;
  if (target === undefined || target === null) return source as T;

  if (Array.isArray(source)) {
    return source.slice() as T;
  }

  if (Array.isArray(target)) {
    // Source is not an array (primitive/object); replace the target array.
    return source as T;
  }

  if (typeof target === "object" && typeof source === "object") {
    const result = { ...target } as Record<string, unknown>;
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      result[key] = deepMerge(result[key], value);
    }
    return result as T;
  }

  return source as T;
}

function applyVariantMetadata(
  base: StrategySpec,
  variant: Partial<StrategySpec> & { id: string; name: string; version: string }
): StrategySpec {
  return {
    ...base,
    id: variant.id,
    familyId: variant.familyId ?? base.familyId ?? variant.id,
    name: variant.name,
    version: variant.version,
    description: variant.description ?? base.description,
    active: "active" in variant ? (variant as { active?: boolean }).active : base.active,
  };
}

export function loadStrategyFromYaml(filePath: string): StrategySpec {
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = YAML.parse(content) as unknown as StrategySpec & { overrides?: unknown };

  if (parsed.overrides) {
    const familyId = parsed.familyId ?? parsed.id;
    const basePath = path.join(path.dirname(filePath), `${familyId}.yaml`);
    if (!fs.existsSync(basePath)) {
      throw new Error(
        `Variant '${parsed.id}' references family '${familyId}' but base spec not found at ${basePath}`
      );
    }
    const baseContent = fs.readFileSync(basePath, "utf8");
    const base = YAML.parse(baseContent) as unknown as StrategySpec;
    const merged = deepMerge(base, parsed.overrides) as StrategySpec;
    return applyVariantMetadata(merged, parsed);
  }

  return parsed;
}

export function loadStrategyFromString(content: string): StrategySpec {
  return YAML.parse(content) as StrategySpec;
}
