"use strict";

// Read-only Migration 193 finalizer ownership/ACL preflight.
// Fails closed unless explicit approved roles are supplied.
const { Client } = require("pg");
const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), quiet: true });

const owner = "market_provenance_finalizer";
const approved = new Set((process.env.TM_193_APPROVED_FINALIZER_ROLES || "")
  .split(",").map((value) => value.trim()).filter(Boolean));
const base = {
  host: process.env.TM_DB_HOST || "localhost",
  port: Number(process.env.TM_DB_PORT || 5432),
  user: process.env.TM_DB_USER || "postgres",
  password: process.env.TM_DB_PASSWORD,
  database: process.env.TM_DB_NAME || process.env.TM_DB_DATABASE || "postgres",
};

async function main() {
  if (!base.password) throw new Error("TM_DB_PASSWORD is not set");
  const db = new Client(base);
  await db.connect();
  try {
    const functionInfo = await db.query(`
      SELECT p.oid::regprocedure::text AS function_name,
             p.prosecdef AS security_definer,
             pg_get_userbyid(p.proowner) AS owner,
             COALESCE(pg_get_functiondef(p.oid), '') AS definition,
             has_function_privilege(current_user, p.oid, 'EXECUTE') AS caller_can_execute,
             array_to_string(COALESCE(p.proacl, acldefault('f', p.proowner)), ',') AS acl
        FROM pg_proc p
       WHERE p.oid = to_regprocedure('market.finalize_authority_bundle(bigint)')`);
     if (functionInfo.rowCount !== 1) {
      console.log(JSON.stringify({ status: "BLOCKED", reason: "migration 193 unapplied; finalizer function absent", checks: {}, blockers: ["UNAPPLIED"] }, null, 2));
      process.exitCode = 1;
      return;
     }
    const fn = functionInfo.rows[0];
    const roleInfo = await db.query(`
      SELECT rolname, rolsuper, rolcanlogin, rolinherit, rolcreaterole, rolcreatedb
        FROM pg_roles WHERE rolname = $1`, [owner]);
    if (roleInfo.rowCount !== 1) throw new Error("dedicated finalizer role missing");
    const role = roleInfo.rows[0];
    const memberships = await db.query(`
      WITH RECURSIVE membership(member_oid, member_name, path, depth) AS (
        SELECT m.member, member.rolname, ARRAY[member.rolname, parent.rolname], 1
          FROM pg_auth_members m
          JOIN pg_roles parent ON parent.oid = m.roleid
          JOIN pg_roles member ON member.oid = m.member
         WHERE parent.rolname = $1
        UNION ALL
        SELECT m.member, member.rolname, membership.path || member.rolname, membership.depth + 1
          FROM membership
          JOIN pg_auth_members m ON m.roleid = membership.member_oid
          JOIN pg_roles member ON member.oid = m.member
         WHERE NOT member.rolname = ANY(membership.path)
      )
      SELECT member_name AS role_name, depth, path FROM membership ORDER BY depth, role_name`, [owner]);
    const unexpected = memberships.rows.filter((row) => !approved.has(row.role_name));
    const checks = {
      securityDefiner: fn.security_definer,
      safeSearchPath: /SET search_path = market, pg_catalog/.test(fn.definition),
      owner,
      ownerNoLogin: !role.rolcanlogin,
      ownerNoSuperuser: !role.rolsuper,
      ownerNoCreateRole: !role.rolcreaterole,
      publicExecuteAbsent: !String(fn.acl).split(",").some((entry) => entry.startsWith("=X/") || entry.startsWith("=X*")),
      memberships: memberships.rows,
      approvedRoles: [...approved],
      unexpectedMemberships: unexpected,
    };
    const blockers = [];
    if (!checks.securityDefiner) blockers.push("finalizer is not SECURITY DEFINER");
    if (!checks.safeSearchPath) blockers.push("unsafe finalizer search_path");
    if (!checks.ownerNoLogin || !checks.ownerNoSuperuser || !checks.ownerNoCreateRole) blockers.push("owner role is privileged or login-capable");
    if (checks.unexpectedMemberships.length) blockers.push("unapproved direct/transitive finalizer membership");
    console.log(JSON.stringify({ status: blockers.length ? "BLOCKED" : "PASS", checks, blockers }, null, 2));
    if (blockers.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
