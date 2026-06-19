import pg from "pg";
import crypto from "crypto";

const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  database: "tradementor_v2",
  user: "postgres",
  password: "2k16Dub@i",
});

function hash(obj) {
  return crypto.createHash("md5").update(JSON.stringify(obj)).digest("hex");
}

async function createDeployment() {
  // Fetch the active spec.
  const { rows: specRows } = await pool.query(
    "SELECT id, name, version, spec_json FROM strategy_specs WHERE id = 'waqar_v2_15m' AND is_active = true LIMIT 1"
  );
  if (specRows.length === 0) {
    throw new Error("waqar_v2_15m is not active");
  }
  const spec = specRows[0];

  // Create or reuse a strategy settings snapshot.
  const strategySnapshot = {
    strategy_id: spec.id,
    strategy_version: spec.version,
    name: spec.name,
    spec_json: spec.spec_json,
    live_overrides_json: {},
  };
  const strategyHash = hash(strategySnapshot);
  let { rows: ssRows } = await pool.query(
    "SELECT snapshot_id FROM strategy_settings_snapshot WHERE content_hash = $1 LIMIT 1",
    [strategyHash]
  );
  let strategySnapshotId;
  if (ssRows.length > 0) {
    strategySnapshotId = ssRows[0].snapshot_id;
  } else {
    const insert = await pool.query(
      `INSERT INTO strategy_settings_snapshot (content_hash, strategy_id, strategy_version, name, spec_json, live_overrides_json)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING snapshot_id`,
      [strategyHash, strategySnapshot.strategy_id, strategySnapshot.strategy_version, strategySnapshot.name, JSON.stringify(strategySnapshot.spec_json), JSON.stringify(strategySnapshot.live_overrides_json)]
    );
    strategySnapshotId = insert.rows[0].snapshot_id;
  }

  // Create or reuse a generic feature config snapshot.
  const featureSnapshot = {
    name: "v2-default",
    engine_version: "2.0.0",
    feature_definitions: {},
  };
  const featureHash = hash(featureSnapshot);
  let { rows: fsRows } = await pool.query(
    "SELECT snapshot_id FROM feature_config_snapshot WHERE content_hash = $1 LIMIT 1",
    [featureHash]
  );
  let featureSnapshotId;
  if (fsRows.length > 0) {
    featureSnapshotId = fsRows[0].snapshot_id;
  } else {
    const insert = await pool.query(
      `INSERT INTO feature_config_snapshot (content_hash, name, engine_version, feature_definitions)
       VALUES ($1, $2, $3, $4) RETURNING snapshot_id`,
      [featureHash, featureSnapshot.name, featureSnapshot.engine_version, JSON.stringify(featureSnapshot.feature_definitions)]
    );
    featureSnapshotId = insert.rows[0].snapshot_id;
  }

  // Deactivate any prior deployment for this strategy/mode and create a new one.
  await pool.query(
    "UPDATE live_deployment SET is_active = FALSE, ended_at = NOW() WHERE strategy_id = $1 AND mode = $2 AND is_active = TRUE",
    [spec.id, "live"]
  );
  const { rows: depRows } = await pool.query(
    `INSERT INTO live_deployment (strategy_id, strategy_snapshot_id, feature_snapshot_id, mode, metadata_json)
     VALUES ($1, $2, $3, $4, $5) RETURNING deployment_id`,
    [spec.id, strategySnapshotId, featureSnapshotId, "live", JSON.stringify({ source: "activate-waqar-v2-15m" })]
  );

  console.log(`Created live deployment ${depRows[0].deployment_id} for waqar_v2_15m`);
  await pool.end();
}

createDeployment().catch((e) => {
  console.error(e);
  process.exit(1);
});
