# DXY Non-Authoritative Guard Specification — 2026-08-10

Status: **DESIGN ONLY — NOT IMPLEMENTED**  
Authority: **NON_AUTHORITATIVE**  
Runtime effect: **NONE**  
Database writes: **0**

## 1. Frozen invariant

```text
DXY                    = NON_AUTHORITATIVE
residual decision      = KEEP_BLOCKED_UNKNOWN
PERMISSION             = INACTIVE
TECHNICAL_ELIGIBILITY  = BLOCKED_UNKNOWN
DB_WRITES              = 0
GATES                  = UNCHANGED
AUDIT_PHASE            = OPEN
EXECUTION              = NO_SHADOW_RUN_YET
```

No code, configuration, test, database, migration, feature, replay, shadow, or execution change is authorized by this design.

## 2. Guard contract

Stable rejection reason:

```text
DXY_NON_AUTHORITATIVE_BLOCKED
```

Conceptual API:

```ts
assertNonAuthoritativeSeriesNotUsed(series, context)
```

The future implementation must inspect resolved dependencies, not only explicit input names. It must reject execution-bearing paths that depend directly or transitively on DXY while DXY remains non-authoritative.

## 3. Dependency graph

### Node types

- symbols and instruments;
- aliases and symbol maps;
- raw or canonical series;
- derived factors;
- features and HTF aggregates;
- detectors and regime classifiers;
- setups and strategies;
- backtest, replay, job, shadow, demo, and live manifests.

### Edge types

- `ALIAS -> SYMBOL`;
- `SYMBOL -> SERIES`;
- `DERIVED_FACTOR -> SYMBOL`;
- `FEATURE -> SYMBOL | DERIVED_FACTOR | FEATURE`;
- `DETECTOR -> FEATURE | DERIVED_FACTOR`;
- `SETUP -> FEATURE | DETECTOR | DERIVED_FACTOR`;
- `MANIFEST -> SETUP | DETECTOR | FEATURE | SYMBOL`.

Graph resolution must follow edges transitively to terminal data dependencies.

## 4. DXY taint

A node is DXY-tainted when its resolved dependency graph reaches:

- symbol `DXY`;
- an alias resolving to `DXY`;
- a synthetic DXY series;
- a factor whose formula directly uses DXY;
- a feature, detector, setup, or manifest that transitively depends on any tainted node.

Alias matching must include configured symbol maps such as `US_DOLLAR_INDEX` and `DOLLAR_IDX`. Matching must use resolved identity, not string equality alone.

`dxy-geometric-v1` is a derived-factor node and remains non-authoritative under this policy.

## 5. Execution-bearing manifest rule

A manifest is execution-bearing when:

```text
manifest.type ∈ {backtest, replay, live, demo, shadow_run, live_signal_job}
AND manifest.policy.execution_allowed = true
```

If all conditions hold:

```text
DXY.status = NON_AUTHORITATIVE
AND manifest has a DXY-tainted dependency
AND manifest is execution-bearing
```

Future guard behavior:

```text
status            = REJECTED
rejection_reason  = DXY_NON_AUTHORITATIVE_BLOCKED
technical_gate    = BLOCKED_UNKNOWN (unchanged)
permission_gate   = INACTIVE (unchanged)
```

Authorization cannot override this technical block.

## 6. Audit-only rule

A manifest is audit-only only when:

```text
manifest.audit_only = true
AND manifest.type ∈ {backtest, replay, analysis}
AND manifest.policy.execution_allowed = false
```

A DXY-tainted audit-only manifest may be evaluated as:

```text
status                 = ALLOWED_FOR_AUDIT_ONLY
rejection_reason       = DXY_NON_AUTHORITATIVE_BLOCKED
execution_prohibited   = true
must_record_provenance = true
```

Audit-only is constrained inspection, not a bypass. Output must prominently expose DXY taint and rejection reason. Output cannot support technical-eligibility promotion, permission activation, signal approval, or order scheduling.

Required provenance includes resolved graph, policy version, source commit, input hashes, timestamp, and blocked status.

## 7. Required inspection scope

Future implementation must resolve:

1. direct DXY references;
2. aliases and symbol maps;
3. transitive feature and HTF dependencies;
4. DXY-derived factors and factor inputs;
5. detector and setup dependencies;
6. backtest, replay, live, shadow, and job manifests;
7. execution and broker-policy bindings.

A local dependency check is insufficient.

## 8. Gate interaction

Technical eligibility contains this guard as an independent fail-closed rule. It must not be merged into a permissive health score.

Permission activation cannot override a failed technical DXY check. A future permission gate may activate only for workflows with no DXY-tainted execution dependency, or after a separately ratified DXY policy changes status.

Changing DXY status requires a separate immutable evidence checkpoint, policy approval, and explicit gate review. This spec does not change status.

## 9. Required invariants

1. No DXY-tainted execution manifest passes technical eligibility while DXY is `NON_AUTHORITATIVE` and residual decision is `KEEP_BLOCKED_UNKNOWN`.
2. Authorization never overrides this block.
3. Audit-only manifests surface taint, reason, provenance, and execution prohibition.
4. Dependency resolution is transitive and alias-aware.
5. DXY synthetic residuals cannot serve as positive eligibility evidence while locked.
6. Ingestion or audit visibility does not imply trusted canonical eligibility.
7. Silent interpolation, forward-fill, raw fallback, or dependency omission is prohibited.

## 10. Explicit non-actions

```text
RUNTIME_CODE       = NONE
CONFIG_CHANGES     = NONE
TEST_CHANGES       = NONE
DB_WRITES          = 0
MIGRATIONS         = NONE
FEATURE_WORK       = NONE
REPLAY             = NONE
SHADOW_RUN         = NONE
ORDERS             = NONE
GATES              = UNCHANGED
AUDIT_PHASE        = OPEN
```

Implementation requires separate authorization. Until then, DXY remains `NON_AUTHORITATIVE`, and trusted DXY use remains governance-blocked.
