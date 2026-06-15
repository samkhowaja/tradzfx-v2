/**
 * Strategy DB Loader.
 * Loads strategy specs from the database.
 */

import type { Pool } from "@tm/shared";
import type { StrategySpec } from "@tm/shared";

export async function loadStrategyFromDB(
  pool: Pool,
  strategyId: string
): Promise<StrategySpec | null> {
  const { rows } = await pool.query(
    `SELECT spec_json FROM strategy_specs WHERE id = $1 AND is_active = true LIMIT 1`,
    [strategyId]
  );

  if (rows.length === 0) return null;
  return rows[0].spec_json as StrategySpec;
}

export async function listActiveStrategies(
  pool: Pool
): Promise<Array<{ id: string; name: string; version: string }>> {
  const { rows } = await pool.query(
    `SELECT id, name, version FROM strategy_specs WHERE is_active = true ORDER BY id`
  );
  return rows;
}
