# Structure Gap Audit

Date: 2026-07-30

Scope: read-only comparison of `apps/engine/src/features/structure.ts` against the tested causal prototype in `apps/engine/src/features/causalPrototype.ts`. No production code changed.

## Summary

Production has two behavior paths. `useCausalStructure()` requires `USE_CAUSAL_STRUCTURE=true`, so legacy `detectBreakEvents()` remains default. `detectCausalBreakEvents()` exists but is not called by `detectStructure()`; the flag path calls `detectCausalStructureOutput()`, which delegates to the prototype. Therefore gaps below split into legacy-path gaps and the unused production-shaped causal adapter.

## Gap: Runtime reachability and default path

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | `detectCausal()` | `useCausalStructure()` ~164; `detectStructure()` ~410 |
| Behavior | One causal state machine is directly testable. | Default path uses `detectBreakEvents()`; causal path requires `USE_CAUSAL_STRUCTURE=true` plus optional symbol/timeframe filters. `detectCausalBreakEvents()` is dead code. |
| Impact | Production labels do not follow tested causal semantics by default. |
| Fix Required | Remove flag and route production through one audited causal implementation after parity gates. |
| Test Required | Runtime reachability test; existing causal prototype and parity tests. |

## Gap: Timestamp availability

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | event construction ~246 | causal adapter ~152; legacy raw events ~216, 227, 247, 280, 291, 311; unused causal path ~398 |
| Behavior | `availableAt = max(candle.ts + tfMs, pivot.availableAt)`. Only completed candles process. | Adapter preserves prototype availability. Legacy paths use `max(candle.ts, confirmationTs)` and omit `tfMs`. Legacy MSS uses pivot center timestamp rather than a break candle. Unused `detectCausalBreakEvents()` also omits `+tfMs`. |
| Impact | Future/incomplete information can be treated as available too early. Legacy MSS timing is retrospective and not comparable. |
| Fix Required | Use explicit bar completion semantics in production causal path; preserve pivot confirmation as separate source timestamp. |
| Test Required | `timestampContract.test.ts`; causal availability tests. |

## Gap: Active-level scale classification

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | `classifyPivotScale()` ~119 | unused causal path ~363 |
| Behavior | Classifies pivots as external/internal from prior confirmed pivots. | `detectCausalBreakEvents()` stores raw pivots in `Map`; no scale classification. Legacy path tracks only `lastHigh` and `lastLow`. |
| Impact | Internal liquidity can generate structure events; external structure retention semantics are absent. |
| Fix Required | Carry scale into active levels and classify using confirmed causal pivots. |
| Test Required | Prototype scale and internal-break tests. |

## Gap: Retention and FIFO eviction

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | `MAX_ACTIVE_LEVELS_PER_KIND`, activation loop ~168 | unused causal path ~369-401 |
| Behavior | External levels persist; internal levels capped at 10 and evicted FIFO. Stronger newer external levels supersede older external levels of same kind. | No internal/external retention policy. Active map can grow without bounded internal eviction. Legacy path collapses history to one high and one low. |
| Impact | Memory growth and inconsistent break candidates; historical levels may be consumed incorrectly. |
| Fix Required | Implement explicit scale-aware retention. |
| Test Required | Prototype retention and scale tests. |

## Gap: MSS attribution and event semantics

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | local `candleSweeps` and `selectSweptLevelForMSS()`; event fields ~230 | legacy MSS ~233-313; unused causal path ~390-400 |
| Behavior | Reversal break becomes MSS only with same-candle opposing sweep. Sweep selection is deterministic and exposes `sweptLevelId`, `sweptLevel`, `sweptKind`. | Legacy MSS searches retrospectively between prior level and pivot, uses wick-only predicates, and assigns pivot as event timestamp. Unused causal path emits only BOS/CHoCH and has no sweep context. |
| Impact | MSS can be attributed to wrong candle/level and can use future information. Causal event trace cannot explain swept liquidity. |
| Fix Required | Use per-candle sweep context and deterministic attribution. Add swept fields to shared `StructureEvent` and persistence. |
| Test Required | Multiple-sweep, prior-candle isolation, MSS field tests. |

## Gap: Opposite-break handling

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | reversal branch ~215 | legacy `detectBreakEvents()` ~200-313; unused causal path ~390 |
| Behavior | Opposite break without same-candle sweep consumes level without emitting an event. | Legacy emits CHoCH when trend reverses and break conditions pass; unused causal path emits CHoCH directly. |
| Impact | Production emits reversal labels prototype explicitly suppresses. |
| Fix Required | Lock desired causal policy, then replace legacy behavior only after diff review. |
| Test Required | Prototype opposite-break suppression test; production differential test. |

## Gap: Duplicate suppression identity

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | `brokenLevels` and `emittedEvents` | unused causal path ~370; legacy local `lastChoChTs`/`lastMssTs` |
| Behavior | Level IDs remain broken permanently; event identity includes symbol, timeframe, level ID, type, direction. | Unused causal path has broken IDs but no emitted-event identity set. Legacy uses timestamps only and has no stable level identity. |
| Impact | Replays and same-timestamp levels can produce inconsistent duplicates. |
| Fix Required | Use stable level IDs and event identity suppression. |
| Test Required | Duplicate suppression and same timestamp/price tests. |

## Gap: Event contract and persistence

| | Prototype | Production/shared types |
|---|---|---|
| File | `causalPrototype.ts` | `packages/shared/src/types/feature.ts`, `structure.ts` |
| Line | `CausalEvent` ~30 | `StructureEvent` ~181; serialize ~510 |
| Behavior | Includes source level identity/kind/confirmation and MSS swept-level identity/kind/price. | `StructureEvent` exposes only `level`, timestamps, and `opposingSweepTs`; serialize/deserialize omit source and swept level fields. |
| Impact | Cannot audit exact causal source or preserve MSS attribution in DB. |
| Fix Required | Add additive nullable fields to shared type, serializer, deserializer, schema migration, and producer version after algorithm finalization. |
| Test Required | Serialization round-trip and schema contract tests. |

## Gap: Pivot availability filtering

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | filter by `availableAt <= anchor`; activation allows availability by candle completion | legacy `detectStructure()` ~432; unused causal path ~379 |
| Behavior | Pivots activate only after availability and are processed against completed candles. | Legacy anchor filter requires `confirmationTs`, but no-anchor calls admit all pivots. Unused causal path requires pivot availability before candle timestamp, not candle completion boundary. |
| Impact | Boundary behavior differs by execution mode and can admit center timestamps prematurely. |
| Fix Required | Centralize pivot availability contract and test anchor/no-anchor behavior. |
| Test Required | Pivot activation and timestamp contract tests. |

## Gap: Production output fields

| | Prototype | Production |
|---|---|---|
| File | `causalPrototype.ts` | `structure.ts` |
| Line | explicit `sourceScale`, source timestamps, MSS trace | `detectCausalStructureOutput()` ~143-159 |
| Behavior | Prototype retains causal source metadata. | Adapter maps only event type, direction, level, timestamp, availability, enrichment, and lifecycle. Source/sweep metadata is discarded. |
| Impact | Even when flag path runs prototype, output loses audit fields before persistence. |
| Fix Required | Map causal metadata into `StructureEvent`; then persist it. |
| Test Required | Adapter mapping and serialize round-trip tests. |

## Explicit non-gaps / constraints

- `detectCausalStructureOutput()` already filters incomplete candles before enrichment.
- Causal prototype availability already uses `candle.ts + tfMs`.
- No production edit, schema migration, version bump, or backfill performed in this audit.
- `structure.ts` currently declares `features_htf_bias` dependency and enrichment uses it; causal prototype itself does not use HTF bias to decide event existence.

## Refactor specification inputs

1. Make causal implementation single-source and reachable only after approved parity gate.
2. Preserve bar-open timestamp contract and completion-time availability.
3. Add scale-aware retention and stable level identity.
4. Add same-candle deterministic MSS sweep attribution.
5. Extend shared event contract and persistence additively.
6. Add differential, serialization, boundary, and replay tests before migration/backfill.
