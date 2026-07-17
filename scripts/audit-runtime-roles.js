#!/usr/bin/env node
"use strict";

/**
 * Read-only runtime-role catalog preflight.
 *
 * Usage:
 *   node scripts/audit-runtime-roles.js
 *   node scripts/audit-runtime-roles.js --report
 *   node scripts/audit-runtime-roles.js --catalog path/to/catalog.json
 *
 * Strict mode exits 1 on drift. --report records findings without blocking.
 * No role, ownership, grant, or schema mutation is performed.
 */
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = { report: false, catalog: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--report") args.report = true;
    else if (argv[index] === "--catalog") args.catalog = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.catalog === undefined) throw new Error("--catalog requires a path");
  return args;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateContract(contract) {
  const errors = [];
  if (!contract || contract.version !== 1) errors.push("contract version must equal 1");
  if (!contract.ownerRole) errors.push("ownerRole is required");
  if (!contract.migratorRole) errors.push("migratorRole is required");
  if (!contract.runtimeRoles || Object.keys(contract.runtimeRoles).length === 0) {
    errors.push("runtimeRoles must not be empty");
  }
  const reserved = new Set([contract.ownerRole, contract.migratorRole]);
  for (const [name, role] of Object.entries(contract.runtimeRoles ?? {})) {
    if (reserved.has(name)) errors.push(`${name}: owner/migrator cannot be a runtime role`);
    if (role.login !== true) errors.push(`${name}: login must equal true`);
    if (role.inherit !== false) errors.push(`${name}: inherit must equal false`);
  }
  return errors;
}

function compareCatalog(contract, relationContract, catalog) {
  const errors = [];
  const warnings = [];
  const roles = new Map((catalog.roles ?? []).map((role) => [role.name, role]));
  const expectedRoles = [contract.ownerRole, contract.migratorRole, ...Object.keys(contract.runtimeRoles)];

  for (const name of expectedRoles) {
    const actual = roles.get(name);
    if (!actual) {
      errors.push(`MISSING_ROLE ${name}`);
      continue;
    }
    const runtime = contract.runtimeRoles[name];
    const expectedLogin = runtime ? true : name === contract.migratorRole;
    if (actual.login !== expectedLogin) {
      errors.push(`ROLE_LOGIN ${name}: expected=${expectedLogin} actual=${actual.login}`);
    }
    if (runtime && actual.inherit !== false) {
      errors.push(`ROLE_INHERIT ${name}: expected=false actual=${actual.inherit}`);
    }
    if (actual.superuser) errors.push(`ROLE_SUPERUSER ${name}`);
    if (actual.createRole) errors.push(`ROLE_CREATE_ROLE ${name}`);
    if (actual.createDb) errors.push(`ROLE_CREATE_DB ${name}`);
    if (actual.bypassRls) errors.push(`ROLE_BYPASS_RLS ${name}`);
  }

  const runtimeNames = new Set(Object.keys(contract.runtimeRoles));
  for (const relation of catalog.relations ?? []) {
    if (runtimeNames.has(relation.owner)) {
      errors.push(`RUNTIME_OWNS_RELATION ${relation.name}: owner=${relation.owner}`);
    }
    const declared = relationContract.relations?.[relation.name];
    if (declared && relation.owner !== contract.ownerRole && relation.owner !== contract.migratorRole) {
      errors.push(`RELATION_OWNER ${relation.name}: expected governed owner actual=${relation.owner}`);
    }
  }

  for (const schema of catalog.schemas ?? []) {
    if (schema.name === "public" && schema.publicCreate) errors.push("PUBLIC_SCHEMA_CREATE public");
  }
  for (const fn of catalog.publicExecutableFunctions ?? []) {
    errors.push(`PUBLIC_FUNCTION_EXECUTE ${fn}`);
  }

  for (const name of roles.keys()) {
    if (name.startsWith("tradzfx_") && !expectedRoles.includes(name)) {
      warnings.push(`UNDECLARED_TRADZFX_ROLE ${name}`);
    }
  }
  return { errors, warnings };
}

async function readDatabaseCatalog(contract, relationContract) {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local") });
  const { Pool } = require("pg");
  const password = process.env.TM_DB_PASSWORD;
  if (!password) throw new Error("TM_DB_PASSWORD is not set; use ignored .env.local");
  const pool = new Pool({
    host: process.env.TM_DB_HOST ?? "localhost",
    port: Number.parseInt(process.env.TM_DB_PORT ?? "5432", 10),
    database: process.env.TM_DB_NAME ?? "tradzfx_v2",
    user: process.env.TM_DB_USER ?? "postgres",
    password,
    application_name: "tradzfx-runtime-role-audit",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const expectedRoles = [contract.ownerRole, contract.migratorRole, ...Object.keys(contract.runtimeRoles)];
    const roles = await client.query(
      `SELECT rolname AS name, rolcanlogin AS login, rolinherit AS inherit,
              rolsuper AS superuser, rolcreaterole AS "createRole",
              rolcreatedb AS "createDb", rolbypassrls AS "bypassRls"
         FROM pg_catalog.pg_roles
        WHERE rolname = ANY($1::text[]) OR rolname LIKE 'tradzfx\\_%' ESCAPE '\\'
        ORDER BY rolname`,
      [expectedRoles]
    );
    const relations = await client.query(
      `SELECT n.nspname || '.' || c.relname AS name, r.rolname AS owner
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
        ORDER BY 1`,
      [relationContract.scope.schemas]
    );
    const schemas = await client.query(
      `SELECT n.nspname AS name,
              EXISTS (
                SELECT 1
                  FROM aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'CREATE'
              ) AS "publicCreate"
         FROM pg_catalog.pg_namespace n
        WHERE n.nspname = ANY($1::text[])
        ORDER BY 1`,
      [relationContract.scope.schemas]
    );
    const functions = await client.query(
      `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS name
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = ANY($1::text[])
          AND EXISTS (
            SELECT 1
              FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          )
        ORDER BY 1`,
      [relationContract.scope.schemas]
    );
    await client.query("ROLLBACK");
    return { roles: roles.rows, relations: relations.rows, schemas: schemas.rows, publicExecutableFunctions: functions.rows.map((row) => row.name) };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const contract = loadJson(path.join(root, "infra/db/runtime-role-contract.json"));
  const YAML = require("yaml");
  const relationContract = YAML.parse(fs.readFileSync(path.join(root, "infra/db/relation-contract.yaml"), "utf8"));
  const definitionErrors = validateContract(contract);
  if (definitionErrors.length) {
    for (const error of definitionErrors) console.error(`ERROR ${error}`);
    process.exitCode = 2;
    return;
  }
  const catalog = args.catalog
    ? loadJson(path.resolve(process.cwd(), args.catalog))
    : await readDatabaseCatalog(contract, relationContract);
  const result = compareCatalog(contract, relationContract, catalog);
  console.log(`Runtime role preflight: errors=${result.errors.length} warnings=${result.warnings.length}`);
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);
  if (result.errors.length === 0) console.log("OK: runtime role catalog matches contract.");
  else if (args.report) console.log("REPORT: violations recorded; exit suppressed by --report.");
  else process.exitCode = 1;
}

module.exports = { compareCatalog, parseArgs, validateContract };
if (require.main === module) main().catch((error) => { console.error(`Runtime role audit failed: ${error.message}`); process.exit(2); });
