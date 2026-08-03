# Structure Refactor Specification

Date: 2026-07-30
Status: design contract; implementation not started
Source audit: `docs/STRUCTURE_GAP_AUDIT.md`
Prototype: `apps/engine/src/features/causalPrototype.ts`
Production target: `apps/engine/src/features/structure.ts`

## Scope

Replace bifurcated structure detection with one causal, completion-aware state machine. Preserve contaminated DB and existing production output until tests, shadow comparison, schema work, and migration gates pass.

No DB migration, version bump, backfill, or trusted-read-path replacement occurs during algorithm work.

## Contract corrections

- Existing `StructureEvent.ts`, `availableAtTs`, and related fields remain `Date`; do not change them to strings.
- Prototype suppresses an opposite break without a same-candle valid sweep. It does not emit fallback CHoCH for that case. Production must match this locked behavior.
- `hasDisplacement()` is not currently part of the prototype contract. Do not add displacement gating to production until explicitly defined and tested. First parity target is prototype behavior.
- `detectCausalBreakEvents()` is not production authority. It must be removed or replaced only after a production-equivalent causal implementation passes parity tests.

## 1. Remove bifurcation

### Current gap

`useCausalStructure()` gates behavior through `USE_CAUSAL_STRUCTURE`. Legacy `detectBreakEvents()` remains default. `detectCausalBreakEvents()` is unused.

### Required change

- Route `structureFeature.compute()` through one causal implementation.
- Remove runtime environment gating after shadow parity is accepted.
- Remove legacy `detectBreakEvents()` only after its output has been captured for differential comparison.
- Remove `USE_CAUSAL_STRUCTURE`, `CAUSAL_STRUCTURE_SYMBOL`, and `CAUSAL_STRUCTURE_TF` runtime references from engine structure code.
- Keep any archived comparison fixture outside production reachability.

### Gate

Search returns no production references to `USE_CAUSAL_STRUCTURE` or `detectBreakEvents`.

## 2. Timestamp semantics

### Required invariant

Candle `ts` is bar-open time. Candle is usable only when:

`candle.ts + tfMs <= anchorTs`

For event caused by candle `c` and level `l`:

`availableAtTs = max(c.ts + tfMs, l.availableAt)`

where `l.availableAt` is pivot confirmation availability, not center time.

### Required change

- Filter incomplete candles before detection.
- Activate pivots only when `pivot.availableAt <= candle.ts + tfMs`.
- Set event timestamp to break candle open time.
- Preserve pivot confirmation separately.
- Never use pivot center timestamp as event availability.

### Tests

- `timestampContract.test.ts`
- causal availability tests
- anchor boundary tests

## 3. Stable active-level model

Add internal production representation equivalent to:

- `levelId`
- `kind`
- `price`
- `centerTs`
- `availableAt`
- `confirmationTs`
- `scale`

Use stable IDs that distinguish same timestamp and same-price pivots. Recommended ID:

`<pivot-ts>|<kind>|<price>|<ordered-index>`

Do not use only timestamp/kind/price when duplicate pivots can exist.

## 4. Scale classification and retention

Match prototype behavior:

- New extreme versus prior confirmed same-kind pivots: `external`.
- Contained same-kind pivot: `internal`.
- External levels are not bounded by internal retention.
- Internal levels use FIFO retention cap `MAX_ACTIVE_LEVELS_PER_KIND = 10`.
- Newer stronger external level supersedes older external level of same kind, as prototype currently does.
- Retired levels must not be reactivated; record in broken/retired identity set if required by implementation.

### Tests

Run prototype invariants against production adapter or shared pure helpers:

- external classification
- internal classification
- external retention
- internal FIFO eviction
- stronger external supersession

## 5. Per-candle sweep and MSS

Sweep context exists only inside one candle iteration:

- High wick above level and close back at/below level: bearish sweep.
- Low wick below level and close back at/above level: bullish sweep.
- Sweep alone emits no event.
- Prior-candle sweeps cannot authorize later MSS.

For reversal break direction `d`, select swept level deterministically:

1. Sweep direction equals `d` under current prototype convention.
2. Sweep kind opposes break direction: bearish break selects high; bullish break selects low.
3. Active-level insertion order wins.
4. Stable level ID resolves any remaining tie.

MSS event includes:

- `sweptLevelId`
- `sweptLevelPrice`
- `sweptLevelKind`

These fields are present only for MSS.

## 6. Opposite-break behavior

Current locked prototype rule:

- Same-direction break: emit BOS.
- Opposite-direction break with matching same-candle sweep: emit MSS.
- Opposite-direction break without matching sweep: consume level and emit no event.

Do not introduce fallback CHoCH during first production parity implementation. CHoCH behavior requires separate approved semantics and tests.

## 7. Duplicate suppression

Use two protections:

- `brokenLevels`: level cannot be consumed twice.
- `emittedEvents`: identity prevents duplicate event emission.

Identity:

`symbol|tf|levelId|eventType|direction`

Same timestamp or same price must not collapse distinct level IDs.

## 8. Shared event contract

Extend `StructureEvent` without changing existing `Date` types:

```ts
sourceLevelId?: string;
sourceLevelKind?: "high" | "low";
sourceLevelConfirmationTs?: Date;
sweptLevelId?: string;
sweptLevelPrice?: number;
sweptLevelKind?: "high" | "low";
```

Existing `level` remains broken-level price for compatibility. `ts` remains break candle open time. `availableAtTs` remains causal availability.

Fields should become required only after all producers, persisted rows, fixtures, and consumers migrate. Initial additive rollout uses nullable/optional fields.

## 9. Serialization and persistence

Update structure serializer/deserializer for all new fields:

- `source_level_id`
- `source_level_kind`
- `source_level_confirmation_ts`
- `swept_level_id`
- `swept_level_price`
- `swept_level_kind`

Add round-trip tests. Schema migration comes only after algorithm and type tests pass. Migration must be additive and next-numbered from current repository state.

Update `hashOutput()` to include new causal fields. Otherwise output changes can be invisible to producer cache/hash logic.

## 10. Pivot boundary

Use one filtering rule in causal detection:

- Pivot must have confirmed availability.
- Pivot availability must be no later than the completion boundary of the candle being processed.
- No-anchor mode must not bypass causal filtering.

Do not silently reinterpret missing `confirmationTs`; decide whether missing confirmation is invalid or use center-time fallback, then lock that decision with tests. Prototype currently permits `availableAt` supplied by adapter fallback, so adapter behavior needs explicit review.

## 11. HTF enrichment

Keep HTF alignment as output enrichment only. It must not decide whether causal event exists.

Audit `features_htf_bias` separately against trust-boundary rules. If contaminated, quarantine `htfAligned` output or mark it untrusted. Do not allow contaminated HTF state to affect event generation.

## 12. Test and shadow sequence

1. Add pure helper tests for timestamp, scale, retention, sweep, MSS, identity, and serialization.
2. Build production adapter using test fixtures; do not alter trusted read path.
3. Run prototype and production outputs on identical deterministic fixtures.
4. Run historical shadow comparison against frozen DB/code state.
5. Classify every difference as expected causal correction, unresolved, or bug.
6. Run full engine tests and strict TypeScript build.
7. Add additive schema migration.
8. Version producer only after behavior and schema are final.
9. Shadow backfill/versioned output.
10. Replace trusted read path only after all gates pass.

## Verification gates before DB change

- `pnpm --filter @tm/engine test -- src/features/timestampContract.test.ts`
- `pnpm --filter @tm/engine test -- src/features/causalPrototype.test.ts`
- `pnpm --filter @tm/engine test -- src/features/structureParity.test.ts`
- production structure unit tests
- serialization round-trip tests
- `pnpm exec tsc --noEmit`
- deterministic replay comparison
- frozen old/new historical diff with all divergences classified

## Explicit non-goals

- No deletion or cleanup of contaminated DB rows.
- No migration before algorithm tests pass.
- No backfill before schema and producer version are finalized.
- No table rename.
- No trust-boundary relaxation.
- No production edit in this document step.
