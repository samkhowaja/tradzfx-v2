#!/usr/bin/env tsx
import { config } from "dotenv";
import { getPool, closePool, getFeaturePipelineSymbol } from "../packages/shared/src";
import { extractRequiredFeatures } from "../packages/strategies/src";
import type { StrategySpec, TimeFrame } from "../packages/shared/src";

config({ path: ".env.local" });

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base: any, overrides: any): any {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    result[key] = isObject(result[key]) && isObject(value)
      ? deepMerge(result[key], value)
      : value;
  }
  return result;
}

export function findCoverageErrors(
  variantId: string,
  symbols: string[],
  required: Set<string>,
  universe: Map<string, { enabled: boolean; requiredTimeframes: TimeFrame[]; requiredFeatureProfile: string }>
): string[] {
  const errors: string[] = [];
  for (const rawSymbol of symbols) {
    const symbol = rawSymbol.toUpperCase();
    const entry = universe.get(symbol);
    if (!entry) {
      errors.push(`${variantId}: ${symbol} missing from feature universe`);
      continue;
    }
    if (!entry.enabled) {
      errors.push(`${variantId}: ${symbol} feature universe entry is disabled`);
      continue;
    }
    if (entry.requiredFeatureProfile !== "live-complete") {
      errors.push(`${variantId}: ${symbol} unsupported profile ${entry.requiredFeatureProfile}`);
      continue;
    }
    const allowed = new Set(entry.requiredTimeframes);
    for (const key of required) {
      const tf = key.slice(key.lastIndexOf("@") + 1) as TimeFrame;
      if (!allowed.has(tf)) errors.push(`${variantId}: ${symbol} missing timeframe ${tf} for ${key}`);
    }
  }
  return errors;
}

async function main(): Promise<void> {
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string;
    symbols: string[];
    overrides: Record<string, unknown>;
    base_spec: Record<string, unknown>;
  }>(`SELECT v.id, v.symbols, v.overrides, f.base_spec
      FROM strategy_variants v
      JOIN strategy_families f ON f.id = v.family_id
      WHERE v.is_active = true
      ORDER BY v.id`);

  const symbols = [...new Set(rows.flatMap((row) => row.symbols ?? []).map((s) => s.toUpperCase()))];
  const universe = new Map();
  for (const symbol of symbols) {
    const entry = await getFeaturePipelineSymbol(pool, symbol);
    if (entry) universe.set(symbol, entry);
  }

  const errors: string[] = [];
  for (const row of rows) {
    const spec = deepMerge(row.base_spec ?? {}, row.overrides ?? {}) as StrategySpec;
    spec.filters = { ...(spec.filters ?? {}), symbols: row.symbols ?? spec.filters?.symbols ?? [] };
    errors.push(...findCoverageErrors(row.id, spec.filters.symbols ?? [], extractRequiredFeatures(spec), universe));
  }

  console.log(`Feature universe: activeVariants=${rows.length} symbols=${symbols.length} errors=${errors.length}`);
  for (const error of errors) console.error(`ERROR ${error}`);
  if (errors.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[feature-universe] Fatal:", error);
    process.exitCode = 1;
  }).finally(closePool);
}
