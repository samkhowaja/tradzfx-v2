# Candle Reliability Audit Checkpoint — 2026-08-11

Status: **READ-ONLY AUDIT — NOT APPROVED**  
Authority: **NON_AUTHORITATIVE**  
Database writes: **0**

This checkpoint freezes candle-reliability review scope. It authorizes evidence collection and documentation only. It does not approve candles, mutate raw data, rebuild canonical projections, alter gates, or start downstream jobs.

## Frozen state

```text
DXY                    = NON_AUTHORITATIVE
DXY residual decision  = KEEP_BLOCKED_UNKNOWN
PERMISSION             = INACTIVE
TECHNICAL_ELIGIBILITY  = BLOCKED_UNKNOWN
DB_WRITES              = 0
GATES                  = UNCHANGED
AUDIT_PHASE            = OPEN
EXECUTION              = NO_SHADOW_RUN_YET
```

## Reliability evidence scope

The audit must preserve and compare, without mutation:

- raw immutable candle rows;
- canonical projections and broker arbitration;
- detector versions, flags, and active blockers;
- v2 versus `candle-detector-v3-robust` results;
- alternate-broker availability;
- calendar and timestamp alignment;
- OHLC, spread, volume, and jump evidence;
- downstream impact on ingestion, feature jobs, setup evaluation, live signal pipeline, and PIT backtest.

Known alternate-broker inventory from prior audit:

```text
alternate broker available = 85
no alternate broker        = 287
```

These counts are evidence inventory only. They do not imply replacement, approval, exclusion, or canonical readiness.

## Fail-closed rules

- Raw candles are immutable.
- No anomaly is auto-approved.
- No `KEEP`, `EXCLUDE`, `REPLACED`, or `UNKNOWN` decision changes without an explicit evidence artifact and review.
- Detector v3 is not final authority until v2/v3 comparison and robust median/MAD review complete.
- DXY synthetic rows remain outside authoritative canonical candle lineage.
- DXY residuals remain `KEEP_BLOCKED_UNKNOWN`.
- Missing or unresolved DXY evidence blocks every DXY-dependent workflow.

## DXY governance fail-fast safeguard

Any detector, feature, backtest, setup evaluator, signal path, or replay that attempts to use DXY as trusted canonical input while DXY is `NON_AUTHORITATIVE` or `KEEP_BLOCKED_UNKNOWN` must fail fast with a governance error. It must not silently substitute, forward-fill, interpolate, reconstruct, or downgrade the DXY input to an accepted value.

Required governance error semantics:

```text
DXY_NON_AUTHORITATIVE_BLOCKED
```

A DXY reference may be inspected as audit evidence only when the operation is explicitly marked read-only and records policy version, provenance, and blocked status.

## Downstream impact

Until separate approval artifacts exist:

- ingestion: no writer or source-policy change;
- feature jobs: no DXY-derived computation or backfill;
- setup evaluation: DXY-dependent setups fail closed;
- live signal pipeline: no DXY-dependent signal eligibility;
- PIT backtest: DXY-dependent paths fail closed or report blocked, never silently omit the blocker;
- execution: no shadow run and no orders.

## Ordered next phases

1. Produce read-only v2/v3 detector comparison.
2. Review 85 alternate-broker candidates as evidence only.
3. Classify 287 no-alternate cases by anomaly type.
4. Define and ratify written candle-quarantine approval policy.
5. Produce canonical segment readiness for non-DXY assets only.
6. Revisit DXY only through its separate derived-factor gate specification.

## Forbidden actions

- raw candle deletion or mutation;
- automatic anomaly approval;
- `features_zone` modification;
- feature backfill or recompute;
- migration execution;
- replay or shadow execution;
- order placement;
- gate relaxation;
- DXY promotion into canonical lineage;
- use of DXY-derived features or signals in execution paths.

## Expected result

Evidence artifacts may improve knowledge of candle reliability. They must not change runtime state. DXY remains blocked, non-authoritative, and excluded from trusted feature and execution paths until explicit technical and permission approvals are recorded.
