#!/usr/bin/env node
/**
 * Read-only database relation-contract audit.
 *
 * Usage:
 *   node scripts/audit-db-contract.js
 *   node scripts/audit-db-contract.js --report
 *   node scripts/audit-db-contract.js --catalog path/to/catalog.json
 *
 * Strict mode exits 1 on contract violations. --report prints violations but
 * exits 0, allowing known legacy findings to be measured before remediation.
 */
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const VALID_KINDS = new Set(["table", "partitioned_table", "view", "materialized_view"]);
const VALID_STATUSES = new Set(["canonical", "auxiliary", "provisional", "legacy", "retired"]);
const REQUIRED_FIELDS = ["kind", "domain", "classification", "grain", "status", "ownerRole", "pitPolicy", "retention"];

function parseArgs(argv) {
  const args = { report: false, catalog: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--report") args.report = true;
    else if (argv[i] === "--catalog") args.catalog = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (args.catalog === undefined) throw new Error("--catalog requires a path");
  return args;
}

function loadContract(filePath) {
  const contract = YAML.parse(fs.readFileSync(filePath, "utf8"));
  if (!contract || contract.version !== 1 || !contract.relations || !contract.scope) {
    throw new Error("Invalid relation contract: expected version, scope, and relations");
  }
  return contract;
}

function validateContract(contract) {
  const errors = [];
  const schemas = new Set(contract.scope.schemas ?? []);
  if (schemas.size === 0) errors.push("scope.schemas must contain at least one schema");

  for (const [name, spec] of Object.entries(contract.relations)) {
    if (!name.includes(".")) errors.push(`${name}: relation name must be schema-qualified`);
    if (!schemas.has(name.split(".", 1)[0])) errors.push(`${name}: schema is outside scope.schemas`);
    for (const field of REQUIRED_FIELDS) {
      if (spec[field] === undefined || spec[field] === null || spec[field] === "") {
        errors.push(`${name}: missing ${field}`);
      }
    }
    if (!VALID_KINDS.has(spec.kind)) errors.push(`${name}: unsupported kind ${spec.kind}`);
    if (!VALID_STATUSES.has(spec.status)) errors.push(`${name}: unsupported status ${spec.status}`);
  }

  const expected = contract.scope.expectedRelationCount;
  const actual = Object.keys(contract.relations).length;
  if (Number.isInteger(expected) && expected !== actual) {
    errors.push(`contract relation count ${actual} differs from expectedRelationCount ${expected}`);
  }
  return errors;
}

function compareCatalog(contract, catalogRows) {
  const errors = [];
  const warnings = [];
  const actual = new Map(catalogRows.map((row) => [row.name, row.kind]));
  const declared = new Map(Object.entries(contract.relations));

  for (const [name, kind] of actual) {
    const spec = declared.get(name);
    if (!spec) {
      errors.push(`UNKNOWN_RELATION ${name} (${kind})`);
      continue;
    }
    if (spec.kind !== kind) errors.push(`KIND_MISMATCH ${name}: contract=${spec.kind} database=${kind}`);
    if (spec.status === "retired") errors.push(`RETIRED_RELATION_PRESENT ${name}`);
  }

  for (const [name, spec] of declared) {
    if (actual.has(name)) continue;
    if (spec.status === "retired") continue;
    if (spec.status === "legacy") warnings.push(`LEGACY_RELATION_MISSING ${name}`);
    else errors.push(`MISSING_RELATION ${name} (${spec.status})`);
  }

  const expected = contract.scope.expectedRelationCount;
  if (Number.isInteger(expected) && actual.size !== expected) {
    errors.push(`DATABASE_RELATION_COUNT database=${actual.size} expected=${expected}`);
  }

  return { errors, warnings };
}

function readCatalogFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("Catalog fixture must be a JSON array");
  return parsed;
}

async function readDatabaseCatalog(contract) {
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
    application_name: "tradzfx-db-contract-audit",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });

  try {
    const schemas = contract.scope.schemas;
    const { rows } = await pool.query(
      `SELECT n.nspname || '.' || c.relname AS name,
              CASE c.relkind
                WHEN 'r' THEN 'table'
                WHEN 'p' THEN 'partitioned_table'
                WHEN 'v' THEN 'view'
                WHEN 'm' THEN 'materialized_view'
              END AS kind
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1::text[])
          AND c.relkind IN ('r', 'p', 'v', 'm')
        ORDER BY 1`,
      [schemas]
    );
    return rows;
  } finally {
    await pool.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const contractPath = path.resolve(__dirname, "..", "infra", "db", "relation-contract.yaml");
  const contract = loadContract(contractPath);
  const definitionErrors = validateContract(contract);
  if (definitionErrors.length > 0) {
    console.error(`Contract definition FAIL (${definitionErrors.length})`);
    for (const error of definitionErrors) console.error(`  ${error}`);
    process.exitCode = 2;
    return;
  }

  const catalog = args.catalog
    ? readCatalogFile(path.resolve(process.cwd(), args.catalog))
    : await readDatabaseCatalog(contract);
  const result = compareCatalog(contract, catalog);

  console.log(`DB contract: declared=${Object.keys(contract.relations).length} actual=${catalog.length} errors=${result.errors.length} warnings=${result.warnings.length}`);
  for (const warning of result.warnings) console.warn(`WARN ${warning}`);
  for (const error of result.errors) console.error(`ERROR ${error}`);

  if (result.errors.length === 0) console.log("OK: relation catalog matches contract.");
  else if (args.report) console.log("REPORT: violations recorded; exit suppressed by --report.");
  else process.exitCode = 1;
}

module.exports = { compareCatalog, loadContract, parseArgs, validateContract };

if (require.main === module) {
  main().catch((error) => {
    console.error(`DB contract audit failed: ${error.message}`);
    process.exit(2);
  });
}
