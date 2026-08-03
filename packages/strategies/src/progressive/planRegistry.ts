import type { Pool } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import type { ProgressivePlan } from "./types";

export async function registerProgressivePlan(pool: Pool, plan: ProgressivePlan): Promise<boolean> {
  const { planHash, ...unsigned } = plan;
  const computedHash = hashProgressiveValue(unsigned);
  if (computedHash !== planHash) {
    throw new Error(`Progressive plan hash mismatch: expected ${planHash}, computed ${computedHash}`);
  }
  const { rows } = await pool.query(
    `INSERT INTO progressive_plan_registry (
       plan_hash, strategy_id, strategy_version, plan_json
     ) VALUES ($1,$2,$3,$4::jsonb)
     ON CONFLICT (plan_hash) DO NOTHING
     RETURNING plan_hash`,
    [plan.planHash, plan.strategyId, plan.strategyVersion, JSON.stringify(plan)],
  );
  if (rows.length) return true;
  const existing = await pool.query(
    `SELECT plan_json FROM progressive_plan_registry WHERE plan_hash = $1`,
    [plan.planHash],
  );
  if (!existing.rows[0]) throw new Error("Progressive plan conflict lookup returned no row");
  if (hashProgressiveValue(existing.rows[0].plan_json) !== hashProgressiveValue(plan)) {
    throw new Error(`Progressive plan identity collision: ${plan.planHash}`);
  }
  return false;
}

export async function loadProgressivePlan(pool: Pool, planHash: string): Promise<ProgressivePlan | null> {
  const { rows } = await pool.query(
    `SELECT plan_json FROM progressive_plan_registry WHERE plan_hash = $1`,
    [planHash],
  );
  if (!rows[0]) return null;
  const plan = rows[0].plan_json as ProgressivePlan;
  if (plan.planHash !== planHash) throw new Error(`Progressive plan registry corruption: ${planHash}`);
  return plan;
}
