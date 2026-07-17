const test = require("node:test");
const assert = require("node:assert/strict");
const { compareCatalog, parseArgs, validateContract } = require("./audit-db-contract.js");

function contract(relations, expectedRelationCount = Object.keys(relations).length) {
  return {
    version: 1,
    scope: { schemas: ["public"], expectedRelationCount },
    relations,
  };
}

function relation(overrides = {}) {
  return {
    kind: "table",
    domain: "market",
    classification: "source",
    grain: "one row",
    status: "canonical",
    ownerRole: "tradzfx_engine",
    pitPolicy: "anchor-bounded",
    retention: "long-term",
    ...overrides,
  };
}

test("matching catalog passes", () => {
  const spec = contract({ "public.candles_1m": relation() });
  assert.deepEqual(validateContract(spec), []);
  assert.deepEqual(compareCatalog(spec, [{ name: "public.candles_1m", kind: "table" }]), {
    errors: [], warnings: [],
  });
});

test("unknown relation fails", () => {
  const spec = contract({ "public.candles_1m": relation() }, 2);
  const result = compareCatalog(spec, [
    { name: "public.candles_1m", kind: "table" },
    { name: "public.shadow_copy", kind: "table" },
  ]);
  assert.ok(result.errors.some((error) => error.startsWith("UNKNOWN_RELATION public.shadow_copy")));
});

test("missing canonical relation fails and missing legacy warns", () => {
  const spec = contract({
    "public.canonical": relation(),
    "public.legacy": relation({ status: "legacy" }),
  });
  const result = compareCatalog(spec, []);
  assert.ok(result.errors.includes("MISSING_RELATION public.canonical (canonical)"));
  assert.ok(result.warnings.includes("LEGACY_RELATION_MISSING public.legacy"));
});

test("present retired relation fails but absent retired relation passes", () => {
  const spec = contract({ "public.features_fvg": relation({ status: "retired" }) });
  assert.deepEqual(compareCatalog(spec, []).errors, ["DATABASE_RELATION_COUNT database=0 expected=1"]);
  const present = compareCatalog(spec, [{ name: "public.features_fvg", kind: "table" }]);
  assert.ok(present.errors.includes("RETIRED_RELATION_PRESENT public.features_fvg"));
});

test("kind mismatch fails", () => {
  const spec = contract({ "public.pipeline_health": relation({ kind: "view" }) });
  const result = compareCatalog(spec, [{ name: "public.pipeline_health", kind: "table" }]);
  assert.ok(result.errors.includes("KIND_MISMATCH public.pipeline_health: contract=view database=table"));
});

test("contract requires semantic fields", () => {
  const spec = contract({ "public.bad": { kind: "table", status: "canonical" } });
  const errors = validateContract(spec);
  assert.ok(errors.includes("public.bad: missing grain"));
  assert.ok(errors.includes("public.bad: missing ownerRole"));
});

test("argument parser supports report and fixture", () => {
  assert.deepEqual(parseArgs(["--report", "--catalog", "catalog.json"]), {
    report: true,
    catalog: "catalog.json",
  });
});
