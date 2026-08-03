# Anti-Pattern Catalog

Known anti-patterns discovered during development. Each entry describes the
pattern, why it's harmful, and the canonical fix.

---

## A-1: `feature_table` PREPEND — `getFeatureTable()` double-prepends `features_`

**Symptom:** Queries fail with `relation "features_features_bias" does not exist`.

**Cause:** `getFeatureTable(cond.feature)` unconditionally prepends `features_`
even when the spec already uses the full table name (`features_bias`).

**Fix:** Early-return when `featureName.startsWith("features_")`.

**Found:** P2-C `check-temporal-alignment.js`.

---

## A-2: PG Numeric → JS String — gap calculations return `NaN`

**Symptom:** Temporal alignment gate reports `NaN` for gap stats.

**Cause:** PostgreSQL `EXTRACT(EPOCH ...)` returns `numeric` type. The pg driver
delivers it as a string. `Math.min/max` coerces to `NaN`. Common in feature
tables where gap computation uses dynamic interval arithmetic.

**Fix:** `Number()` cast + `isFinite()` filter before aggregation.

**Found:** P2-C gap analysis query.

---

## A-3: Registry Lookback Mismatch — stale features invisible to narrow windows

**Symptom:** 0-trade days because features (iFVG, structure, zones) don't exist
within the lookback window at signal time.

**Cause:** `buildLookbackInterval(cond)` uses feature contract's
`defaultLookbackBars` which may be too narrow for the actual inter-event gap.
The registry default (typically 96 bars) covers ~24h of `15m` data but not
intra-session or weekend gaps.

**Fix:** P3-C auto-extend: `buildLookbackInterval()` factors session gaps and
weekend breaks into the interval calculation.

**Found:** Multiple 0-trade-day investigations.

---

## A-4: Silent Lookback Fallback — condition uses registry default unknowingly

**Symptom:** `validateSpec()` prints a warning: "has no explicit lookbackBars
— using registry default X."

**Cause:** Conditions omit `lookbackBars`. The compiler silently uses the
registry default, which may be appropriate for most features but wrong for
sparse-event features (structure sweeps, overnight zones).

**Fix:** Always set `lookbackBars` explicitly. Run `pnpm db:seed:check` to
surface warnings.

---

## A-5: Session-Gap Blindness — Monday signals miss Friday structure

**Symptom:** Monday morning zero-setup days after a Friday structure break.

**Cause:** Condition lookback window shorter than the weekend gap (49h). The
last structure event before the weekend is invisible to Monday's compiler
LATERAL join.

**Fix:** `validateTemporalCoverage()` already warns. P3-C auto-extends the
lookback by session-gap padding.

---

## A-6: `engine_ver` Cache Miss — stale feature rows after engine bump

**Symptom:** Features return identical values after an engine version bump
even though the compute changed.

**Cause:** `feature_cache` was keyed by `(feature_name, input_hash)` with
`input_hash` excluding `engine_ver`. After upgrade, identical inputs hit the
cache and returned pre-upgrade output.

**Fix:** `input_hash := ${engine_ver}:${content}:${symbol}:${tf}:${ts}`.
The version in the key means a bump is an automatic cache miss.

**Found:** P0-A ATR v1.1.0 → v1.2.0 migration.

---

## A-7: `trustStoredLifecycle` Asymmetry — backtest leaks future state

**Symptom:** Backtest shows trades that couldn't have happened because
lifecycle state from the future was used.

**Cause:** Passing `trustStoredLifecycle: true` in backtest mode. The stored
`is_fresh`/`invalidated_at` is wall-clock time. In backtest, the compiler
must recompute lifecycle PIT-correctly.

**Fix:** Backtest uses `trustStoredLifecycle: false` (recompute). Live uses
`true` (fast path). Never "align" them.

**Found:** PIT backtest v2.

---

## A-8: Backfill-Derived Features via `recompute-feature-recent.js` — data corruption

**Symptom:** Stale or incorrect derived feature values after recompute.

**Cause:** `recompute-feature-recent.js` with `--skipCache` on a derived
feature (e.g. `features_direction_state`) recomputes the full dependency
closure with a short trailing window, starving HTF context.

**Fix:** Use `scripts/reconcile-direction-state.js` for direction state
(read-only w.r.t. upstream deps). For other derived features, backfill
upstream deps first via `backfill-historical-features.js`, then backfill
the derived feature.

---

## A-9: iFVG `invalidated_at < ts` Poison — stale iFVG rows freeze table

**Symptom:** `features_ifvg` stops advancing. Lifecycle cursor never moves.

**Cause:** Engine emitted iFVG rows with `ts = last candle` (anchor timestamp)
instead of `originating_zone_ts`. Already-invalidated FVGs had
`invalidated_at < ts` which violated the `ifvg_inv_after_ts` CHECK constraint,
silently rejecting all new rows.

**Fix:** Registry contract says `createdAt = "ts"`. Engine now sets
`ts = originating_zone_ts` (formation timestamp), matching lifecycle/CHECK
semantics.

**Found:** SK-61 (2026-07-10).

---

## A-10: Producer-Run "done" Masks Per-Row Rejections — silent failure

**Symptom:** `feature_producer_runs` shows `status=done` with 1000 rows
inserted, but the DB has 0 new rows (all silently rejected by constraints).

**Cause:** `DAGRunner.insertRows` catches per-row constraint violations and
logs them separately, but still records `status='done'` with
`rows_inserted = attempted`.

**Fix:** Use `computePersistOutcome()`: on throw → `status='error'`,
`rows_rejected=attempted`; on success → real `rowCount`, `rows_rejected =
attempted - inserted`.

**Found:** SK-62.

---

## A-11: Volatility Percentile Silent Coercion — p95 used when p98 intended

**Symptom:** Volatility gate applies p95 threshold even though the spec
says `0.98`.

**Cause:** `pctToColumn()` in `volatilityGate.ts` silently coerces unknown
percentiles to `p95` instead of throwing.

**Fix:** `pctToColumn()` now throws on unknown percentiles.
`createVolatilityGate()` validates all configured percentiles once at load.

---

## A-12: ORB Stale-Range Cross-Contamination — prior day's range matches

**Symptom:** ORB strategies enter on a stale opening range from a prior
session or day.

**Cause:** The `features_opening_range` join matches by `(symbol, tf)` only,
not by `(date, session, range_minutes)`. After the current session's range
expires, a stale range from yesterday can satisfy the predicate.

**Fix:** `session_scoped` join policy pins to the anchor's UTC date +
spec-declared session + tf-derived range length. Requires `ts <= anchor`.

**Found:** V4 BUG-11, fixed in P2-B/P2-C.

---

## A-13: Lookback Window Static — doesn't adapt to spec's session filter

**Symptom:** Spec filters `sessions: [LONDON, OVERLAP, NY]` (gaps overnight
and weekends), but lookback window is fixed at 96 bars. Events outside the
session window are never visible → 0-trade days after a weekend.

**Cause:** `buildLookbackInterval()` used only `lookbackBars * tfMinutes`.
It didn't inspect the spec's `filters.session` to widen the window.

**Fix (IMPLEMENTED — P3-C):** `buildLookbackInterval(cond, spec?)` now pads the
computed window by `sessionGapPaddingMinutes(spec)`:
- No `filters.sessions` → pad full weekend gap (2940 min, Fri 21:00→Sun 21:00 UTC).
- `sessions: ["NY"]` → pad NY-closed period (1140 min) + weekend (2940) = 4080 min.
- `sessions: ["ASIA"]` → pad ASIA-closed period (1020 min), no weekend span.
The padding is additive and conservative (never shrinks the window). Wired
through `buildJoinPolicyWhere` → `buildPitLateral` → `compiler.ts`
(`buildFvgSignalSelect`, setup/entry LATERALs). Unit-tested in
`packages/strategies/src/compiler.test.ts` (`sessionGapPaddingMinutes` /
`buildLookbackInterval padding` describe blocks).

**Gate-drift fix (follow-up):** `scripts/check-temporal-alignment.js` computed
raw `lookbackBars * tfMinutes` and would FALSE-FAIL any spec that only passes
because of P3-C padding. It now adds the same `sessionGapPaddingMinutes(spec)`
to `lookbackMinutes`, and reads `filters.sessions` (plural, matching real YAML
specs) with singular `filters.session` tolerated for parity. The
`StrategySpec.filters.sessions?: string[]` type was added to
`packages/shared/src/types/strategy.ts` (was missing; only `session` existed).

**Found:** Systematic gap-in-blindness across 15+ specs.

---

## A-14: FVG Noise Filter Missing — sub-1-pip gaps create zero-expectancy signals

**Symptom:** FVG strategies produce 0% win rate on FX pairs (EURUSD, GBPUSD,
AUDUSD, NZDUSD). 68-71% of 5m FX FVGs are ≤1 pip wide.

**Cause:** Producer uses ATR-relative filter (`ZONE_MIN_SIZE_ATR_PCT=0.2`
× ATR14). On low-volatility FX pairs, ATR14 p50=12 pips → 0.2×12=2.4 pips
→ only filters gaps <2.4 pips? No — the ATR filter is a percentage, so a
gap of ANY size passes as long as it's ≥0.2% of ATR14. 0.2% of 12 pips = 0.024
pips → effectively no width minimum. Any non-zero gap passes.

**Two-part fix:**
1. **`minFvgWidthPips`** (per-spec, compiler LATERAL WHERE clause): Pip-based
minimum width at signal time. `minFvgWidthPips: 2` kills all sub-1-pip noise.
Mandatory for `signalSource: fvg` (validator errors if unset).

2. **`requireFvgStructureBreak`** (engine-level, auto-added to all FVG specs):
Direction-matched `EXISTS(SELECT 1 FROM features_structure WHERE event_type IN
('bos','choch','mss') AND direction = f.direction AND ts BETWEEN f.ts - INTERVAL
'{tf_auto_lookback}' AND f.ts)`. Kills FVGs without a nearby structure break
— data confirms structure-nearby FVGs are 5.5× wider (EURUSD 1h: 24.6 pips vs
4.4 pips without). TF-adaptive lookback: 1m→2h, 5m→4h, 15m→8h, 1h→24h.

**Escape hatch:** `signalSourceConfig.requireFvgStructureBreak: false` for
consolidation breakouts (warns on seed).

**Impact:**
| Metric | Before | After |
|--------|--------|-------|
| FX 5m FVGs ≥1 pip | 68-71% | 0% (all filtered) |
| FX 5m FVGs ≥2 pips | 12-32% survive | Same (but all have structure context) |
| XAUUSD FVGs affected | ~10% | Minimal (already 90% ≥2 pips) |
| FVG strategy win rate | 0% | Needs re-backtest |

**Found:** 2026-07-24 FVG investigation — 10 pairs, 5 TFs, 170k+ FVG rows analyzed.
