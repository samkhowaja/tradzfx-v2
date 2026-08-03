# `features_sweep` Characterization

Status: Phase 0 audit. Read-only. No producer or schema changes.

## Current semantics

| Aspect | Current behavior | Evidence |
|---|---|---|
| Swing level activation | Pivot center `pivot.ts` | `apps/engine/src/features/sweep.ts`, `buildLevels()` maps `formedTs: p.ts` |
| Equal-level activation | Latest member center is used as `formedTs` | `buildEqualLevels()` reduces member `p.ts` |
| PDH/PDL activation | UTC day start of current day | `buildPdhPdl()` uses `startOfUtcDay(days[i])` |
| Sweep detection start | First candle with `c.ts >= lvl.formedTs` | `detectSweeps()` |
| Sweep candidate | Wick pierces level by at least `0.1 * ATR` | `detectSweeps()` |
| Close-back | Same candle or next candle; bounded by `CLOSE_BACK_BARS = 2` | `detectSweeps()` |
| Event emission | First valid close-back per level | `break` after emission |
| Event timestamp | Close-back candle `ts` | `SweepOutput.sweeps[].ts` |
| Availability timestamp | Not represented | `packages/shared/src/types/feature.ts`, `SweepOutput` |
| One-per-level | Yes, first close-back wins | `break` in level scan |
| Structure lookback | Events from prior 10 bars through close-back candle | `structureScore()` |
| Structure role | Score only; not emission gate | `detectSweeps()` |
| Lifecycle | `mitigatedAt` computed after emission | `sweepFeature.compute()` |

## Confirmed contamination

Swing and equal liquidity levels use pivot center time, not pivot confirmation time. A candidate candle between pivot center and pivot confirmation can therefore sweep a level unavailable at that candle.

Required causal rule for future fix:

```text
pivot confirmationTs <= candidate candle ts
```

PDH/PDL uses separate day-boundary semantics and must not inherit pivot confirmation gating.

## Downstream consumers

- `apps/engine/src/features/liquidityPools.ts` consumes `features_sweep`.
- `packages/strategies/src/featureRegistry.ts` registers it as event/candidate-set data.
- `packages/strategies/src/sqlBuilder.ts` generates sweep joins.
- `packages/strategies/src/progressive/featureRows.ts` and `shadowProducer.ts` consume serialized sweep rows.
- Registry validity currently uses `ts` as creation time and `mitigated_at` as invalidation time.
- Current registry required columns do not include `available_at_ts`.

## Existing fixture query

Run in a read-only transaction after connecting to project PostgreSQL:

```sql
SELECT symbol, tf, ts, direction, level, extreme, close,
       sweep_type, target_type, mitigated_at
FROM features_sweep
WHERE symbol = 'EURUSD'
  AND tf = '1h'
  AND ts BETWEEN '2026-07-01' AND '2026-07-15'
ORDER BY ts;
```

Fixture annotation:

> Existing rows may use unconfirmed pivot `ts` as level activation time. This is characterization data, not causal truth.

Fixture extraction was not performed in this workspace because `psql` is unavailable and the ad-hoc DB probe could not establish a connection through current shell quoting. No DB write occurred.

## Phase 0 boundary

## Isolated causal replay baseline

EURUSD 1h replay with swing levels only, 30-day warmup, and read-only DB access:

| Legacy | Causal | Matches | Legacy-only | Causal-only |
|---:|---:|---:|---:|---:|
| 6 | 2 | 1 | 5 | 1 |

The parity harness already consumes persisted `features_pivot` rows; it does
not reconstruct pivots from raw candles. The causal-only event is a confirmed swing low at `1.13641`, formed
`2026-07-24T13:00:00Z`, confirmed `2026-07-25T00:00:00Z`. Legacy emits the
same close-back move at level `1.13631`, from a different swing low formed
`2026-07-23T14:00:00Z`. Both levels qualify on the same extension and close-back
candles. This is a level-construction/classification divergence, not causal
activation failure. The three legacy-only PDL events remain expected because
PDH/PDL is excluded from this baseline.

Equal levels and PDH/PDL stay excluded from active parity until each is
validated independently.

No changes made to:

- `apps/engine/src/features/sweep.ts`
- `packages/shared/src/types/feature.ts`
- sweep migrations or registry contracts
- historical rows

Next phase: implement isolated causal sweep prototype and tests before touching production path.
