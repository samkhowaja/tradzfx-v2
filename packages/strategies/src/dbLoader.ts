/**
 * Strategy DB Loader.
 * Loads strategy specs from the database.
 *
 * Strategy specs are stored as a family base_spec plus per-variant overrides.
 * The loader deep-merges them before returning a complete StrategySpec.
 */

import type { Pool } from "@tm/shared";
import type { StrategySpec } from "@tm/shared";
import { deepMerge } from "./loader";

export async function loadStrategyFromDB(
  pool: Pool,
  strategyId: string
): Promise<StrategySpec | null> {
  const { rows } = await pool.query(
    `SELECT
       v.id AS variant_id,
       v.family_id,
       v.name,
       v.description,
       v.is_active,
       v.overrides,
       f.base_spec
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.id = $1
     LIMIT 1`,
    [strategyId]
  );

  if (rows.length === 0) {
    // Fallback to the legacy flat strategy_specs table.
    const { rows: legacyRows } = await pool.query(
      `SELECT spec_json FROM strategy_specs WHERE id = $1 AND is_active = true LIMIT 1`,
      [strategyId]
    );
    if (legacyRows.length > 0) return legacyRows[0].spec_json as StrategySpec;
    return null;
  }

  const row = rows[0];
  const base = (row.base_spec ?? {}) as StrategySpec;
  const overrides = (row.overrides ?? {}) as Partial<StrategySpec>;
  const merged = deepMerge(base, overrides);

  return {
    ...merged,
    id: row.variant_id as string,
    familyId: (row.family_id as string) ?? base.familyId ?? (row.variant_id as string),
    name: row.name as string,
    description: row.description ?? (base.description as string | undefined),
    active: row.is_active as boolean,
  } as StrategySpec;
}

export async function listActiveStrategies(
  pool: Pool
): Promise<Array<{ id: string; name: string; version: string }>> {
  const { rows } = await pool.query(
    `SELECT v.id, v.name, COALESCE(v.overrides->>'version', f.base_spec->>'version') AS version
     FROM strategy_variants v
     JOIN strategy_families f ON f.id = v.family_id
     WHERE v.is_active = true
     ORDER BY v.id`
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    version: (r.version as string) ?? "1.0.0",
  }));
}
