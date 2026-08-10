# DXY Derived-Factor Gate Specification v1 — 2026-08-10

Status: **SPECIFICATION ONLY — NOT RATIFIED**  
Runtime effect: **NONE**  
Database writes: **0**

This document defines gates for any future DXY-derived use. It does not classify existing rows, alter canonical lineage, change migrations, or enable execution.

## 1. Fixed classification

DXY remains a derived factor, not canonical candle data.

```text
DXY classification       = NON_AUTHORITATIVE
current decision         = KEEP_BLOCKED_UNKNOWN
permission               = INACTIVE
technical eligibility    = BLOCKED_UNKNOWN
```

No DXY-derived feature, signal, replay, shadow run, or order may pass until this specification is ratified and all gates pass.

## 2. Required lineage evidence

Each DXY observation must bind:

- policy version: `dxy-geometric-v1`;
- fixed formula constant, exponents, and leg order;
- requested timeframe and UTC anchor;
- six canonical FX component row IDs or immutable row hashes;
- canonical broker/source decisions;
- quarantine and detector decisions;
- component OHLC validity and spread evidence;
- calendar classification;
- interval alignment;
- formula output and construction method;
- generator version and source commit;
- provenance hash covering all inputs and formula parameters.

Raw-feed substitution, mixed canonical/raw inputs, interpolation, and silent forward-fill fail the gate.

## 3. Technical eligibility gate

Technical eligibility is `ELIGIBLE` only if every condition passes:

1. all six required component bars exist;
2. all component rows are canonical and clean;
3. no component has unresolved `UNKNOWN`, `EXCLUDE`, or unsuperseded `REPLACED` status;
4. all bars represent same closed UTC interval;
5. calendar classification is `OPEN`;
6. component OHLC and spread checks pass;
7. component jump checks pass or have explicit approved genuine-extreme evidence;
8. formula version and parameters match pinned `dxy-geometric-v1`;
9. formula output is finite and positive;
10. derived OHLC construction passes constraints;
11. provenance hash recomputes exactly;
12. no residual blocker remains for requested interval;
13. workflow explicitly declares derived-factor consumption.

Any failed or incomplete condition returns `BLOCKED_UNKNOWN`, except proven corruption or proven synthetic misalignment, which may return `EXCLUDED` for affected derived observations.

## 4. Permission gate

Permission remains `INACTIVE` unless all conditions below pass:

- technical eligibility is `ELIGIBLE` for every requested observation;
- an approved policy revision exists after this proposal;
- independent reviewer confirms lineage, formula, calendar, and detector evidence;
- workflow declares DXY-derived input and its risk scope;
- no canonical-candle or broker-identity claim depends on DXY;
- fallback behavior is explicit and fail-closed;
- approval is bound to policy version, code commit, evidence artifact hashes, and time window;
- execution authorization separately permits the workflow.

Technical eligibility cannot activate permission. Permission cannot override failed technical eligibility.

## 5. Residual state transitions

Existing `KEEP_BLOCKED_UNKNOWN` rows are evidence locks. They do not transition automatically.

| Current state | Required proof | Recommended state |
|---|---|---|
| `KEEP_BLOCKED_UNKNOWN` | complete canonical six-leg evidence, exact alignment, clean detectors, formula and provenance pass | `APPROVED_DERIVED` |
| `KEEP_BLOCKED_UNKNOWN` | proven component corruption, impossible OHLC, or synthetic misalignment | `EXCLUDE_DERIVED` |
| `KEEP_BLOCKED_UNKNOWN` | missing, conflicting, or incomplete evidence | `KEEP_BLOCKED_UNKNOWN` |

`APPROVED_DERIVED` means usable only under derived-factor gate. It never means canonical DXY promotion.

A state transition requires a new immutable evidence checkpoint, explicit reviewer decision, and policy-version binding. No migration or DB update is implied.

## 6. Missing observed DXY behavior

Observed or stored DXY is not required for synthetic-only derived use if, and only if, a ratified policy explicitly permits formula-only validation. Until that policy is ratified:

- missing stored DXY prevents residual comparison;
- no `APPROVED_DERIVED` recommendation is allowed for locked residual rows;
- formula output alone does not prove historical DXY validity;
- dependent workflows remain blocked.

## 7. Fallback policy

Fallback is disabled by default. If later ratified, fallback must:

- consume only canonical FX legs;
- preserve complete provenance;
- mark output `DERIVED_ONLY`;
- reject incomplete legs rather than fill them;
- remain forbidden for canonical completeness, blocker equivalence, broker identity, or lineage-sensitive evidence;
- fail closed on any unresolved component or stale evidence.

## 8. Audit and ratification requirements

Before ratification, produce immutable read-only artifacts containing:

- ordered residual rows;
- six-leg evidence per row;
- exact formula parameters and tolerance;
- calendar and alignment results;
- detector and quarantine results;
- component and output hashes;
- per-row recommendation;
- reviewer identity, timestamp, and approval scope.

Ratification must be a separate explicit decision. This document alone changes no runtime state.

## 9. Frozen non-actions

```text
DB_WRITES             = 0
MIGRATIONS            = NONE
FEATURE_JOBS          = NONE
BACKFILL              = NONE
REPLAY                = NONE
SHADOW_EXECUTION      = NONE
ORDERS                = NONE
GATES                 = UNCHANGED
AUDIT_PHASE           = OPEN
```
