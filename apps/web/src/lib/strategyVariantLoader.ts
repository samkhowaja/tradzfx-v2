/**
 * Strategy Variant Loader.
 * Merges a family base spec with variant overrides and produces a runtime
 * StrategySpec keyed by the variant id.
 */

import { getPool } from "@tm/shared";
import type { Pool, StrategySpec, TimeFrame } from "@tm/shared";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Deep merge objects; arrays and primitives are overridden. */
export function deepMerge<T extends Record<string, any>>(
  base: T,
  overrides: Record<string, any>
): T {
  const result: Record<string, any> = { ...base };

  for (const key of Object.keys(overrides)) {
    const overrideVal = overrides[key];
    const baseVal = result[key];

    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }

  return result as T;
}

export interface LoadedVariant {
  variantId: string;
  familyId: string;
  name: string;
  symbols: string[];
  timeframes: TimeFrame[];
  spec: StrategySpec;
  version: string; // composite version for cache invalidation
}

interface VariantRow {
  variant_id: string;
  family_id: string;
  variant_name: string;
  family_name: string;
  symbols: string[];
  timeframes: string[];
  overrides: Record<string, any>;
  base_spec: Record<string, any>;
  variant_updated_at: Date;
  family_updated_at: Date;
}

async function rowToVariant(row: VariantRow): Promise<LoadedVariant> {
  const base = (row.base_spec ?? {}) as any;
  const overrides = (row.overrides ?? {}) as any;
  const merged = deepMerge(base, overrides);

  // Variant-level symbol/timeframe lists take precedence.
  const symbols = row.symbols?.length
    ? row.symbols
    : (merged.filters?.symbols ?? []);
  const timeframes = (row.timeframes?.length
    ? row.timeframes
    : (merged.timeframes ?? ["15m"])) as TimeFrame[];

  const spec: StrategySpec = {
    ...merged,
    id: row.variant_id,
    familyId: row.family_id,
    name: row.variant_name || row.family_name || row.variant_id,
    version: merged.version || "1.0.0",
    filters: {
      ...(merged.filters ?? {}),
      symbols,
    },
  };

  return {
    variantId: row.variant_id,
    familyId: row.family_id,
    name: spec.name,
    symbols,
    timeframes,
    spec,
    version: `${row.family_updated_at.toISOString()}_${row.variant_updated_at.toISOString()}`,
  };
}

const VARIANT_SQL = `
  SELECT
    v.id AS variant_id,
    v.family_id,
    v.name AS variant_name,
    f.name AS family_name,
    v.symbols,
    v.timeframes,
    v.overrides,
    f.base_spec,
    v.updated_at AS variant_updated_at,
    f.updated_at AS family_updated_at
  FROM strategy_variants v
  JOIN strategy_families f ON f.id = v.family_id
`;

export async function loadVariantById(
  pool: Pool,
  variantId: string
): Promise<LoadedVariant | null> {
  const { rows } = await pool.query<VariantRow>(
    `${VARIANT_SQL} WHERE v.id = $1`,
    [variantId]
  );
  if (rows.length === 0) return null;
  return rowToVariant(rows[0]);
}

export async function loadActiveVariants(
  pool: Pool,
  opts: { symbol?: string } = {}
): Promise<LoadedVariant[]> {
  let sql = `${VARIANT_SQL} WHERE v.is_active = true`;
  const params: string[] = [];
  if (opts.symbol) {
    sql += ` AND ($1 = ANY(v.symbols))`;
    params.push(opts.symbol.toUpperCase());
  }
  sql += ` ORDER BY v.created_at`;

  const { rows } = await pool.query<VariantRow>(sql, params);
  return Promise.all(rows.map(rowToVariant));
}

export async function getDefaultActiveVariantForSymbol(
  pool: Pool,
  symbol: string
): Promise<string | undefined> {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT v.id
     FROM strategy_variants v
     WHERE v.is_active = true
       AND ($1 = ANY(v.symbols))
     ORDER BY v.created_at
     LIMIT 1`,
    [symbol.toUpperCase()]
  );
  return rows[0]?.id ?? undefined;
}
