/**
 * Snapshot helpers for Phase 1 architecture.
 *
 * Creates content-addressed, immutable snapshots of:
 *   - the effective feature DAG configuration
 *   - the strategy spec + runtime overrides
 *   - the active live deployment
 *
 * These snapshots let analysis runs and live executions be reproduced later.
 */

import { createHash } from "crypto";
import type { Pool } from "pg";
import type { StrategySpec, LiveExecutionConfig } from "../types/strategy";

interface FeatureDAGLike {
  getFeatureNames(): string[];
  get(
    name: string
  ): { name: string; version: string; dependencies: string[] } | undefined;
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as object).sort());
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function binarySha256(hexDigest: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hexDigest)) {
    throw new Error("Snapshot content hash must be a lowercase SHA-256 hex digest");
  }
  return Buffer.from(hexDigest, "hex");
}

export async function getOrCreateFeatureConfigSnapshot(
  pool: Pool,
  dag: FeatureDAGLike,
  options: { name?: string; engineVersion?: string; createdBy?: string; notes?: string } = {}
): Promise<string> {
  const definitions = dag
    .getFeatureNames()
    .map((name) => {
      const f = dag.get(name);
      return {
        name: f?.name ?? name,
        version: f?.version ?? "unknown",
        dependencies: f?.dependencies ?? [],
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    name: options.name ?? "v2-default",
    engineVersion: options.engineVersion ?? "2.0.0",
    featureDefinitions: definitions,
  };

  const contentHash = sha256(canonicalJson(payload));

  const { rows: existing } = await pool.query(
    `SELECT snapshot_id FROM feature_config_snapshot WHERE content_hash_bin = $1`,
    [binarySha256(contentHash)]
  );
  if (existing.length > 0) {
    return existing[0].snapshot_id;
  }

  const { rows: inserted } = await pool.query(
    `INSERT INTO feature_config_snapshot (
       content_hash, name, engine_version, feature_definitions, created_by, notes
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING snapshot_id`,
    [
      contentHash,
      payload.name,
      payload.engineVersion,
      JSON.stringify(payload.featureDefinitions),
      options.createdBy ?? null,
      options.notes ?? null,
    ]
  );

  return inserted[0].snapshot_id as string;
}

export async function getOrCreateStrategySettingsSnapshot(
  pool: Pool,
  spec: StrategySpec,
  liveOverrides?: Partial<LiveExecutionConfig>
): Promise<string> {
  const payload = {
    strategyId: spec.id,
    strategyVersion: spec.version,
    name: spec.name,
    specJson: spec,
    liveOverridesJson: liveOverrides ?? null,
  };

  const contentHash = sha256(canonicalJson(payload));

  const { rows: existing } = await pool.query(
    `SELECT snapshot_id FROM strategy_settings_snapshot WHERE content_hash_bin = $1`,
    [binarySha256(contentHash)]
  );
  if (existing.length > 0) {
    return existing[0].snapshot_id;
  }

  const { rows: inserted } = await pool.query(
    `INSERT INTO strategy_settings_snapshot (
       content_hash, strategy_id, strategy_version, name, spec_json, live_overrides_json
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING snapshot_id`,
    [
      contentHash,
      spec.id,
      spec.version,
      spec.name,
      JSON.stringify(spec),
      liveOverrides ? JSON.stringify(liveOverrides) : null,
    ]
  );

  return inserted[0].snapshot_id as string;
}

export interface DeploymentMatch {
  deploymentId: string;
  isNew: boolean;
}

export async function getOrCreateLiveDeployment(
  pool: Pool,
  strategyId: string,
  strategySnapshotId: string,
  featureSnapshotId: string,
  mode: "paper" | "live" = "paper",
  metadata?: Record<string, unknown>
): Promise<DeploymentMatch> {
  // Serialize per strategy/mode so concurrent ingest triggers can't create
  // multiple active deployments.
  await pool.query("SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))", [
    strategyId,
    mode,
  ]);

  // Look for an active deployment with the exact same snapshots.
  const { rows: active } = await pool.query(
    `SELECT deployment_id
     FROM live_deployment
     WHERE strategy_id = $1
       AND strategy_snapshot_id = $2
       AND feature_snapshot_id = $3
       AND mode = $4
       AND is_active = TRUE
     ORDER BY started_at DESC
     LIMIT 1`,
    [strategyId, strategySnapshotId, featureSnapshotId, mode]
  );

  if (active.length > 0) {
    return { deploymentId: active[0].deployment_id as string, isNew: false };
  }

  // Deactivate any prior deployment for this strategy/mode.
  await pool.query(
    `UPDATE live_deployment
     SET is_active = FALSE, ended_at = NOW()
     WHERE strategy_id = $1 AND mode = $2 AND is_active = TRUE`,
    [strategyId, mode]
  );

  const { rows: inserted } = await pool.query(
    `INSERT INTO live_deployment (
       strategy_id, strategy_snapshot_id, feature_snapshot_id, mode, metadata_json
     ) VALUES ($1, $2, $3, $4, $5)
     RETURNING deployment_id`,
    [
      strategyId,
      strategySnapshotId,
      featureSnapshotId,
      mode,
      JSON.stringify(metadata ?? {}),
    ]
  );

  return { deploymentId: inserted[0].deployment_id as string, isNew: true };
}

export interface ActiveDeployment {
  deploymentId: string;
  strategyId: string;
  mode: "paper" | "live";
}

/** List all currently active live deployments. */
export async function getActiveLiveDeployments(pool: Pool): Promise<ActiveDeployment[]> {
  const { rows } = await pool.query(
    `SELECT deployment_id, strategy_id, mode
     FROM live_deployment
     WHERE is_active = TRUE
     ORDER BY strategy_id, mode, started_at DESC`
  );

  return rows.map((r) => ({
    deploymentId: r.deployment_id as string,
    strategyId: r.strategy_id as string,
    mode: r.mode as "paper" | "live",
  }));
}
