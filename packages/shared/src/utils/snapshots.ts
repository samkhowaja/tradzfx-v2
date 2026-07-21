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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(canonicalize(obj));
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

export interface CompiledStrategyArtifactInput {
  strategySnapshotId: string;
  strategyId: string;
  compilerVersion: string;
  registryVersion: string;
  sourceRevision: string;
  sourceSpecHash: string;
  pitSignalSql: string;
}

/** Persist exact PIT SQL used for future replay without invoking mutable compiler code. */
export async function getOrCreateCompiledStrategySnapshot(
  pool: Pool,
  input: CompiledStrategyArtifactInput,
): Promise<string> {
  const parameterContract = { symbol: 1, ttlInterval: 2, evaluationTs: 3 };
  const payload = {
    strategySnapshotId: input.strategySnapshotId,
    strategyId: input.strategyId,
    compilerVersion: input.compilerVersion,
    registryVersion: input.registryVersion,
    sourceRevision: input.sourceRevision,
    sourceSpecHash: input.sourceSpecHash,
    pitSignalSql: input.pitSignalSql,
    parameterContract,
  };
  if (!/^[0-9a-f]{64}$/.test(input.sourceSpecHash)) {
    throw new Error("Compiled strategy sourceSpecHash must be a lowercase SHA-256 hex digest");
  }
  if (!input.compilerVersion.trim() || !input.registryVersion.trim()
      || !input.sourceRevision.trim() || !input.pitSignalSql.trim()) {
    throw new Error("Compiled strategy provenance and PIT SQL must be non-empty");
  }

  const contentHash = sha256(canonicalJson(payload));
  const { rows } = await pool.query(
    `WITH inserted AS (
       INSERT INTO compiled_strategy_snapshot (
         content_hash, strategy_snapshot_id, strategy_id, compiler_version,
         registry_version, source_revision, source_spec_hash, pit_signal_sql,
         parameter_contract_json
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (content_hash_bin) DO NOTHING
       RETURNING snapshot_id
     )
     SELECT snapshot_id FROM inserted
     UNION ALL
     SELECT snapshot_id FROM compiled_strategy_snapshot WHERE content_hash_bin = $10
     LIMIT 1`,
    [
      contentHash, input.strategySnapshotId, input.strategyId,
      input.compilerVersion, input.registryVersion, input.sourceRevision,
      input.sourceSpecHash, input.pitSignalSql, JSON.stringify(parameterContract),
      binarySha256(contentHash),
    ],
  );
  if (!rows[0]?.snapshot_id) throw new Error("Compiled strategy snapshot persistence returned no identity");
  return rows[0].snapshot_id as string;
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
  metadata?: Record<string, unknown>,
  compiledStrategySnapshotId?: string,
): Promise<DeploymentMatch> {
  if (!compiledStrategySnapshotId) {
    throw new Error("Live deployment requires compiled strategy provenance");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2))", [strategyId, mode]);

    const { rows: active } = await client.query(
      `SELECT deployment_id
       FROM live_deployment
       WHERE strategy_id = $1
         AND strategy_snapshot_id = $2
         AND feature_snapshot_id = $3
         AND mode = $4
         AND compiled_strategy_snapshot_id = $5
         AND is_active = TRUE
       ORDER BY started_at DESC
       LIMIT 1`,
      [strategyId, strategySnapshotId, featureSnapshotId, mode, compiledStrategySnapshotId],
    );

    if (active.length > 0) {
      await client.query("COMMIT");
      return { deploymentId: active[0].deployment_id as string, isNew: false };
    }

    await client.query(
      `UPDATE live_deployment
       SET is_active = FALSE, ended_at = NOW()
       WHERE strategy_id = $1 AND mode = $2 AND is_active = TRUE`,
      [strategyId, mode],
    );

    const { rows: inserted } = await client.query(
      `INSERT INTO live_deployment (
         strategy_id, strategy_snapshot_id, feature_snapshot_id, mode,
         metadata_json, compiled_strategy_snapshot_id
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING deployment_id`,
      [
        strategyId, strategySnapshotId, featureSnapshotId, mode,
        JSON.stringify(metadata ?? {}), compiledStrategySnapshotId,
      ],
    );
    await client.query("COMMIT");
    return { deploymentId: inserted[0].deployment_id as string, isNew: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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
