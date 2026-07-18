#!/usr/bin/env node
"use strict";

/** Read-only effective privilege audit against runtime-access-contract.json. */
const fs = require("node:fs");
const path = require("node:path");

const RELATION_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const SEQUENCE_PRIVILEGES = ["USAGE", "SELECT", "UPDATE"];

function comparePrivileges(roleName, contract, catalog) {
  const errors = [];
  if (!catalog.roleExists) return { errors: [`MISSING_ROLE ${roleName}`] };
  const expectedRelations = contract.relations ?? {};
  const actualRelations = catalog.relations ?? {};
  const names = new Set([...Object.keys(expectedRelations), ...Object.keys(actualRelations)]);
  for (const name of [...names].sort()) {
    const expected = new Set(expectedRelations[name] ?? []);
    const actual = new Set(actualRelations[name] ?? []);
    for (const privilege of expected) if (!actual.has(privilege)) errors.push(`MISSING_RELATION_PRIVILEGE ${roleName} ${name} ${privilege}`);
    for (const privilege of actual) if (!expected.has(privilege)) errors.push(`EXTRA_RELATION_PRIVILEGE ${roleName} ${name} ${privilege}`);
  }
  const expectedSequences = contract.sequences ?? {};
  const actualSequences = catalog.sequences ?? {};
  for (const name of [...new Set([...Object.keys(expectedSequences), ...Object.keys(actualSequences)])].sort()) {
    const expected = new Set(expectedSequences[name] ?? []);
    const actual = new Set(actualSequences[name] ?? []);
    for (const privilege of expected) if (!actual.has(privilege)) errors.push(`MISSING_SEQUENCE_PRIVILEGE ${roleName} ${name} ${privilege}`);
    for (const privilege of actual) if (!expected.has(privilege)) errors.push(`EXTRA_SEQUENCE_PRIVILEGE ${roleName} ${name} ${privilege}`);
  }
  const expectedFunctions = contract.functions ?? {};
  const actualFunctions = catalog.functions ?? {};
  for (const name of [...new Set([...Object.keys(expectedFunctions), ...Object.keys(actualFunctions)])].sort()) {
    const expected = new Set(expectedFunctions[name] ?? []);
    const actual = new Set(actualFunctions[name] ?? []);
    for (const privilege of expected) if (!actual.has(privilege)) errors.push(`MISSING_FUNCTION_PRIVILEGE ${roleName} ${name} ${privilege}`);
    for (const privilege of actual) if (!expected.has(privilege)) errors.push(`EXTRA_FUNCTION_PRIVILEGE ${roleName} ${name} ${privilege}`);
  }
  return { errors };
}

async function readCatalog(roleName, contract) {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") });
  const { Pool } = require("pg");
  const pool = new Pool({
    host: process.env.TM_DB_HOST ?? "localhost",
    port: Number.parseInt(process.env.TM_DB_PORT ?? "5432", 10),
    database: process.env.TM_DB_NAME ?? "tradzfx_v2",
    user: process.env.TM_DB_USER ?? "postgres",
    password: process.env.TM_DB_PASSWORD,
    application_name: "tradzfx-runtime-access-audit",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const roleResult = await client.query("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists", [roleName]);
    if (!roleResult.rows[0].exists) return { roleExists: false, relations: {}, sequences: {}, functions: {} };
    const relations = {};
    const relationRows = await client.query(
      `SELECT n.nspname || '.' || c.relname AS name,
              p.privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($3::text[]) AS p(privilege)
        WHERE n.nspname = ANY($1::text[])
          AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
          AND has_table_privilege($2, format('%I.%I', n.nspname, c.relname), p.privilege)
        ORDER BY 1, 2`,
      [contract.schemas, roleName, RELATION_PRIVILEGES]
    );
    for (const row of relationRows.rows) (relations[row.name] ??= []).push(row.privilege);
    const sequences = {};
    const sequenceRows = await client.query(
      `SELECT n.nspname || '.' || c.relname AS name,
              p.privilege
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN unnest($3::text[]) AS p(privilege)
        WHERE n.nspname = ANY($1::text[])
          AND c.relkind = 'S'
          AND has_sequence_privilege($2, format('%I.%I', n.nspname, c.relname), p.privilege)
        ORDER BY 1, 2`,
      [contract.schemas, roleName, SEQUENCE_PRIVILEGES]
    );
    for (const row of sequenceRows.rows) (sequences[row.name] ??= []).push(row.privilege);
    const functions = {};
    const functionRows = await client.query(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1::text[])
          AND has_function_privilege($2, p.oid, 'EXECUTE')
        ORDER BY 1`,
      [contract.schemas, roleName]
    );
    for (const row of functionRows.rows) functions[row.name] = ["EXECUTE"];
    await client.query("ROLLBACK");
    return { roleExists: true, relations, sequences, functions };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const roleName = process.argv[2];
  if (!roleName) throw new Error("Usage: node scripts/audit-runtime-access.js <role>");
  const root = path.resolve(__dirname, "..");
  const access = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-access-contract.json"), "utf8"));
  const contract = access.roles[roleName];
  if (!contract) throw new Error(`Unknown runtime role: ${roleName}`);
  const result = comparePrivileges(roleName, contract, await readCatalog(roleName, contract));
  console.log(`Runtime access audit: role=${roleName} errors=${result.errors.length}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  if (result.errors.length) process.exitCode = 1;
  else console.log("OK: effective privileges match exact contract.");
}

module.exports = { comparePrivileges };
if (require.main === module) main().catch((error) => { console.error(`Runtime access audit failed: ${error.message}`); process.exit(2); });
