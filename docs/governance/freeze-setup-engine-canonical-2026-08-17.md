# Freeze Governance: Setup Engine & Canonical — 2026-08-17

## Freeze Declaration

**Status:** ACTIVE as of 2026-08-17T05:01:01Z

**Scope:** Setup engine, canonical table promotion, feature backfill, live ingestion, shadow runs.

**Authority:** Governance-grade freeze. No temporary exceptions, partial unfreezes, or "just this once" paths permitted.

**Enforcement:** Hard technical fences (read-only connections, disabled services, design-only artifacts) + governance gates.

```text
permission: INACTIVE
technical_eligibility: BLOCKED_UNKNOWN
shadow_run: NO_SHADOW_RUN_YET
database_writes: 0
```

---

## In-Scope Components (Frozen)

1. **Setup engine** (`apps/engine/src/setup/`)
   - Live setup evaluation disabled.
   - Backtest setup uses frozen canonical reads only.
   - No new setup evaluations, no live signal generation.

2. **Canonical table promotion** (`market.candles_1m_canonical`, `candles_1m_quarantine`)
   - No rebuilds, rewrites, or anomaly repairs.
   - No canonical-to-live promotions or quarantine changes.
   - Canonical rows remain immutable during freeze.

3. **Feature backfill** (`scripts/backfill-historical-features.js`, DAG runner)
   - Feature engine runs only in read-only test mode (no persist).
   - No backfills, reruns, or historical feature updates.
   - Feature tables remain at freeze-time state.

4. **Live ingestion** (`scripts/ingestion-server.js`, MT5/MT4 EAs)
   - Ingestion may write 1m candles to `candles_1m` (raw broker feed).
   - All other writes (features, setups, signals) disabled.
   - No canonical promotion, feature generation, or live setup.

5. **Shadow runs** (`scripts/dry-run-live.ts`, `scripts/backtest-pit-v2.js`)
   - Shadow mode disabled.
   - No isolated shadow evaluation, no live-vs-shadow comparison.
   - Backtest mode restricted to canonical reads + historical features only.

---

## Allowed Work (Read-Only & Design)

### Repository Analysis (No State Changes)

- Map complete pathway: raw candles → broker identity → canonical → quarantine logic → features → setups → signals.
- Audit detector logic (v2/v3 anomaly criteria, symbol-specific rules, edge cases).
- Audit canonical path (fail-closed semantics, approval workflows, lineage dependencies).
- Audit feature generation (backfill vs live semantics, dependencies, cache logic).
- Audit backtest protection (PIT canonical reads, quarantine checks, effective-broker application).
- Audit signal generation (setup→entry logic, risk exposure, position lifecycle).

### Database Analysis (REPEATABLE READ READ ONLY)

All queries must use:
```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
-- audit queries here
ROLLBACK;
```

- Index audit: sizes, definitions, scan counts, bloat on 8 priority tables.
- Coverage audit: candle completeness, quarantine blocker counts by symbol/broker/flag.
- Alternate broker audit: cross-broker data availability for anomaly replacement.
- Anomaly characterization: typical returns, calendar behavior, broker regimes.
- Feature coverage: feature row counts by symbol/timeframe, staleness, gaps.

### Documentation & Governance (Design Artifacts Only)

- Detector readiness specification (v2 vs v3, frozen eval sets, metrics, acceptance criteria).
- Canonical safety specification (anomaly policy per asset class, KEEP/EXCLUDE/REPLACED/UNKNOWN rules).
- Operational safeguards specification (staged rollout, monitoring, rollback criteria).
- Index cleanup plan (`DB-INDEX-01` through `DB-INDEX-05`).
- Feature backfill plan (scope, sequence, parity checks).
- Canonical rebuild plan (approval workflow, anomaly repair, window rebuild).

### Phase Planning (Design Docs, No Implementation)

- Detector validation phases (eval set comparison, v3 sign-off, rollout sequence).
- Canonical reconstruction phases (anomaly approval, repair, rebuild).
- Shadow staging phases (isolated run, live comparison, governance review).
- Backfill and parity phases (trusted window, backfill, parity check, expand gradual).

---

## Disallowed Work (Frozen Until Gate Change)

### Database Writes

- **No schema migrations applied.** Migration files authored during this phase are design artifacts only.
- **No canonical table changes.** No rewrites, repairs, or anomaly fixes.
- **No feature backfills or reruns.** Feature engine persist disabled.
- **No setup evaluation or signal generation.** Live signal path disabled.
- **No quarantine state changes.** Blocker records remain immutable.
- **No ingestion service behavior changes.** Broker feed writes to raw `candles_1m` only.

### Code Changes to Write Paths

- No modifications to setup engine evaluation.
- No modifications to canonical promotion logic.
- No modifications to feature backfill runner.
- No modifications to ingestion persist logic.
- No modifications to signal generation or trade execution.

### "Temporary" Exceptions

- No pilot shadow runs.
- No "just this once" backfills.
- No early migrations or partial unfreezes.
- No experimental write paths.
- No time-limited exceptions outside of recorded gate change.

---

## Technical Enforcement (Defense in Depth)

### Database Level

1. **Audit scripts must use read-only connections:**
   ```javascript
   const client = new pg.Client({...});
   await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');
   // queries here
   await client.query('ROLLBACK;');
   ```

2. **No generic admin sessions** during freeze phase.
   - Use `psql` with `--set default_transaction_read_only=on` if manual queries required.
   - All manual queries must be audit-only (SELECT, EXPLAIN, counts, metadata).

3. **Connection pooling configuration:**
   - Live web/engine pool connections use default read-write mode (for raw ingestion only).
   - Audit/analysis pool connections hard-coded `default_transaction_read_only = on`.

### Application Level

1. **Ingestion server** (`scripts/ingestion-server.js`):
   - Enabled: raw 1m candle writes to `candles_1m` (broker feed, read from EA).
   - Disabled: feature persist, canonical promotion, setup evaluation.
   - Validation: all feature/setup writes caught and logged as errors, **never persisted**.

2. **Feature engine** (`apps/engine/src/dag/runner.ts`):
   - Read-only test mode: compute features, print outputs, **no persist** calls executed.
   - Persist methods guarded by `if (TM_FEATURE_PERSIST_DISABLED) { return; }` (env-controlled).
   - Validation: test mode prints feature rows that would be written, but DB remains unchanged.

3. **Setup engine** (`apps/engine/src/setup/`):
   - Live evaluation disabled: `TM_SETUP_ENGINE_DISABLED=true`.
   - Backtest mode uses read-only canonical path only.
   - Validation: logs report "Setup engine frozen" on startup, no signal generation in logs.

4. **Signal generation** (`apps/tradePipeline/`):
   - Signal writes disabled: `TM_SIGNAL_PERSIST_DISABLED=true`.
   - Log outputs show signal payloads that would be written, **no writes executed**.
   - Validation: `signal_generator` runs in dry-run mode, reports to console only.

### Repo Level

1. **Migration files authored during freeze:**
   - Stored in `docs/governance/migrations/` (design artifacts).
   - Not applied to any schema.
   - Require explicit gate change + approver signature before application.

2. **Write-capable scripts blocked from execution:**
   - `scripts/backfill-historical-features.js` not executed.
   - `scripts/refresh-candle-caggs.js` not executed.
   - `scripts/promote-live.js` not executed (if it exists).
   - `scripts/refresh-lifecycle.js` not executed.
   - Validation: CI/CD or pre-commit hooks reject execution of known write scripts during freeze.

3. **Dry-run-only script mode:**
   - `dry-run-live.ts` / `backtest-pit-v2.js` restricted to:
     - canonical reads from `candles_1m_canonical`,
     - historical features from `features_*` frozen state,
     - no shadow writes, no setup persistence.

---

## Gate Change Process (Future Use, Not Active Yet)

When governance authorizes a freeze transition, the following process must be followed:

### Prerequisite: Written Specification

A gate-change spec must exist (e.g. `governance/gate-change-setup-engine-YYYY-MM-DD.md`) with:

1. **Authorization:**
   - Named approver (person + role).
   - Approval timestamp.
   - Signature or cryptographic assertion.

2. **Scope:**
   - Which components become unfrozen (setup engine, canonical, features, signals, shadow).
   - Which tables become writeable.
   - Which migrations become applicable.
   - Time window (start, end, rollback deadline).

3. **Safety Conditions:**
   - Audit reports completed (detector v2/v3, canonical safety, index analysis).
   - Tests passed (canonical parity, feature backfill, backtest parity).
   - Backups or snapshots created and validated.
   - Rollback plan tested on staging environment.

4. **Monitoring & Rollback:**
   - Metrics to observe post-unfreeze (signal generation, feature freshness, setup coverage).
   - Rollback criteria (if metric X exceeds Y, automatic rollback).
   - Stop-loss thresholds (trade loss, feature staleness, anomaly detection failure).

### Gate Change Execution (Only if Spec Approved)

1. **Enable write paths in order:**
   - Canonical promotion logic (if in scope).
   - Feature backfill engine (if in scope).
   - Setup evaluation (if in scope).
   - Signal generation (if in scope).
   - Shadow runs (if in scope).

2. **Log every write:**
   - All changes traceable to gate-change spec.
   - Audit log records: timestamp, component, table, row count, approver.

3. **Continuous monitoring:**
   - Metrics dashboard tracks post-unfreeze behavior.
   - Automated alerts for rollback thresholds.
   - Manual review at milestones (1h, 6h, 24h post-unfreeze).

4. **Reversibility:**
   - Keep snapshots/backups available for rollback.
   - Document any irreversible changes (e.g. time-based feature gaps if backfill spans past).

---

## Current State (As of 2026-08-17)

```text
permission: INACTIVE
technical_eligibility: BLOCKED_UNKNOWN
shadow_run: NO_SHADOW_RUN_YET
database_writes: 0
```

**Freeze start:** 2026-08-17T05:01:01Z  
**Expected duration:** Until governance explicitly authorizes gate change.  
**Governance owner:** (to be assigned)  
**Rollback owner:** (to be assigned)

---

## Why This Freeze Structure Prevents Drift

1. **Named freeze (not informal):**
   - Governance object with clear scope, enforcement, and escalation path.
   - Reduces accidental erosion through "just this once" decisions.

2. **Defense in depth:**
   - Technical fences (read-only connections, disabled services, guarded persist).
   - Governance fences (written specs, approvers, gate-change process).
   - Even if one layer is missed, others catch the violation.

3. **Explicit gate change (no ambiguity):**
   - Unfreeze requires documented approval + scope + safety conditions.
   - Every write is traceable to a gate-change spec.
   - Reduces risk of unmapped state drift.

4. **Reversibility by design:**
   - Snapshots and backups planned before any unfreeze.
   - Rollback criteria defined upfront, not improvised under pressure.
   - Monitoring metrics chosen to catch anomalies early.

---

## Governance Review Checklist (Before Any Future Unfreeze)

- [ ] Detector v2/v3 audit completed and documented.
- [ ] Canonical safety spec approved (anomaly policies, KEEP/EXCLUDE/REPLACED rules).
- [ ] Index cleanup plan (`DB-INDEX-01…05`) designed and costed.
- [ ] Feature backfill plan (scope, sequence, parity) documented.
- [ ] Shadow staging plan (isolated run, comparison, review) designed.
- [ ] Operational safeguards (rollout phases, monitoring, rollback) specified.
- [ ] Backups/snapshots created and validated.
- [ ] Rollback criteria tested on staging.
- [ ] Named approver assigned.
- [ ] Gate-change spec reviewed and signed by governance.

Until all items are complete, freeze remains:

```text
permission: INACTIVE
technical_eligibility: BLOCKED_UNKNOWN
shadow_run: NO_SHADOW_RUN_YET
database_writes: 0
```

**No temporary exceptions. No partial unfreezes. No "just this once" paths.**
