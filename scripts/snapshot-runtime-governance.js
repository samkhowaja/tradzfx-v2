#!/usr/bin/env node
"use strict";

/** Deterministic, read-only governance snapshot. Never emits credentials or connection settings. */
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = { output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--output") args.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (args.output === undefined) throw new Error("--output requires a path");
  return args;
}

function normalizeFunctionIdentity(identity) {
  return identity.replace(/\s*,\s*/g, ",").trim();
}

function classifyPublicFunctions(rows, accessContract) {
  const contracted = new Set(
    Object.values(accessContract.roles ?? {})
      .flatMap((role) => Object.keys(role.functions ?? {}))
      .map(normalizeFunctionIdentity)
  );
  return rows.map((row) => {
    const classification = row.extension
      ? "extension_owned"
      : contracted.has(normalizeFunctionIdentity(row.name))
        ? "application_contracted"
        : "application_uncontracted";
    const risk = row.securityDefiner
      ? "security_definer"
      : classification === "application_uncontracted"
        ? "uncontracted"
        : "standard";
    return { ...row, classification, risk };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function buildSnapshot(catalog, roleContract, accessContract) {
  return {
    formatVersion: 1,
    generatedAt: catalog.generatedAt,
    database: catalog.database,
    policy: {
      ownerRole: roleContract.ownerRole,
      migratorRole: roleContract.migratorRole,
      publicSchemaCreate: roleContract.publicPolicy.publicSchemaCreate,
      functionExecuteByPublic: roleContract.publicPolicy.functionExecuteByPublic,
    },
    roles: catalog.roles,
    memberships: catalog.memberships,
    schemas: catalog.schemas,
    relations: catalog.relations,
    relationAcls: catalog.relationAcls,
    defaultAcls: catalog.defaultAcls,
    publicExecutableFunctions: classifyPublicFunctions(catalog.publicExecutableFunctions, accessContract),
  };
}

async function readCatalog(scopeSchemas) {
  require("dotenv").config({ path: path.resolve(__dirname, "..", ".env.local"), quiet: true });
  const { Pool } = require("pg");
  if (!process.env.TM_DB_PASSWORD) throw new Error("TM_DB_PASSWORD is not set; use ignored .env.local");
  const pool = new Pool({
    host: process.env.TM_DB_HOST ?? "localhost",
    port: Number.parseInt(process.env.TM_DB_PORT ?? "5432", 10),
    database: process.env.TM_DB_NAME ?? "tradzfx_v2",
    user: process.env.TM_DB_USER ?? "postgres",
    password: process.env.TM_DB_PASSWORD,
    application_name: "tradzfx-governance-snapshot",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const database = await client.query("SELECT current_database() AS name");
    const roles = await client.query(
      `SELECT rolname AS name, rolcanlogin AS login, rolinherit AS inherit,
              rolsuper AS superuser, rolcreaterole AS "createRole",
              rolcreatedb AS "createDb", rolbypassrls AS "bypassRls"
         FROM pg_catalog.pg_roles
        WHERE rolname = 'postgres' OR rolname LIKE 'tradzfx\\_%' ESCAPE '\\'
        ORDER BY rolname`
    );
    const memberships = await client.query(
      `SELECT member.rolname AS member, parent.rolname AS role,
              membership.admin_option AS "adminOption"
         FROM pg_catalog.pg_auth_members membership
         JOIN pg_catalog.pg_roles parent ON parent.oid = membership.roleid
         JOIN pg_catalog.pg_roles member ON member.oid = membership.member
        WHERE member.rolname LIKE 'tradzfx\\_%' ESCAPE '\\'
           OR parent.rolname LIKE 'tradzfx\\_%' ESCAPE '\\'
        ORDER BY 1, 2`
    );
    const schemas = await client.query(
      `SELECT n.nspname AS name, owner.rolname AS owner,
              COALESCE(n.nspacl::text, '') AS acl
         FROM pg_catalog.pg_namespace n
         JOIN pg_catalog.pg_roles owner ON owner.oid = n.nspowner
        WHERE n.nspname = ANY($1::text[])
        ORDER BY 1`,
      [scopeSchemas]
    );
    const relations = await client.query(
      `SELECT n.nspname || '.' || c.relname AS name, c.relkind AS kind,
              owner.rolname AS owner
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_roles owner ON owner.oid = c.relowner
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m','S','f')
        ORDER BY 1`,
      [scopeSchemas]
    );
    const relationAcls = await client.query(
      `SELECT n.nspname || '.' || c.relname AS name,
              CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
              acl.privilege_type AS privilege, acl.is_grantable AS "grantable"
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) acl
         LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m','S','f')
        ORDER BY 1, 2, 3`,
      [scopeSchemas]
    );
    const defaultAcls = await client.query(
      `SELECT owner.rolname AS owner, COALESCE(n.nspname, '*') AS schema,
              d.defaclobjtype AS "objectType",
              CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee.rolname END AS grantee,
              acl.privilege_type AS privilege, acl.is_grantable AS "grantable"
         FROM pg_catalog.pg_default_acl d
         JOIN pg_catalog.pg_roles owner ON owner.oid = d.defaclrole
         LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
         CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
         LEFT JOIN pg_catalog.pg_roles grantee ON grantee.oid = acl.grantee
        WHERE n.nspname IS NULL OR n.nspname = ANY($1::text[])
        ORDER BY 1, 2, 3, 4, 5`,
      [scopeSchemas]
    );
    const functions = await client.query(
      `SELECT n.nspname || '.' || p.proname || '(' || oidvectortypes(p.proargtypes) || ')' AS name,
              owner.rolname AS owner, language.lanname AS language,
              p.prosecdef AS "securityDefiner", extension.extname AS extension
         FROM pg_catalog.pg_proc p
         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_catalog.pg_roles owner ON owner.oid = p.proowner
         JOIN pg_catalog.pg_language language ON language.oid = p.prolang
         LEFT JOIN pg_catalog.pg_depend dependency
           ON dependency.classid = 'pg_proc'::regclass AND dependency.objid = p.oid AND dependency.deptype = 'e'
         LEFT JOIN pg_catalog.pg_extension extension ON extension.oid = dependency.refobjid
        WHERE n.nspname = ANY($1::text[])
          AND EXISTS (
            SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
             WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
          )
        ORDER BY 1`,
      [scopeSchemas]
    );
    await client.query("ROLLBACK");
    return {
      generatedAt: new Date().toISOString(),
      database: database.rows[0].name,
      roles: roles.rows,
      memberships: memberships.rows,
      schemas: schemas.rows,
      relations: relations.rows,
      relationAcls: relationAcls.rows,
      defaultAcls: defaultAcls.rows,
      publicExecutableFunctions: functions.rows,
    };
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
  const roleContract = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-role-contract.json"), "utf8"));
  const accessContract = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-access-contract.json"), "utf8"));
  const YAML = require("yaml");
  const relationContract = YAML.parse(fs.readFileSync(path.join(root, "infra/db/relation-contract.yaml"), "utf8"));
  const scopeSchemas = [...relationContract.scope.schemas].sort();
  const snapshot = buildSnapshot(await readCatalog(scopeSchemas), roleContract, accessContract);
  const output = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (args.output) fs.writeFileSync(path.resolve(process.cwd(), args.output), output, { flag: "wx" });
  else process.stdout.write(output);
}

module.exports = { buildSnapshot, classifyPublicFunctions, parseArgs };
if (require.main === module) main().catch((error) => { console.error(`Governance snapshot failed: ${error.message}`); process.exit(2); });
