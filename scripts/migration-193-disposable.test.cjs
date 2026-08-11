"use strict";

// Disposable-only migration 193 gate. Refuses configured production DB names.
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), quiet: true });

const base = {
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
};
const target = process.env.TM_DB_193_TEST_NAME || `tradzfx_193_test_${process.pid}`;
if (!/^tradzfx_193_test_[a-z0-9_]+$/i.test(target)) throw new Error("Refusing non-disposable database name");
if (!base.password) throw new Error("TM_DB_PASSWORD is not set");

const sql = (name) => fs.readFileSync(path.resolve(__dirname, "..", "infra", "migrations", name), "utf8");
const q = async (client, text, values) => (await client.query(text, values)).rows;

async function main() {
  const admin = new Client({ ...base, database: "postgres" });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${target}"`);
  await admin.query(`CREATE DATABASE "${target}"`);
  await admin.end();

  const db = new Client({ ...base, database: target });
  const reviewedRole = `m193_reviewed_${process.pid}`;
  const unrelatedRole = `m193_unrelated_${process.pid}`;
  const rolePassword = `M193_${process.pid}_x!`;
  try {
    await db.connect();
    await db.query("CREATE SCHEMA market");
    await db.query(sql("190_candle_ingestion_runs.sql"));
    await db.query(sql("193_candle_provenance_layers.sql"));
    await db.query(`CREATE ROLE "${reviewedRole}" LOGIN PASSWORD '${rolePassword}'`);
    await db.query(`CREATE ROLE "${unrelatedRole}" LOGIN PASSWORD '${rolePassword}'`);
    await db.query(`GRANT market_provenance_finalizer TO "${reviewedRole}"`);
    await db.query(`GRANT EXECUTE ON FUNCTION market.finalize_authority_bundle(BIGINT) TO "${reviewedRole}"`);
    await db.query(`GRANT USAGE ON SCHEMA market TO "${reviewedRole}", "${unrelatedRole}"`);
    const ownerMeta = await q(db, `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolinherit,
      p.prosecdef, p.proconfig, has_function_privilege('public', 'market.finalize_authority_bundle(bigint)', 'EXECUTE') AS public_execute
      FROM pg_roles r CROSS JOIN pg_proc p
      WHERE r.rolname='market_provenance_finalizer'
        AND p.oid='market.finalize_authority_bundle(bigint)'::regprocedure`);
    if (ownerMeta.length !== 1 || ownerMeta[0].rolcanlogin || ownerMeta[0].rolsuper || !ownerMeta[0].prosecdef || ownerMeta[0].public_execute) {
      throw new Error("finalizer owner/ACL catalog checks failed");
    }
    const tryRoleCall = async (role) => {
      const c = new Client({ ...base, database: target, user: role, password: rolePassword });
      try { await c.connect(); await c.query("SELECT * FROM market.finalize_authority_bundle(999999999)"); return "allowed"; }
      catch (error) { return error.code === "42501" ? `denied:${error.message}` : `other:${error.code}:${error.message}`; }
      finally { await c.end().catch(() => {}); }
    };
    if (!String(await tryRoleCall(unrelatedRole)).startsWith("denied:")) throw new Error("unrelated role was not denied");
    const reviewedResult = await tryRoleCall(reviewedRole);
    if (!reviewedResult.startsWith("other:P0001")) throw new Error(`reviewed role did not reach finalizer: ${reviewedResult}`);
    const vectors = await q(db, `SELECT market.provenance_field('') AS empty_field,
      market.provenance_nullable_field(NULL) AS null_field,
      market.provenance_nullable_field('') AS empty_nullable,
      market.calendar_policy_hash('xauusd', 'cal-test-v1', 'UTC',
        '2026-01-01T00:00:00Z', NULL, 5::smallint, 21::smallint, 0::smallint, 21::smallint, 21::smallint, 60::smallint) AS calendar_hash`);
    if (vectors[0].empty_field !== "0:" || vectors[0].null_field !== "-:" || vectors[0].empty_nullable !== "0:") {
      throw new Error("canonical serialization vector failed");
    }
    if (vectors[0].calendar_hash !== "84f34d2ae5a08aa181d5a2dbb2f50e61834cc24f9c1ad7f862dd850f1405367b") throw new Error(`calendar hash vector failed: ${vectors[0].calendar_hash}`);
    await db.query("BEGIN");
    await db.query(`INSERT INTO market.candle_calendar_policy
      (calendar_version, policy_id, timezone, effective_from, weekend_close_dow, weekend_close_hour,
       weekend_reopen_dow, weekend_reopen_hour, daily_break_start_hour, daily_break_minutes, policy_sha256)
      VALUES ('cal-test-v1','xauusd','UTC','2026-01-01T00:00:00Z',5,21,0,21,21,60,
      market.calendar_policy_hash('xauusd','cal-test-v1','UTC','2026-01-01T00:00:00Z',NULL,5::smallint,21::smallint,0::smallint,21::smallint,21::smallint,60::smallint))`);
    await db.query("ROLLBACK");
    await db.query("BEGIN");
    await db.query(`INSERT INTO market.candle_calendar_policy
      (calendar_version, policy_id, timezone, effective_from, weekend_close_dow, weekend_close_hour,
       weekend_reopen_dow, weekend_reopen_hour, daily_break_start_hour, daily_break_minutes, policy_sha256)
      VALUES ('cal-test-v2','xauusd','UTC','2026-01-01T00:00:00Z',5,21,0,21,21,60,
      market.calendar_policy_hash('xauusd','cal-test-v2','UTC','2026-01-01T00:00:00Z',NULL,5::smallint,21::smallint,0::smallint,21::smallint,21::smallint,60::smallint))`);
    const bundle = await q(db, `INSERT INTO market.htf_authority_bundle
      (symbol,timeframe,interval_start,interval_end,calendar_version,expected_set_sha256,parent_identity_sha256,parent_count)
      VALUES ('XAUUSD','15m','2026-01-05T00:00:00Z','2026-01-05T00:15:00Z','cal-test-v2',repeat('a',64),repeat('b',64),15)
      RETURNING authority_bundle_id`);
    let directRejected = false;
    try {
      await db.query(`UPDATE market.htf_authority_bundle SET finalization_status='FINALIZED', finalized_at=clock_timestamp()
        WHERE authority_bundle_id=$1`, [bundle[0].authority_bundle_id]);
    } catch (error) { directRejected = true; }
    if (!directRejected) throw new Error("direct finalized update was accepted");
    await db.query("ROLLBACK");
    console.log(JSON.stringify({ status: "PASS", database: target, vectors: "PASS", rollback: "PASS", directMutation: "PASS", roles: "PASS" }));
  } finally {
    await db.end();
    const cleanup = new Client({ ...base, database: "postgres" });
    await cleanup.connect();
    await cleanup.query(`DROP DATABASE IF EXISTS "${target}"`);
    await cleanup.query(`DROP ROLE IF EXISTS "${reviewedRole}"`);
    await cleanup.query(`DROP ROLE IF EXISTS "${unrelatedRole}"`);
    await cleanup.end();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
