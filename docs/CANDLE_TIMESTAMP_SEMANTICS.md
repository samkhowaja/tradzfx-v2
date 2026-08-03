# Candle Timestamp Semantics

**Status:** Initial code-audited contract  
**Date:** 2026-07-27  
**Scope:** canonical candles, engine feature execution, PIT/live anchor boundaries

## Canonical rule

Canonical candle `ts` represents **bar start / bucket start**, not bar close.

A candle with timestamp `T` and timeframe duration `D` covers:

```text
[T, T + D)
```

The candle becomes complete and usable at knowledge time:

```text
completedAt(T, D) = T + D
```

A feature computation anchored at `endTs` may use candle `c` only when:

```text
c.ts + timeframeDuration <= endTs
```

## Evidence

### MT5 import

`scripts/backfill-candles-from-mt5-csv.js` parses broker date/time, applies configured timezone offset, and stores resulting UTC timestamp. MT5 bar timestamps are treated as source bar timestamps; importer does not add bar duration.

### Canonical HTF aggregation

`infra/migrations/129_canonical_htf_projections.sql` uses `time_bucket()` and source filter:

```sql
ts >= bucket_start AND ts < bucket_end
```

The projected row timestamp is the bucket start. `first(o, ts)` and `last(c, ts)` aggregate source bars inside that bucket.

### Recent candle fetch

`packages/shared/src/candles/candleSource.ts` fetches rows with:

```sql
WHERE ts <= endTs
```

The same file documents `endTs` as a bar OPEN / bucket start and extends rollup upper bounds to the end of the final bucket. This proves storage timestamps are starts, but also exposes a boundary risk: raw fetch can include an incomplete edge candle when `endTs` is knowledge time.

### Engine runner

`apps/engine/src/dag/runner.ts` passes `endTs` to `getRecentCandles()`. The runner currently receives rows through `endTs`; feature-specific code is responsible for completion filtering in some paths.

### Existing completion-aware code

`apps/engine/src/features/sessionRangeV2.ts` filters completed candles with:

```ts
c.ts.getTime() + tfMs <= endTs.getTime()
```

This is the canonical completion rule and should be shared by all feature paths.

### Live trigger

`apps/web/src/lib/pipelineTrigger.ts` obtains the latest 1m canonical `ts` as data-clock edge and passes it as engine/evaluation anchor. Since 1m `ts` is bar start, this edge is not automatically proof that the latest 1m bar has closed. Live must either use the latest completed 1m bar knowledge time or explicitly define the data edge as a completed-bar boundary.

### PIT

PIT code uses candle timestamps as historical anchors and queries rows with `ts <= anchor` in multiple paths. Because timestamps are bar starts, PIT must distinguish:

- state at bar start;
- state after bar close;
- state available at `ts + timeframeDuration`.

This distinction requires focused tests before producer refactors.

## Examples

| Timeframe | Candle `ts` | Covered interval | Complete at |
|---|---|---|---|
| 1m | 10:00:00 | 10:00:00–10:01:00 | 10:01:00 |
| 5m | 10:00:00 | 10:00:00–10:05:00 | 10:05:00 |
| 15m | 10:00:00 | 10:00:00–10:15:00 | 10:15:00 |
| 1h | 10:00:00 | 10:00:00–11:00:00 | 11:00:00 |
| 4h | 08:00:00 | 08:00:00–12:00:00 | 12:00:00 |
| 1d | 00:00:00 | 00:00:00–24:00:00 | next 00:00:00 |

For a pivot centered at candle index `i` with lookback `L`:

```text
pivot.ts = candles[i].ts
pivot confirmation candle = candles[i + L]
pivot availableAt = candles[i + L].ts + timeframeDuration
```

Use actual candle rows. Never add fixed elapsed time across missing bars to find the confirmation candle.

## Current contract conflict

The codebase mixes two interpretations:

1. `getRecentCandles()` and several SQL paths include `ts <= endTs`.
2. `sessionRangeV2.ts` requires `candle.ts + duration <= endTs`.

Until unified, an engine anchor can include an incomplete edge candle in some features but not others. This can create live/PIT divergence and future-pivot contamination.

## Required tests before producer edits

- Fetch at `endTs = 10:05` for 5m excludes candle `10:05` and includes candle `10:00` only if knowledge time is after its close.
- Pivot confirmation uses actual confirmation candle row plus duration.
- Structure cannot consume pivot before `availableAt`.
- Live and PIT apply identical completed-candle boundary.
- Weekend and missing-bar gaps use candle index, not duration arithmetic.

## Open verification items

- Confirm MT5 source timestamp meaning from broker export documentation/sample bars.
- Confirm live ingestion data-clock policy: latest row timestamp versus latest completed row.
- Trace every engine candle fetch and PIT query for incomplete-edge handling.
- Decide whether `endTs` universally means knowledge time. Recommended: yes.
