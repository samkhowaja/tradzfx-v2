"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildSnapshot, classifyPublicFunctions, parseArgs } = require("./snapshot-runtime-governance.js");

const accessContract = {
  roles: {
    tradzfx_lifecycle: {
      functions: { "public.refresh_zone_lifecycle(text)": ["EXECUTE"] },
    },
  },
};

test("PUBLIC functions classify extension, contracted, uncontracted, and definer risk", () => {
  const rows = [
    { name: "public.z_unlisted()", owner: "postgres", language: "plpgsql", securityDefiner: false, extension: null },
    { name: "public.refresh_zone_lifecycle(text)", owner: "postgres", language: "plpgsql", securityDefiner: true, extension: null },
    { name: "public.add_retention_policy(regclass, interval)", owner: "postgres", language: "c", securityDefiner: false, extension: "timescaledb" },
  ];
  assert.deepEqual(classifyPublicFunctions(rows, accessContract), [
    { ...rows[2], classification: "extension_owned", risk: "standard" },
    { ...rows[1], classification: "application_contracted", risk: "security_definer" },
    { ...rows[0], classification: "application_uncontracted", risk: "uncontracted" },
  ]);
});

test("snapshot contains governance state without connection material", () => {
  const catalog = {
    generatedAt: "2026-07-17T00:00:00.000Z",
    database: "tradzfx_v2",
    roles: [{ name: "postgres" }],
    memberships: [], schemas: [], relations: [], relationAcls: [], defaultAcls: [],
    publicExecutableFunctions: [],
  };
  const roleContract = {
    ownerRole: "tradzfx_owner",
    migratorRole: "tradzfx_migrator",
    publicPolicy: { publicSchemaCreate: false, functionExecuteByPublic: false },
  };
  const snapshot = buildSnapshot(catalog, roleContract, accessContract);
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.policy.ownerRole, "tradzfx_owner");
  assert.doesNotMatch(JSON.stringify(snapshot), /TM_DB_|postgresql:\/\/|password/i);
});

test("argument parser accepts one output and rejects unsafe CLI shape", () => {
  assert.deepEqual(parseArgs([]), { output: null });
  assert.deepEqual(parseArgs(["--output", "reports/governance.json"]), { output: "reports/governance.json" });
  assert.throws(() => parseArgs(["--output"]), /requires a path/);
  assert.throws(() => parseArgs(["--execute"]), /Unknown argument/);
});
