# Normalized Volatility Shadow Feature Design

**Status:** Proposed, shadow-only  
**Date:** 2026-07-19  
**Target:** `features_volatility_normalized` v1.0.0  
**Invariant:** No schema, producer, consumer, or behavior change to `features_atr`.

## 1. Purpose

Create one PIT-safe volatility state surface comparable across symbols, prices, timeframes, and sessions. Keep existing ATR values and `market_volatility_profile` percentile gate authoritative during shadow period.

Questions this feature must answer at anchor `ts`:

1. How large is effective ATR in symbol-native pips?
2. How large is ATR relative to current price?
3. Where does current volatility rank against prior observations from same symbol/timeframe/session?
4. Is observation usable, warming up, sparse, or derived from winsorized ATR?

## 2. Non-goals

- No rewrite of `features_atr`.
- No replacement of `market_volatility_profile` during shadow phase.
- No strategy spec migration during shadow phase.
- No use of future rows, wall-clock windows, or globally fitted constants.
- No cross-symbol pooled percentile distribution.
- No mutation of historical ATR rows.

## 3. Source contract

### Dependencies

- `features_atr`, exact `(symbol, tf, ts)`, period 5 by default.
- Canonical candle at exact `(symbol, tf, ts)` for close and `tick_count` context.
- Session classification from deterministic UTC session utility, not latest `features_session` row.
- Pair pip size from `getRegistryPipSize(symbol)`.

### ATR value selection

Use:

1. `effective_value` when finite and positive.
2. Otherwise raw `value` when finite and positive.
3. Otherwise emit no row. Record rejection as `invalid_atr`; dense postflight must fail when invalid source occurs at current data edge.

Preserve both raw and effective inputs in shadow row. Never silently overwrite one with other.

## 4. PIT-safe calculations

For ATR period `p=5` at anchor `t`:

- `atr_raw = features_atr.value`
- `atr_effective = COALESCE(features_atr.effective_value, features_atr.value)`
- `atr_pips = atr_effective / pip_size`
- `atr_bps = 10000 * atr_effective / close_t`
- `atr_log = ln(atr_pips)` when `atr_pips > 0`

Rolling normalization uses only valid observations with `source_ts <= t`. Default window: previous 1,000 same-session observations, including current anchor. Minimum sample: 100.

Robust score:

- `median = median(atr_log_window)`
- `mad = median(abs(atr_log_i - median))`
- `robust_z = 0.67448975 * (atr_log - median) / mad`

When `mad = 0`, set `robust_z = 0` and `quality_reason='zero_mad'`.

Empirical percentile rank:

- `percentile_rank = count(atr_log_i <= atr_log) / sample_count`

Regime:

| Percentile | Regime |
|---:|---|
| `< 0.05` | `extreme_low` |
| `< 0.25` | `low` |
| `< 0.75` | `normal` |
| `< 0.95` | `high` |
| `>= 0.95` | `extreme_high` |

Percentile boundaries are descriptive shadow labels, not entry rules.

## 5. Table

Migration: next available migration number at implementation time.

```sql
CREATE TABLE features_volatility_normalized (
  symbol TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  tf TEXT NOT NULL,
  period INT NOT NULL,
  session TEXT NOT NULL,
  atr_raw DOUBLE PRECISION NOT NULL,
  atr_effective DOUBLE PRECISION NOT NULL,
  pip_size DOUBLE PRECISION NOT NULL,
  close_price DOUBLE PRECISION NOT NULL,
  atr_pips DOUBLE PRECISION NOT NULL,
  atr_bps DOUBLE PRECISION NOT NULL,
  percentile_rank DOUBLE PRECISION,
  robust_z DOUBLE PRECISION,
  regime TEXT,
  sample_count INT NOT NULL,
  sample_start TIMESTAMPTZ,
  source_atr_engine_ver TEXT,
  is_valid BOOLEAN NOT NULL,
  quality_reason TEXT,
  engine_ver TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  PRIMARY KEY (symbol, tf, period, session, ts),
  CHECK (period > 0),
  CHECK (pip_size > 0),
  CHECK (close_price > 0),
  CHECK (atr_raw > 0),
  CHECK (atr_effective > 0),
  CHECK (percentile_rank IS NULL OR percentile_rank BETWEEN 0 AND 1),
  CHECK (sample_count >= 0),
  CHECK (regime IS NULL OR regime IN
    ('extreme_low','low','normal','high','extreme_high'))
);

CREATE INDEX idx_features_volatility_normalized_lookup
  ON features_volatility_normalized(symbol, tf, period, session, ts DESC);
```

Do not add `created_at NOT NULL DEFAULT now()`. DAG persistence writes un-emitted columns as `NULL`; feature-table rule SK-63 applies.

## 6. Engine contract

### Definition

File: `apps/engine/src/features/volatilityNormalized.ts`

- Name: `features_volatility_normalized`
- Version: `1.0.0`
- Semantic type: `state`
- Output mode: `dense`
- Dependency: `features_atr`
- Default ATR period: 5
- Exact one row per `(symbol, tf, ts, period, session)` after warmup.

### Registration

Implementation must update:

- `apps/engine/src/index.ts`
- `apps/engine/src/worker/featureWorker.ts`
- `apps/engine/src/featureProfiles.ts`
- `apps/engine/src/dag/producerInvariant.ts`
- shared output types under `packages/shared/src`
- engine tests and producer-invariant tests

### Cache identity

Input hash must include:

- feature engine version through existing `buildCacheInputHash()` behavior;
- symbol, tf, anchor `ts` through runner key;
- ATR period, raw value, effective value, ATR engine version;
- close, pip size, session;
- ordered rolling distribution timestamps and effective ATR values.

Changing rolling window, minimum sample, session mapping, or regime boundaries requires engine version bump.

## 7. Registry contract

Add `features_volatility_normalized` to `packages/strategies/src/featureRegistry.ts`:

- `table: 'features_volatility_normalized'`
- `semanticType: 'state'`
- `joinPolicy: 'latest_as_of'`
- freshness: same state freshness map as ATR
- `equalityGroupByDefaults: ['period', 'session']`
- required columns: `symbol`, `ts`, `tf`, `period`, `session`, `atr_pips`, `atr_bps`, `percentile_rank`, `robust_z`, `regime`, `sample_count`, `is_valid`, `engine_ver`, `input_hash`
- allowed predicates: period/session/regime/validity/rank/robust score and normalized magnitudes
- recommended default lookback: one bar plus compiler closure padding

No active spec may reference feature before seed capability matrix reports `READY` for every required symbol/timeframe.

## 8. Historical backfill

Use canonical timeframe candles and normal DAG producer path. Do not derive rows from wall-clock snapshots.

Sequence:

1. Run migration.
2. Build packages.
3. Backfill only `features_volatility_normalized`, oldest to newest, with at least 1,100 source bars before persisted start.
4. Keep first 100 rows invalid as `warmup` or omit them consistently; chosen behavior must be tested and documented.
5. Verify producer ledger `source_max_ts` equals matching canonical timeframe edge.
6. Run capability matrix, temporal alignment, and PIT preflight.

Because feature depends on ATR, default recent leaf recompute is inappropriate. Add dedicated read-only-source backfill or use historical DAG backfill with dependency reads and a guard proving `features_atr` row counts/hashes unchanged.

## 9. Producer ledger

Each run writes `feature_producer_runs` with:

- `feature_table='features_volatility_normalized'`
- exact `symbol` and `tf`
- `producer_version='1.0.0'`
- source range from canonical timeframe candles
- inserted/rejected counts from actual DB result
- `quality_json` containing `rows_seen`, `rows_attempted`, `rows_deduped`, `rows_inserted`, `rows_rejected`, `warmup_rows`, `invalid_rows`, `winsorized_source_rows`

Rejected batch must record `status='error'`, `rows_inserted=0`, and actual rejection count.

## 10. Shadow comparison

Create read-only report comparing existing gate decision with normalized feature at identical anchors.

Required slices:

- symbol
- asset class
- timeframe
- session
- month/week
- direction-state regime
- ATR source quality
- sample-count band

Required metrics:

- row coverage and freshness
- percentile agreement against `market_volatility_profile`
- old/new gate pass matrix
- decision disagreement rate
- trade count, gross R, costs, net R, win rate, drawdown
- tail-loss rate and stop-distance distribution
- missing/invalid fallback count

No same-window threshold tuning. Freeze thresholds before OOS comparison.

## 11. Promotion gates

Feature remains shadow-only until all conditions pass:

1. 90-day coverage at least 99% of valid `features_atr` period-5 anchors for every active symbol/timeframe.
2. Zero future timestamps and zero joins with source timestamp after signal anchor.
3. Producer edge lag no more than one matching timeframe bucket.
4. Invalid plus warmup rows below 1% after initial warmup region.
5. Recompute determinism: identical row hashes across two clean runs.
6. Existing `features_atr` counts, values, effective values, hashes, and engine versions remain unchanged.
7. Percentile ordering monotonic and rank always in `[0,1]`.
8. Walk-forward/OOS economic report available; no promotion from in-sample improvement alone.
9. Decision disagreement manually explained for top loss and top opportunity cohorts.
10. Kill switch and fallback preserve current volatility gate behavior.

## 12. Promotion path

Phase 0 — design only.  
Phase 1 — table, producer, registry, tests; no consumers.  
Phase 2 — 90-day backfill and integrity audit.  
Phase 3 — gate shadow evaluation; current gate remains authoritative.  
Phase 4 — frozen walk-forward/OOS comparison.  
Phase 5 — optional one experimental variant uses normalized policy.  
Phase 6 — promote only after explicit review; retain old gate as kill switch.

## 13. Main risks

| Risk | Control |
|---|---|
| Future leakage in percentile | Ordered historical window with `ts <= anchor`; PIT tests with future-row injection |
| Session distribution contamination | Deterministic anchor session; partition distribution by session |
| Cross-asset scale mismatch | Pip and basis-point outputs; no pooled raw-price distribution |
| ATR mutation | Separate table and producer; before/after ATR hash audit |
| Cache collision | Versioned input hash includes distribution and ATR provenance |
| Sparse history | `sample_count`, warmup invalidity, fail-closed consumer behavior |
| Feature poisoning from bad candles | Use effective ATR, retain raw ATR and quality provenance |
| Circular dependency | New feature depends only on ATR plus candles/session utility; ATR never depends on new feature |
| Silent live activation | No gate fallback to new feature; explicit experimental config required |
