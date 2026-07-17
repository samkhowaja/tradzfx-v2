/**
 * SK-66 guard tests for scripts/recompute-feature-recent.js
 *
 * The guard must make it structurally impossible to recompute a DERIVED feature
 * (one with DAG deps) in a way that rewrites GOOD upstream rows with starved
 * values, while leaving LEAF recompute (the original ATR use case) untouched.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { planRecompute, parseArgs, HTF_SAFE_MIN_LOOKBACK } = require("./recompute-feature-recent.js");

// Minimal fake of FeatureDAG.closure(): returns [deps..., feature] in topo order,
// throws on unknown feature (matches the real implementation).
const DEPS = {
  features_atr: [],
  features_pivot: [],
  features_htf_bias: ["features_atr"],
  features_bias: ["features_htf_bias", "features_atr", "features_pivot"],
  features_direction_state: ["features_bias", "features_htf_bias"],
};
function fakeClosure(requested) {
  const out = [];
  const seen = new Set();
  const visit = (name) => {
    if (!Object.prototype.hasOwnProperty.call(DEPS, name)) {
      throw new Error(`Unknown feature: ${name}`);
    }
    for (const d of DEPS[name]) visit(d);
    if (!seen.has(name)) { seen.add(name); out.push(name); }
  };
  for (const r of requested) visit(r);
  return out;
}
const dag = { closure: fakeClosure };

test("parseArgs separates flags from positionals", () => {
  const { positionals, flags } = parseArgs([
    "XAUUSD", "--htf-safe", "features_atr", "48", "--recompute-deps", "5m,1h", "200",
  ]);
  assert.deepEqual(positionals, ["XAUUSD", "features_atr", "48", "5m,1h", "200"]);
  assert.deepEqual(flags, { recomputeDeps: true, htfSafe: true, useCache: false });
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--bogus"]), /Unknown flag: --bogus/);
});

test("leaf feature defaults to skipCache:true (original ATR behavior)", () => {
  const p = planRecompute("features_atr", dag, { recomputeDeps: false, htfSafe: false, useCache: false }, 40);
  assert.equal(p.abort, false);
  assert.equal(p.skipCache, true);
  assert.equal(p.mode, "leaf-recompute");
  assert.deepEqual(p.deps, []);
});

test("leaf feature honors --use-cache", () => {
  const p = planRecompute("features_atr", dag, { recomputeDeps: false, htfSafe: false, useCache: true }, 40);
  assert.equal(p.abort, false);
  assert.equal(p.skipCache, false);
  assert.equal(p.mode, "leaf-cache");
});

test("derived feature (features_direction_state) is refused by default", () => {
  const p = planRecompute("features_direction_state", dag, { recomputeDeps: false, htfSafe: false, useCache: false }, 40);
  assert.equal(p.abort, true);
  assert.match(p.reason, /Refusing to recompute derived feature/);
  assert.match(p.reason, /reconcile-direction-state\.js/);
  assert.deepEqual(p.deps.sort(), ["features_bias", "features_htf_bias", "features_atr", "features_pivot"].sort());
});

test("derived mid-DAG feature (features_bias) is also refused by default", () => {
  const p = planRecompute("features_bias", dag, { recomputeDeps: false, htfSafe: false, useCache: false }, 40);
  assert.equal(p.abort, true);
  assert.ok(p.deps.includes("features_htf_bias"));
});

test("derived + --recompute-deps with starved lookback is refused", () => {
  const p = planRecompute("features_direction_state", dag, { recomputeDeps: true, htfSafe: false, useCache: false }, 40);
  assert.equal(p.abort, true);
  assert.match(p.reason, /HTF-safe lookback/);
});

test("derived + --recompute-deps with adequate lookback is allowed (with warning)", () => {
  const p = planRecompute("features_direction_state", dag, { recomputeDeps: true, htfSafe: false, useCache: false }, HTF_SAFE_MIN_LOOKBACK);
  assert.equal(p.abort, false);
  assert.equal(p.skipCache, true);
  assert.equal(p.mode, "derived-recompute-deps");
  assert.match(p.warning, /DANGER/);
});

test("derived + --recompute-deps + --htf-safe bypasses lookback threshold", () => {
  const p = planRecompute("features_direction_state", dag, { recomputeDeps: true, htfSafe: true, useCache: false }, 40);
  assert.equal(p.abort, false);
  assert.equal(p.skipCache, true);
});

test("unknown feature aborts cleanly", () => {
  const p = planRecompute("features_does_not_exist", dag, { recomputeDeps: false, htfSafe: false, useCache: false }, 40);
  assert.equal(p.abort, true);
  assert.match(p.reason, /Unknown feature/);
});
