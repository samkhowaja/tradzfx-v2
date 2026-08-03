# Causal Engine Repair Plan

**Status:** Design only. No production implementation authorized by this document.

**Scope:** Repair contaminated event and state features so live and point-in-time (PIT) outputs obey availability-time semantics. Clean candle-only research remains separate and must not depend on repaired features.

**Current evidence:** July 1–15, 2026 `features_zone` candle-only 5m FVG holdout passed for EURUSD, GBPUSD, and XAUUSD. This validates a research lead, not contaminated feature correctness or production readiness.

## Critical Finding (2026-07-30)

Production `features_structure` v2.1.0 contains a causal path (`detectCausalBreakEvents`), but `detectStructure()` selects it only when `USE_CAUSAL_STRUCTURE="true"` and symbol/timeframe filters match. Default execution remains the retrospective `detectBreakEvents()` path.

Consequences:

- Historical backtests, live signals, and persisted downstream features must be treated as contaminated unless their execution environment explicitly enabled the causal path.
- `availableAtTs` and confirmation-aware filtering in the opt-in path do not make the production default causal.
- The opt-in path has active-map state, but lacks the required external/internal retention model, bounded internal FIFO policy, and specified MSS rule requiring confirmed sweep + displacement + trend transition.
- The 5m FVG candle-only simulator remains independent evidence and is not invalidated by this finding.

Required correction:

1. Make the causal implementation the only production structure path after audit and completion.
2. Implement external/internal retention and bounded internal FIFO behavior.
3. Implement causal MSS semantics.
4. Resolve `availableAtTs` against `docs/CANDLE_TIMESTAMP_SEMANTICS.md` and timeframe duration.
5. Identify all historical runs and persisted rows produced with `USE_CAUSAL_STRUCTURE=true` before any selective trust or re-backfill.

No causal baseline tag should be created until these conditions and parity gates pass.

## 1. Pivot Producer Fix

**Producer:** `apps/engine/src/features/pivot.ts`.

**Current version:** `features_pivot` v1.2.0. `PivotOutput` already emits `confirmationTs`, currently derived from `candles[i + lookback].ts + tfMs`.

**Verified status:** `confirmationTs` already exists in `PivotOutput`, pivot tests, serializer/deserializer, and the producer. Database table `features_pivot` does **not** contain `confirmation_ts`; persisted pivot rows therefore cannot currently carry this field.

**Required work:**

- Add `confirmation_ts TIMESTAMPTZ` to `features_pivot`; then verify the existing type and serializer/deserializer preserve it as `Date` / `TIMESTAMPTZ` end to end.
- Define timestamp semantics using `docs/CANDLE_TIMESTAMP_SEMANTICS.md`. A candle timestamp represents its configured bar boundary; availability occurs only after the confirming candle closes.
- Prefer one explicit formula: `confirmationTs = candles[index + lookback].ts + TF_MS[tf]` when timestamps are bar-open timestamps.
- Reject missing, non-finite, or pre-formation confirmation timestamps.
- Ensure final incomplete lookback window never emits a pivot usable at current anchor.
- Preserve pivot formation timestamp in `ts`; do not replace it with confirmation time.
- Audit all consumers: structure, sweep, pricing, equal-liquidity, bias, and SQL registry joins.

**Acceptance:** no pivot is consumable at anchor `t` unless `pivot.confirmationTs <= t`; no serialized row loses confirmation metadata; live and PIT use same rule.

**Regression tests:**

- Pivot confirmation occurs exactly after required right-side candles close.
- Pivot is absent from candidate input before confirmation.
- Pivot becomes available at confirmation timestamp, not formation timestamp.
- Last incomplete right-side window emits no usable pivot.

## 2. Runner Boundary Fix

**Producer boundary:** `packages/shared/src/candles/candleSource.ts`, `getRecentCandles()`.

**Verified status:** the current implementation already subtracts `TF_MS[tf]` from `endTs` and queries `ts <= completedEndTs`. This section is verification and parity hardening, not an assumed missing implementation.

**Consumers:** `apps/engine/src/dag/runner.ts` and PIT/backtest callers.

**Required work:**

- Preserve and test the existing completed-bar boundary: `candle.ts + tf_duration <= endTs`.
- Apply same boundary for live triggers, scheduled workers, targeted recomputes, and PIT runs.
- Verify `apps/engine/src/dag/runner.ts` fetches only completed candles through `getRecentCandles()`.
- Verify live 15m trigger does not pass an in-progress 15m candle into feature computation.
- Verify PIT `asOf` excludes a bar whose close is after `asOf`.
- Keep count-based, gap-tolerant retrieval behavior; change only completion eligibility.

**Acceptance:** for every timeframe, a candle with `ts + TF_MS > endTs` is excluded. A candle with `ts + TF_MS <= endTs` is eligible. No caller adds a conflicting boundary.

**Regression tests:**

- Edge candle exactly at `endTs - TF_MS` is included.
- Edge candle beginning at `endTs` is excluded.
- In-progress bar is excluded from live and PIT paths.
- Live/PIT candle sets match for same symbol, timeframe, and as-of timestamp.

## 3. Structure Producer Refactor

**Producer:** `apps/engine/src/features/structure.ts`.

**Current version:** `features_structure` v2.1.0. Current implementation consumes `features_pivot`, `features_atr`, and `features_htf_bias`; it already contains `availableAtTs`, `confirmationTs`, confirmed-pivot filtering, serializer/deserializer support, and parity tests. The remaining work is to verify whether its algorithm meets the specified incremental external/internal-level and MSS semantics; do not assume a full rewrite is required before auditing those paths.

**Required algorithm:**

- Replace retrospective pivot-pair scanning with incremental state processing in candle order.
- Maintain `activeLevels` state per timeframe and symbol.
- Classify levels as external or internal.
- Retain external levels until explicitly broken or invalidated.
- Retain internal levels in FIFO order with a maximum of 10 active levels.
- Admit pivot levels only when `confirmationTs <= candidateCandle.ts`.
- Emit each event once using deterministic identity: symbol, timeframe, event type, level timestamp, and event timestamp.
- Emit `eventTs` as the candle that confirms the break/transition.
- Emit `availableAtTs` as the first timestamp at which all inputs are known and the event is usable.
- Define BOS, CHoCH, and MSS separately. MSS requires confirmed sweep, displacement, and trend transition; a label must not be inferred from a retrospective outcome.
- Make ordering deterministic for equal timestamps and equal prices.
- Remove future-dependent scans, duplicate emissions, and state derived from rows after candidate timestamp.

**Acceptance:** structure output at anchor `t` is identical when computed from data ending at `t` versus a longer dataset truncated at `t`; event availability is monotonic; no event references unconfirmed pivots.

**Regression tests:**

- Future pivot cannot create an earlier event.
- Same input produces no duplicate event rows.
- `availableAtTs >= eventTs` where event semantics require close confirmation.
- MSS requires sweep + displacement + trend transition.
- External level survives internal-level FIFO eviction.
- Event ordering remains stable across repeated runs.

## 4. Sweep Producer Fix

**Producer:** `apps/engine/src/features/sweep.ts`.

**Current version:** `features_sweep` v1.4.0. Current inputs include `features_pivot`, `features_atr`, and optional `features_structure`; sweep output is emitted on the close-back candle. Database table `features_sweep` currently has no `available_at_ts` column.

**Required work:**

- Filter pivot levels with `pivot.confirmationTs <= candidateCandle.ts`.
- Add `availableAtTs` to sweep event output and persistence contract.
- Link sweeps only to confirmed structure levels.
- Preserve prior-day and equal-high/equal-low level rules without using future candles.
- Verify equal-level clustering uses only levels known at candidate timestamp.
- Ensure close-back and penetration candles are both closed before event emission.
- Keep structure confluence as a score unless strategy contract explicitly requires a confirmed structure event.
- Define deterministic sweep identity and prevent duplicate rows during incremental recompute.

**Acceptance:** sweep output at time `t` contains no pivot or structure input unavailable by `t`; emitted sweep timestamp equals close-back candle timestamp; `availableAtTs` is persisted and respected by consumers.

**Regression tests:**

- Unconfirmed pivot cannot produce sweep.
- Sweep cannot use future equal-high/equal-low cluster members.
- Close-back event is unavailable before close-back candle completion.
- Repeated incremental runs produce one event per identity.

## 5. Order Block Audit

**Producer:** `apps/engine/src/features/orderBlock.ts`; table `features_order_block` exists.

**Current version:** `features_order_block` v1.4.1. Current dependency is `features_structure`; it detects order blocks from structure events and candles.

**Required work:**

- Trace every input used by order-block detection and serialization.
- Determine whether structure events, pivots, bias, or future candle ranges influence block formation, mitigation, or invalidation.
- If order blocks depend on contaminated structure, keep `features_order_block` quarantined until structure repair and re-backfill complete.
- If any candle-only order-block path exists, split it into an explicitly named contract rather than mixing it with structure-derived output.
- Define formation timestamp, availability timestamp, mitigation timestamp, and invalidation timestamp separately.
- Verify lifecycle fields are point-in-time safe in SQL and backtest paths.
- Document whether stored lifecycle may be trusted live but must be recomputed in PIT mode.

**Acceptance:** dependency graph and timestamp semantics are documented. No order-block row is promoted to clean contract without causal tests and registry evidence.

## 6. Bias / Direction State Audit

**Producers:** `apps/engine/src/features/bias.ts`, `apps/engine/src/features/directionState.ts`.

**Current versions:** `features_bias` v3.0.0; `features_direction_state` v1.0.0. No database table named `feature_registry` exists in the inspected database; authoritative versions currently come from code and `packages/strategies/src/readinessRequirements.ts`.

**Lineage:**

```text
features_pivot + features_structure + features_htf_bias + features_atr
                                      |
                              features_bias
                                      |
                         features_direction_state
```

**Required work:**

- Confirm `features_bias` inherits contamination from structure and pivot inputs. Current code consumes both.
- Confirm `features_direction_state` inherits contamination through `features_bias`; it also consumes `features_htf_bias`.
- Audit HTF alignment and availability timestamps independently. HTF bias must not be available before its source bar closes.
- Ensure bias state at timestamp `t` uses only structure/pivot events with availability `<= t`.
- Ensure direction reconciliation is deterministic when bias and HTF bias disagree or are missing.
- Keep both features quarantined until structure and pivot repairs pass causal tests.
- After repair, re-backfill bias first, then direction state, using full dependency context.

**Acceptance:** truncation at timestamp `t` cannot alter bias or direction state before `t`; lineage metadata identifies all consumed rows and their availability times.

## 7. Registry Version Bumps

Registry locations: `packages/strategies/src/featureRegistry.ts` and `packages/strategies/src/readinessRequirements.ts`. Runtime versions originate from feature definitions under `apps/engine/src/features`.

| Feature | Current Version | Proposed New Version | Reason |
|---|---:|---:|---|
| `features_pivot` | 1.2.0 | 1.3.0 | Persist existing `confirmationTs` contract in DB and verify semantics |
| `features_structure` | 2.1.0 | TBD | Existing `availableAtTs` path requires audit before deciding algorithm/version bump |
| `features_sweep` | 1.4.0 | 1.5.0 | Persist `availableAtTs`, confirmed levels, and causal filtering |
| `features_bias` | 3.0.0 | 3.1.0 | Recompute after repaired structure/pivot lineage |
| `features_direction_state` | 1.0.0 | 1.1.0 | Recompute after repaired bias lineage |
| `features_order_block` | 1.4.1 | TBD | Bump only after dependency audit determines required change |

Version numbers are proposals, not implementation decisions. Final values must match producer definitions, registry contracts, readiness requirements, migration notes, and persisted `engine_ver` values.

Required registry changes:

- Declare new columns and availability semantics.
- Require compatible `engine_ver` for repaired rows.
- Keep old rows unreadable for repaired strategy variants unless an explicit compatibility policy exists.
- Update feature hashes when serialized output changes.
- Add schema/contract tests for every new field.

## 8. DB Migration Specification

Migration must be additive and pass destructive-migration governance. Do not drop or rewrite protected data in migration itself.

```sql
ALTER TABLE features_pivot
  ADD COLUMN IF NOT EXISTS confirmation_ts TIMESTAMPTZ;

ALTER TABLE features_structure
  ADD COLUMN IF NOT EXISTS available_at_ts TIMESTAMPTZ;

ALTER TABLE features_sweep
  ADD COLUMN IF NOT EXISTS available_at_ts TIMESTAMPTZ;
```

Verified against current database: `features_pivot.confirmation_ts` and `features_sweep.available_at_ts` are missing; `features_structure` already has `confirmation_ts` but does not currently have `available_at_ts`. Migration must therefore add all three required columns, while preserving existing structure confirmation data.

Before migration approval:

- Confirm exact schemas, constraints, indexes, and table ownership.
- Confirm columns are nullable during transition so old rows remain readable only under legacy policy.
- Add indexes for common availability predicates, for example `(symbol, tf, available_at_ts)` where query plans justify them.
- Add validation checks after backfill, not as an unsafe immediate constraint on historical rows.
- Decide whether event identity uniqueness requires a new unique index; create it only after duplicate audit.
- Record migration number, rollback strategy, backup requirement, and operational owner.

Backfill policy:

- Do not fabricate confirmation or availability timestamps from wall-clock `now()`.
- Recompute from source candles and repaired producer logic.
- Quarantine rows that cannot be reconstructed causally.
- Validate row counts, duplicate identities, null availability, and availability ordering before promotion.

## 9. Re-Backfill Order (Dependency Closure)

Run in isolated, observable stages. Each stage writes a producer-run ledger entry and produces a report before next stage begins.

```text
1. features_pivot
2. features_structure
3. features_sweep
4. features_bias
5. features_direction_state
6. features_zone          (only if quality or lineage depends on repaired structure)
7. features_order_block   (only if audit proves clean after structure repair)
```

Operational requirements:

- Backfill `features_pivot` with full lookback and completed-candle boundary.
- Backfill structure with sufficient history for external-level retention and HTF context.
- Backfill sweep only after repaired pivot and structure rows pass validation.
- Backfill bias after structure and pivot rows reach the required data edge.
- Reconcile direction state after bias and HTF bias are complete.
- Do not use short-window `recompute-feature-recent.js` for derived features. Use full-context historical backfill or dedicated reconciliation tooling.
- Keep clean candle-only features and the July/June FVG research artifacts untouched.
- Promote repaired features only after temporal alignment, producer freshness, and PIT parity reports pass.

## 10. Live / PIT Parity Test Plan

**Sampling:** select 10 deterministic random dates in repaired period, at least 3 symbols and all repaired timeframes. Include event-heavy and quiet periods, session boundaries, gaps, and restart boundaries.

**Procedure:**

1. Compute live-style feature output using only candles available through each as-of timestamp.
2. Compute PIT output using the same source candle boundary and repaired dependency closure.
3. Compare persisted rows by deterministic event identity.
4. Compare `eventTs`, `availableAtTs`, feature values, lineage, and engine version.
5. Repeat one sample after process restart to test state reconstruction.
6. Repeat one sample with incremental chunks to test checkpoint/state convergence.

**Acceptance:**

- Timestamp shifts no greater than one bar only when explicitly explained by `availableAtTs` close semantics.
- No event presence/absence mismatch.
- No duplicate event identity.
- No row available before its availability timestamp.
- No future dependency in serialized lineage.
- Live and PIT counts, event types, and direction agree for every accepted sample.
- Manual inspection of 5 MSS and 5 CHoCH events per symbol confirms pivot confirmation, sweep/displacement prerequisites, and trend-transition semantics.

**Failure response:** quarantine affected feature version, stop promotion, preserve reports and input snapshots, identify earliest divergent dependency, repair upstream first, then rerun full dependency closure.

## Promotion Gates

A repaired feature is not production-eligible until all gates pass:

1. Type and unit tests pass.
2. Serializer/deserializer round-trip passes.
3. Causal truncation tests pass.
4. Duplicate and monotonic-availability audits pass.
5. DB migration and backfill reports pass.
6. Live/PIT parity passes on selected dates and symbols.
7. Producer freshness and temporal alignment pass.
8. Strategy compiler contract explicitly permits feature.
9. Shadow run shows no unexplained live divergence.
10. Human review approves promotion and rollback plan.

Until then, `features_pivot`, `features_structure`, `features_sweep`, `features_order_block`, `features_bias`, and `features_direction_state` remain quarantined for clean-contract strategies.
