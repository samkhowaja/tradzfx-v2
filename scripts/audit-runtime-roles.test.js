"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { compareCatalog, parseArgs, validateContract } = require("./audit-runtime-roles.js");

const contract = {
  version: 1,
  ownerRole: "tradzfx_owner",
  migratorRole: "tradzfx_migrator",
  runtimeRoles: {
    tradzfx_ingest: { login: true, inherit: false },
    tradzfx_monitor: { login: true, inherit: false },
  },
};
const relationContract = { relations: { "public.candles_1m": {} } };

function role(name, overrides = {}) {
  return {
    name,
    login: true,
    inherit: false,
    superuser: false,
    createRole: false,
    createDb: false,
    bypassRls: false,
    ...overrides,
  };
}

function cleanCatalog() {
  return {
    roles: [
      role("tradzfx_owner", { login: false, inherit: true }),
      role("tradzfx_migrator", { inherit: true }),
      role("tradzfx_ingest"),
      role("tradzfx_monitor"),
    ],
    relations: [{ name: "public.candles_1m", owner: "tradzfx_owner" }],
    schemas: [{ name: "public", publicCreate: false }],
    publicExecutableFunctions: [],
  };
}

test("matching fail-closed catalog passes", () => {
  assert.deepEqual(validateContract(contract), []);
  assert.deepEqual(compareCatalog(contract, relationContract, cleanCatalog()), { errors: [], warnings: [] });
});

test("missing or elevated roles fail", () => {
  const catalog = cleanCatalog();
  catalog.roles = catalog.roles.filter((item) => item.name !== "tradzfx_monitor");
  catalog.roles.find((item) => item.name === "tradzfx_ingest").superuser = true;
  const result = compareCatalog(contract, relationContract, catalog);
  assert.ok(result.errors.includes("MISSING_ROLE tradzfx_monitor"));
  assert.ok(result.errors.includes("ROLE_SUPERUSER tradzfx_ingest"));
});

test("runtime ownership and ungoverned ownership fail", () => {
  const runtimeOwner = cleanCatalog();
  runtimeOwner.relations[0].owner = "tradzfx_ingest";
  const runtimeResult = compareCatalog(contract, relationContract, runtimeOwner);
  assert.ok(runtimeResult.errors.includes("RUNTIME_OWNS_RELATION public.candles_1m: owner=tradzfx_ingest"));
  assert.ok(runtimeResult.errors.includes("RELATION_OWNER public.candles_1m: expected governed owner actual=tradzfx_ingest"));

  const legacyOwner = cleanCatalog();
  legacyOwner.relations[0].owner = "postgres";
  assert.ok(compareCatalog(contract, relationContract, legacyOwner).errors.includes(
    "RELATION_OWNER public.candles_1m: expected governed owner actual=postgres"
  ));
});

test("PUBLIC schema creation and function execution fail", () => {
  const catalog = cleanCatalog();
  catalog.schemas[0].publicCreate = true;
  catalog.publicExecutableFunctions = ["public.refresh_zone_lifecycle(text)"];
  const result = compareCatalog(contract, relationContract, catalog);
  assert.ok(result.errors.includes("PUBLIC_SCHEMA_CREATE public"));
  assert.ok(result.errors.includes("PUBLIC_FUNCTION_EXECUTE public.refresh_zone_lifecycle(text)"));
});

test("undeclared tradzfx roles warn", () => {
  const catalog = cleanCatalog();
  catalog.roles.push(role("tradzfx_unknown"));
  assert.deepEqual(compareCatalog(contract, relationContract, catalog).warnings, [
    "UNDECLARED_TRADZFX_ROLE tradzfx_unknown",
  ]);
});

test("argument parser supports report and fixture", () => {
  assert.deepEqual(parseArgs(["--report", "--catalog", "catalog.json"]), {
    report: true,
    catalog: "catalog.json",
  });
  assert.throws(() => parseArgs(["--catalog"]), /requires a path/);
  assert.throws(() => parseArgs(["--write"]), /Unknown argument/);
});
