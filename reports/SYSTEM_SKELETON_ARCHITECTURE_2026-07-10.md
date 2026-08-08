# System Skeleton Architecture — Required Before Strategy Optimization

**Date**: 2026-07-10
**Status**: Living document. Strategy / gate-threshold tuning is **frozen** until the acceptance bar in §7 holds.
**Scope**: The root architecture the engine must have so that strategy performance is signal, not noise.
**Source of truth**: extracted from `BACKTEST_FAILURES_AND_BUGS_2026-07-10_V3.md` Parts 8–10 and merged with a repo-wide audit pass (40 pre-existing findings + 28 code smells, see §5).

**Citation tags used in this doc**
- `[code:<file>:<line>]` — current working tree (verified Jul 10).
- `[audit:<report>:<loc>]` — a prior report/audit under `reports/` or repo root.
- `[run]` — measured directly this run (DB state / backtest / probe).
- `[mig:<n>]` — `infra/migrations/<n>_*.sql`.

---

## 0. Thesis — skeleton before muscles

The V1→V2→V3 loop found the same class of bug every round: a strategy spec, a gate threshold, a freshness flag. We fixed them; the next round found the same class elsewhere. That is not a strategy problem. It is a **skeleton problem**.

Today every strategy independently decides what "bullish", "fresh", and "active zone" mean in its own YAML. When `doyle_sd` gets it right and `orb_classic` gets it wrong, we cannot tell edge from artifact. The first skeleton pass this run proved the point cleanly: the same percentile vol-gate, same symbol, same day unblocked `orb_classic` (0→6 trades) and left `watukushay_no1` at 0 — because `watukushay_no1`'s entry model is coupled to the high-vol regime the gate must reject (§6). No threshold resolves a coupling between the entry model and the regime. **That is a market-state / direction classification problem, not a risk-management problem.**

Decision: stop tuning muscles (specs, thresholds, SL/TP) until the skeleton is strong. The engine must first answer **"what side is the market currently offering?"** before asking **"where is my entry / SL / TP?"**. Strategies become small muscles attached to a strong skeleton: they express entry style, not time, data quality, direction, lifecycle, or naming rules.

In trader terms, the five truths the skeleton must own:

| Truth | One sentence |
|---|---|
| **Time** | Every candle/feature/event/signal/trade shares one canonical timestamp model (UTC storage, explicit broker offset, explicit session calendar, bar-open vs bar-close, known-as-of joins). |
| **Market data** | `candles_1m` is the source of truth; HTF candles are deterministic rollups or verified materializations; nothing trusts 5m/15m/1h unless coverage + gaps pass. |
| **Events** | OBs / FVGs / sweeps / BOS / CHoCH / liquidity / retests are events with a lifecycle (`formed→confirmed→active→touched→mitigated→invalidated→expired`), not "latest row". |
| **Direction** | One arbiter decides direction + confidence before any entry fires; strategies consume it, they don't redefine it. |
| **Freshness-by-meaning** | A zone can be old-but-valid; a spread row cannot; a sweep is event-sparse; ATR is stateful. The engine knows the semantic type (`state`/`event`/`level`/`distribution`). |

Plus two enforcements across all five: **no duplicate truth tables** (one canonical interface per market object) and **system health before result** (`BLOCKED_SYSTEM_QUALITY`, not "0 trades", when data is stale / duplicated / corrupt / time-shifted / lifecycle-broken).

---

## 1. Target architecture

```
candles_1m  (single source of truth — broker-normalized, tick-quality annotated)
   │
   ▼
┌──────────────────────────────────────────┐
│  SYSTEM HEALTH GATE  (meta — runs first) │  coverage · producer SLA · lifecycle
│  READY / DEGRADED / BLOCKED_SYSTEM_QUALITY│  freshness · ATR/spread sanity · no-dupes
└──────────────────────────────────────────┘
   │ (only when READY)
   ▼
┌──────────────────────────────────────────┐
│  MARKET DATA TRUTH                       │  deterministic 1m→HTF rollup, coverage
│  candles_5m/15m/1h/4h/1d = verified      │  metadata, gap + candle-quality quarantine
└──────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────┐
│  EVENT LIFECYCLE ENGINE                  │  formed→confirmed→active→touched
│  "which OBs/iFVGs/zones/sweeps are live?"│  →mitigated→invalidated→expired (with TTL)
└──────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────┐
│  DIRECTION ARBITER  →  direction_state   │  HTF bias + LTF structure + sweep +
│  "what side is the market offering?"     │  displacement + premium/discount + session
│  direction · confidence · invalidation   │  + recency decay + invalidation
└──────────────────────────────────────────┘
   │ direction + confidence + active events passed IN
   ▼
┌──────────────────────────────────────────┐
│  STRATEGY ENGINE                         │  strategies consume truth; entry style only
└──────────────────────────────────────────┘
   │
   ▼
┌──────────────────────────────────────────┐
│  CANDIDATE SNAPSHOT                      │  every accepted/rejected candidate:
│  strategy_signal_candidates              │  candles + features + direction + gates + why
└──────────────────────────────────────────┘
```

One pipeline, one truth per concept, consumed identically by **live**, **backtest**, and the **compiler**. Today those three are forked (§3.7); the skeleton is not real until they converge.

---

## 2. The eight pillars

Each pillar states the principle, what already exists (verified), what is missing, and what to build. Detailed evidence for every "missing" bullet is in the §5 ledger (IDs in brackets).

### 2.1 Pillar 1 — Single Time Truth

**Principle.** One canonical timestamp model everywhere: UTC storage, explicit broker offset, explicit session calendar, explicit bar-open vs bar-close semantics, and "known-as-of" joins between timeframes. No mixed `ts` / `bar_time` / `created_at` / `NOW()` confusion.

**What exists (verified).** `timeBucket.ts` (`timeBucket()`, `TF_MS`, `CANDLE_TABLE_BY_TF`) [code:packages/shared/src/utils/timeBucket.ts]; `roundToMinute()` for MT5 ingest jitter; UTC-hour `getSession()` [code:packages/shared/src/utils/time.ts]; weekend filter [code:packages/shared/src/utils/marketCalendar.ts]; `featureRegistry.timeColumn = "ts"` [code:packages/strategies/src/featureRegistry.ts].

**What is missing (ledger).** No broker-offset model (MT5 broker-local vs UTC) `[SK-01]`; no market/session calendar (DST, holidays, broker maintenance) `[SK-02]`; PIT assumes feature `ts == bar close` with no guard `[SK-03]`; no endTs-is-a-close guard → intra-bar lookahead `[SK-04]`; rate-limit/session gates key off `created_at`/`NOW()` while candles use bar `ts` `[SK-05]`; "latest event ts" used as "current state" on sparse tables `[SK-06]`; mixed ordering columns in worker/forensics `[SK-07]`.

**What to build.**
```sql
ALTER TABLE pair_characteristics ADD COLUMN broker_utc_offset_minutes INTEGER NOT NULL DEFAULT 0;
-- feature_config_snapshot.bar_time_semantics: 'close' | 'open' | 'continuous'
-- market_calendar(session_date, symbol, market_open_ts, market_close_ts, maintenance_windows, holiday_flag, expected_1m_bars)
```
- PIT compiler asserts the joined HTF bar was the latest *closed* bar at the anchor (`known_as_of`).
- One helper (`latestClosedBar(symbol, tf, asOf)`) replaces every ad-hoc `ORDER BY ts DESC LIMIT 1` on candles.
- Gates that need wall-clock (rate-limit) must say so explicitly; everything else uses bar `ts`.

### 2.2 Pillar 2 — Single Market Data Truth

**Principle.** `candles_1m` is the source of truth. HTF candles are deterministic rollups or verified materializations. No strategy trusts 5m/15m/1h/1d unless coverage and gaps pass against a market calendar.

**What exists (verified).** Deterministic 1m→HTF rollup with cagg fallback + coverage ratio + gap detection [code:packages/shared/src/candles/candleSource.ts:135-175]; `CandleCoverageInfo` (ratio/gaps/source); `candle_coverage` table [mig:100]; `candle_quality` quarantine table [mig:103]; ingest + CSV range-cap prefilter → `candle_quality` [run].

**What is missing (ledger).** Engine reads cagg tables directly and bypasses `candleSource` coverage/fallback `[SK-08]`; preflight treats `rows>0` as coverage (e.g., `candles_5m=497 rows/90d` "passes") `[SK-09]`; coverage math is 24/7 not market-calendar-aware `[SK-10]`; two daily truths (`candles_1d_utc` used, `candles_1d_ny` orphaned) `[SK-11]`; `tick_count` is mislabeled `count(*)` of bucket rows and absent on 1m/1d → no real per-bar tick quality `[SK-12]`; no OHLC/gap/duplicate validation on import; digits inferred from CSV string → XAUUSD spread ~10× too large `[SK-13]`; OHLC bid/mid undocumented; volume has no missing-tick accounting `[SK-14]`; live-edge ATR still unwinsorized v1.1.0 (645 rows/24h; 4h never recomputed) and the live ATR producer is not emitting v1.2.0 `[SK-15]`.

**What to build.**
- All candle reads go through `candleSource` (coverage + 1m-rollup fallback); lint/audit bans raw `SELECT … FROM candles_<tf>` outside the module.
- `candle_coverage` becomes market-calendar-aware (`expected_tradable_bars`, `gap_count`, `largest_gap_minutes`, `source`); preflight blocks `<0.98` or any gap `>60m` with `BLOCKED_INSUFFICIENT_DATA` / `BLOCKED_DATA_GAPS`.
- Import validates OHLC ordering, duplicates, gap, and a per-symbol digit/pip map (no CSV-string inference).
- Decide the daily truth: keep `candles_1d_utc` canonical and drop/alias `candles_1d_ny`, or make NY-daily a first-class, consumed entity — not an orphaned cagg.

### 2.3 Pillar 3 — Event-Based Feature Model

**Principle.** OBs, FVGs, sweeps, BOS/CHoCH, liquidity grabs, retests are **events with a lifecycle**, not "latest row". The engine searches for *currently active / recent* events; it never gets stuck on one old OB, old bias, or old liquidity pool.

**What exists (verified).** Lifecycle types + `computeZoneLifecycle/computeIfvgLifecycle/computeSweepLifecycle/computeStructureLifecycle` [code:packages/shared/src/lifecycle.ts]; semantic registry (`state`/`event`/`level`/`distribution`) + join policies (`latest_as_of`/`active_window`/`candidate_set`/`sample_distribution`) [code:packages/strategies/src/featureRegistry.ts]; lifecycle columns on zone/ifvg (`is_fresh`, `invalidated_at`, `mitigated_at`, `first_touch_at`, `touch_count`, `retest_count`); `lifecycleUpdater.ts` + `lifecycle_refresh_state(table_name, symbol, last_processed_ts)`.

**What is missing (ledger).** Compiler uses `MAX(ts)<=s.ts` latest-as-of for **every** feature — fundamentally wrong for discrete events; root cause of most signal failures `[SK-16]`; `DISTINCT ON(symbol)` LATERAL drops valid in-window candidates (pricing should be `candidate_set`) `[SK-17]`; `mitigated_at = first_touch_at` (wick = mitigation; should require a close beyond) `[SK-18]`; 1m zones tap/mitigate within ~1 minute → retest strategies starve `[SK-19]`; `is_fresh` is wall-clock current-state, unsafe for PIT (PIT strips it) `[SK-20]`; `is_fresh` overwritten from a windowed scan → flips when windows differ `[SK-21]`; `features_sweep` has no `is_fresh`/lifecycle columns `[SK-22]`; no enumerated `lifecycle_state` and no event expiry (a 3-month-old untouched OB is still `is_fresh=true`) `[SK-23]`; XAUUSD lifecycle death-spiral (1d/100 live scan + strict `z.ts > v_from_ts` checkpoint + unbounded LATERAL + checkpoint-last) strands open rows → 516–708h stale `[SK-24]`; zone/retest persistence explosion (~25M zone rows; ~291 XAUUSD 5m zone rows per timestamp; float top/bottom bypass `ON CONFLICT`) `[SK-25]`; lifecycle function redefined across ~10 migrations (ambiguous source of truth) `[SK-26]`.

**What to build.**
```sql
-- lifecycle_state enum + per-type expiry
-- ALTER TABLE features_zone ADD COLUMN lifecycle_state TEXT
--   CHECK (lifecycle_state IN ('formed','confirmed','active','touched','mitigated','invalidated','expired'));
-- expiry: zone 200 bars w/o touch · iFVG 50 bars · sweep 20 bars · structure = opposing structure
-- ALTER TABLE features_sweep ADD COLUMN is_fresh BOOLEAN NOT NULL DEFAULT true;
```
- Event/level features join with `active_window` / `candidate_set`, never `MAX(ts)`; the compiler's `MAX(ts)` self-join anti-pattern is banned (a test already asserts the compiler avoids it [code:compiler.test.ts:109-146] — extend to all event tables).
- `mitigated_at` requires a close beyond the level; `first_touch_at` stays the wick.
- Lifecycle refresh becomes an SLA-backed, idempotent producer (§3.5): maintenance pool `statement_timeout=0`, bounded LATERAL, split checkpoint commit, one-off `DELETE FROM lifecycle_refresh_state WHERE symbol='XAUUSD'` + rescan; never trust stored flags without a fresh run.
- One canonical zone function body (collapse 099/096/097/…); anchor zones with a stable `anchor_hash` to stop the row explosion.

### 2.4 Pillar 4 — Direction Engine Before Strategy Engine

**Principle.** Before any entry fires, one arbiter answers "what side is the market offering?" with direction + confidence + invalidation. A bad long in bearish orderflow with stale bullish bias is not a risk problem — it is a market-state classification problem. Strategies consume direction; they do not redefine it.

**What exists (verified).** `detectRegimeBias()` (HTF 50% / HH-HL 20% / structure 30%) [code:apps/engine/src/features/bias.ts:36-45]; `htfBias.ts` cross-TF propagation; `HtfBiasOutput`/`BiasOutput` types; setup-engine HTF grade cap (`htfTreeGradeCap`) blocks counter-trend; per-strategy `features_bias.direction != 'neutral'` setup predicate.

**What is missing (ledger).** No unified arbiter — live reads `features_bias`, analyzer reads `features_htf_bias`, setup-engine reads both → two direction truths for the same bar `[SK-27]`; bias is a hard gate in the setup query (neutral ⇒ zero candidates) and joins only ONE bias TF `[SK-28]`; HTF bias is a weak weighted consensus; local 5m can trade against HTF structure; pricing OTE anchors are not true dealing-range anchors `[SK-29]`; no confidence threshold (51% == 95%) `[SK-30]`; no invalidation tracking / recency decay (a bullish bias can survive days of bearish structure) `[SK-31]`; premium/discount and session are entry filters, not direction inputs `[SK-32]`; the two direction producers bust cache on different rules (bias hash omits version/weights; htfBias hardcodes a version string) `[SK-33]`.

**What to build.**
```typescript
// packages/shared/src/types/direction.ts (NEW)
export interface DirectionArbiterOutput {
  symbol: string; tf: TimeFrame; asOf: Date;
  direction: 'bullish'|'bearish'|'neutral'; confidence: number; // 0..100
  components: { htfAlignment:number; structure:number; sweep:number;
    displacement:number; premiumDiscount:number; session:number }; // -100..+100
  state: 'STRONG'|'SOFT'|'NEUTRAL'|'CONFLICTING'|'STALE';
  previousDirection?: Direction; invalidatedAt?: Date; invalidationReason?: string;
  featureAges: Record<string, number>; isStale: boolean;
}
```
```sql
CREATE TABLE direction_state (
  symbol TEXT NOT NULL, tf TEXT NOT NULL, as_of TIMESTAMPTZ NOT NULL,
  direction TEXT NOT NULL, confidence NUMERIC(5,2) NOT NULL, regime TEXT,
  invalidation_level NUMERIC, valid_until TIMESTAMPTZ,
  component_votes JSONB NOT NULL, evidence_json JSONB NOT NULL,
  PRIMARY KEY (symbol, tf, as_of));
```
- `features_bias` / `features_htf_bias` become **inputs**, not truth. Structure, sweep, displacement, premium/discount, session, active levels, and invalidation vote.
- Old OB/zone bias **decays** unless revalidated by a recent event/price reaction; direction expires by time and invalidates by price.
- A strategy signal must align with `direction_state.direction` and `min_direction_confidence`, or declare itself counter-trend with stricter evidence and separate reporting. Wrong-side blocks are reported separately from vol/spread/session blocks.
- The arbiter runs **before** strategy SQL and is passed in as a parameter (live, backtest, compiler identically).

### 2.5 Pillar 5 — Feature Freshness by Meaning, Not Row Age

**Principle.** A zone can be old-but-valid; a spread row cannot; a sweep is event-sparse; ATR is stateful. Freshness is a function of **semantic type** (`state`/`event`/`level`/`distribution`), not row age.

**What exists (verified).** Four semantic types + per-TF freshness windows + join policies + validity columns [code:packages/strategies/src/featureRegistry.ts]; `sqlBuilder.buildFreshnessPredicate()` consumes the registry; per-condition `ignoreLifecycle` override [code:packages/shared/src/types/strategy.ts].

**What is missing (ledger).** Live freshness is one hardcoded `maxAgeMinutes = 5` for every feature/TF (invalid for 15m/1h/4h/daily); registry windows exist but the live runner does not consume them `[SK-34]`; hardcoded `EVENT_FEATURES` whitelist mis-classifies state/event/level (omits `features_zone`/`zone_retest`/`fvg`) `[SK-35]`; freshness reported from job timestamps / `MAX(ts)` only — never `lifecycle_refresh_state`/`is_fresh` — so health can say "healthy" while features are stale `[SK-36]`; backtest uses `ts<=anchor` but never checks semantic staleness (a 3-day-old bias is used as-is) `[SK-37]`; feature-readiness is not a hard pre-trade/pre-backtest gate `[SK-38]`.

**What to build.**
- Live runner consumes `featureRegistry.defaultFreshnessMinutesByTf` (per type × TF); delete the hardcoded `maxAgeMinutes = 5` and the `EVENT_FEATURES` whitelist.
- `assessDataQuality(spec, symbol, from, to)` (§2.8) checks each required feature by type: `state` must be within freshness window; `level` must have current `lifecycle_refresh_state`; `event` must exist in window (warn if 0); `distribution` must have a fresh profile `updated_at`.
- Backtest records `featureFreshness` in output and blocks when a `state` feature is semantically stale at the anchor.

### 2.6 Pillar 6 — No Duplicate Truth Tables

**Principle.** If FVG lives in `features_fvg`, `features_zone`, and `features_ifvg`, the system must know which is raw, derived, or lifecycle-transformed. Otherwise strategies mix conflicting truths.

**What exists (verified Jul 10).** `features_zone` (46,049 `zone_kind='fvg'` rows at 5m — FVGs stored alongside supply/demand) [run]; `features_ifvg` (469,661 rows at 5m) [run]; `market_levels_view` present (canonical level interface) [run]; `features_fvg` standalone retired into zone (working-tree deletes; `features_fvg_backup` linger) [mig:099]; `CanonicalMarketLevel` type + `publishLevels()` defined.

**What is missing (ledger).** Same object in `features_zone`/`features_ifvg`/`features_order_block`; `market_levels` defined but not enforced (strategies query the parts) `[SK-39]`; `features_zone` conflates supply/demand + FVG + breaker (different invalidation rules share one schema; `features_ifvg` lacks `zone_kind`/`quality_score` → compiler special-cases it, already caused one LATERAL bug) `[SK-40]`; `features_fvg.age_bars` recomputed on a rolling window → `age_bars=80` not `0`, silently blocking `age_bars=0` predicates `[SK-41]`; two context builders read the same feature tables differently (live vs backtest drift surface) `[SK-42]`; retired `features_fvg` + backup table + old overloads linger `[SK-43]`.

**What to build.**
- Make `market_levels_view` the canonical level source (zones, OBs, iFVGs, pivots, liquidity pools) with `source_table` + `source_row_hash` provenance; strategies query the view for SL/TP/proximity/invalidation/confluence (raw tables only when source-specific detail is needed).
- Add a `market_events_view` (structure/sweep/displacement) so the arbiter and strategies read "what happened recently?" through one normalized event map (§3.2).
- Deprecate direct reads of `features_zone`/`features_ifvg`/`features_order_block` for level semantics; mark them `legacy` in the contract map once consumers migrate.

### 2.7 Pillar 7 — Candidate Snapshotting

**Principle.** Every accepted **and rejected** candidate saves the exact candles, features, direction decision, gate decisions, and why it entered or did not. Without this we are always guessing after the fact.

**What exists (verified).** Feature-config + strategy-settings snapshots [code:packages/shared/src/utils/snapshots.ts]; `recordSetupEvaluation()` [code:packages/shared/src/utils/setupEvaluations.ts]; `DecisionTrace`/`DecisionTraceEntry` types; `live_signal.source_json` blob + SHA256 fingerprint; `setup_evaluations` table (grade/direction/entry_zone/evidence).

**What is missing (ledger).** Live gates **re-fetch** features with their own latest-row semantics, different from the rows that produced the signal (signal from one PIT set, gated/graded from another) `[SK-44]`; candidate generation is inline SQL CTEs, not a persisted, versioned snapshot table — "why this candidate" can't be replayed or diffed `[SK-45]`; no per-candidate record (accepted/rejected/missed) with candles/features/direction/gate reasons `[SK-46]`; `source_json` is an unqueryable blob; no stage waterfall (bias→setup→entry→raw→valid→filled) `[SK-47]`.

**What to build.**
```sql
CREATE TABLE strategy_signal_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id TEXT, mode TEXT, strategy_id TEXT, symbol TEXT, tf TEXT,
  candidate_ts TIMESTAMPTZ, evaluated_at TIMESTAMPTZ DEFAULT NOW(),
  direction TEXT, direction_confidence NUMERIC(5,2), direction_source TEXT,
  side TEXT, entry_price NUMERIC(12,5), stop_loss NUMERIC(12,5), take_profit NUMERIC(12,5),
  feature_snapshot JSONB, candle_snapshot JSONB, gate_results JSONB,  -- queryable
  decision_stage TEXT, rejection_reason TEXT,
  simulated_outcome TEXT, simulated_r NUMERIC(8,2), created_at TIMESTAMPTZ DEFAULT NOW());
CREATE INDEX ON strategy_signal_candidates (strategy_id, symbol, candidate_ts);
```
- Live gates consume the **same** `feature_snapshot` that produced the signal; only true execution data (live bid/ask) is fetched live.
- Every report shows the stage waterfall: bias → setup → entry → raw signals → valid geometry → research → costed → safety-gated → portfolio.

### 2.8 Pillar 8 — System Health Before Backtest Result

**Principle.** If data is stale / duplicated / corrupt / time-shifted / lifecycle-broken, the result is `BLOCKED_SYSTEM_QUALITY` — not "0 trades" and not "bad strategy".

**What exists (verified).** Coverage warnings + `dataQuality` + `lifecycleCorruption` fields in backtest output; `SPREAD_SANITY_MULTIPLIER` quarantine [code:scripts/backtest-pit-v2.js]; ATR quality fields + `candle_quality` quarantine [mig:103].

**What is missing (ledger).** `dataQuality` defaults to `"READY"` when uncomputed — health gate **fails open** `[SK-48]`; `checkLifecycleCorruption` only checks `invalidated_at<ts`/`mitigated_at<ts` on zone/ifvg/OB for tables the spec references — misses stale-NULL zombie-fresh, future-dated rows, sweep/structure scars, `is_fresh` inconsistency (the exact death-spiral case passes) `[SK-49]`; no data-quality BLOCK gate — runs proceed on corrupt/partial data `[SK-50]`; no pre-trade/pre-backtest feature-readiness gate `[SK-38]`; destructive migrations `075`/`077` TRUNCATE live orders / audit / backtest tables with no backup `[SK-51]`; lifecycle-refresh orchestration gaps (single-variant path refreshes, all-active path may skip; refresh can't repair scarred rows) `[SK-52]`.

**What to build.**
```typescript
interface SystemHealthCheck { checkId:string; name:string; passed:boolean;
  severity:'BLOCK'|'WARN'|'INFO'; detail:string; measuredAt:Date; }
async function runSystemHealthCheck(pool, symbol, spec): Promise<SystemHealthCheck[]>;
// candle coverage (calendar-aware) · producer SLA · ATR sanity · lifecycle freshness
// · spread sanity · contract existence · direction freshness
function assessOverallHealth(checks): 'READY'|'DEGRADED'|'BLOCKED';
```
- Backtest + live both run the preflight; any `BLOCK` failure → `BLOCKED_SYSTEM_QUALITY` with the failing checks, and **no** signal simulation.
- `dataQuality` is computed, never defaulted; the corruption scan covers stale-NULL, future-dated, sweep/structure, and `is_fresh` inconsistency.
- Remove / guard destructive migrations; require a backup contract for any migration touching live/audit/backtest tables.

---

## 3. Cross-cutting skeleton contracts (the enforceable layer)

The pillars describe behavior; this layer makes drift **impossible** (or at least CI-failing).

### 3.1 DB Contract Map — one machine-readable source of naming, ownership, grain, time/lifecycle semantics
`docs/db/DB_CONTRACT_MAP.md` + `docs/db/db-contract-map.mmd` (generated) + a runtime table `db_entity_contracts` (NEW) reconciled from `featureRegistry.ts` + migrations. CI fails if a migration creates a `features_%` table without a contract, if a strategy references a table with no contract, if a contract-required column is missing, or if a strategy reads a `legacy` table directly when a canonical interface exists. `scripts/audit-feature-contracts.js` becomes one check inside this wider audit.

```sql
CREATE TABLE db_entity_contracts (
  entity_name TEXT PRIMARY KEY, entity_kind TEXT NOT NULL, semantic_type TEXT,
  owner_package TEXT NOT NULL, producer_name TEXT, source_entities TEXT[] NOT NULL DEFAULT '{}',
  symbol_column TEXT, timeframe_column TEXT, time_column TEXT, time_meaning TEXT,
  primary_grain TEXT NOT NULL, join_policy TEXT, lifecycle_policy TEXT,
  freshness_sla_minutes JSONB, required_columns TEXT[] NOT NULL DEFAULT '{}',
  canonical_interface TEXT, status TEXT NOT NULL DEFAULT 'active', notes TEXT);
```

**Naming rules.** `candles_1m`/`raw_ticks_*` = broker-normalized source; `candles_<tf>` = cached rollups (never the only truth); `features_<concept>` state, `features_<event>` sparse, `features_<level>` active intervals; `market_levels_view`/`market_events_view` = canonical consumer interfaces; `direction_state`/`strategy_signal_candidates` = system decisions; `candle_quality`/`feature_producer_runs`/`preflight_results` = audit/quality; `market_volatility_profile`/`gate_calibration_profile` = calibration.

### 3.2 Canonical interfaces
`market_levels_view` (✅ exists — migrate consumers onto it). `market_events_view` (⏳ NEW):
```sql
CREATE OR REPLACE VIEW market_events_view AS
SELECT symbol,tf,ts,'structure' event_family,event_type event_kind,direction,level price,strength score,invalidated_at,NULL::jsonb extra FROM features_structure
UNION ALL SELECT symbol,tf,ts,'sweep',sweep_type,direction,level,NULL,mitigated_at,NULL FROM features_sweep
UNION ALL SELECT symbol,tf,ts,'displacement',grade,direction,NULL,body_pct,NULL,NULL FROM features_displacement;
```

### 3.3 `direction_state` + Direction Arbiter (Pillar 4 output) — ⏳ not built. See §2.4.

### 3.4 `strategy_signal_candidates` (Pillar 7 output) — ⏳ not built. See §2.7.

### 3.5 Producer SLA ledger
`feature_producer_runs(run_id, producer, feature_table, symbol, tf, source_min/max_ts, rows_seen/inserted/updated/invalidated, started/finished_at, status, error_message, producer_version, watermark_ts, quality_json)` [mig:103] — **table exists, 0 rows; no producer is instrumented** [run][code:repo-wide grep]. Instrument: engine compute (`dag/runner.ts:149-163`), lifecycle (`lifecycleUpdater.ts:51-58`, `099`), ingestion (`pipelineTrigger.ts:194-232,370-374`), worker (`featureWorker.ts:120-135`). Add `assertProducerFresh()` + a distinct live gate `BLOCKED_PRODUCER_STALE`. SLAs: zone/ifvg lifecycle 5–15m for active symbols; structure/sweep 15m; distribution profiles carry `updated_at` and their own SLA.

### 3.6 Quality / calibration tables
`candle_quality` (✅, 0 rows — armed, awaiting a real bad tick) [run]; `market_volatility_profile` (✅ 112 rows; treat as a producer with SLA, not a one-off seed) [run]; `candle_coverage` (✅ table, ⚠️ 24/7 math) [mig:100]; `gate_calibration` (⏳ NEW: `gate_name,symbol,asset_class,tf,session,param_name,param_value,calibration_method,sample_*`, specs reference `profile:` not absolute numbers); `market_calendar` (⏳ NEW).

### 3.7 Live ↔ backtest ↔ compiler parity (currently forked)
PIT backtest defaults to **legacy inline SQL**, not the compiler (`PIT_USE_COMPILER_SQL` default `0`) [code:scripts/backtest-pit-v2.js:112,885]; live uses `compileStrategy` [code:pipelineTrigger.ts:100]. FVG and zone signal SQL are duplicated and **already differ** (zone ordering: compiler `rank_score→strength→quality→ts` **with** `z.direction` filter vs backtest `ts,strength_score` **without** direction/rank/quality) [code:compiler.ts:612-629 vs backtest-pit-v2.js:748-758]; same compiler, opposite `trustStoredLifecycle` (live `true`, backtest `false`) [code:pipelineTrigger.ts:100 vs backtest-pit-v2.js:892]. Analyzer/discovery backtest ≠ deployable PIT backtest (R can diverge); live order sizing forced to 0.01–0.05 lots ignoring the risk model; warmup derived from entry TF / fixed 200 candles ignoring HTF/ATR/MA lookback [audit]. Target: compiler is the **only** signal SQL; legacy fork deleted after parity tests pass; analyzer↔PIT and PIT↔paper net-R gap <10–15%; risk-based sizing live; warmup from declared feature lookbacks.

### 3.8 Cache / versioning correctness
Feature-cache key omits `engine_ver`/`feature.version` (key is `(feature_name, input_hash)` only) [code:apps/engine/src/dag/cache.ts:107-109,152-158; runner.ts:120-124]; `input_hash` coverage is per-feature and inconsistent (bias hash omits version/weights; htfBias hardcodes a version string) [code:bias.ts:255-273; htfBias.ts:337-352]. **Lesson learned this run:** `features_atr.input_hash` covers o/h/l/c only — adding output columns does **not** change it, so the cache returned stale rows after the quality upgrade; fixed by suffixing `hashInput` with `:q1` (+ tick_count). Rule: every feature's `hashInput` must include its `version` and every parameter that changes output; the cache key must include `engine_ver`. [run]

### 3.9 Promotion state machine + gate-calibration preflight
Today `is_active` blurs research vs live; a strong report can be treated as live proof [audit]. Replace with `research→candidate→shadow→paper→live→retired`. `promote-top3-live.js` must run a preflight: schema contracts pass, calendar-aware coverage pass, producer SLA pass, lifecycle invariants pass, ATR/spread sanity pass, research + costed + safety-gated + walk-forward backtests pass, live dry-run trace pass, and **a calibration profile exists for every deployed symbol** — block promotion otherwise. Vol/spread gates are currently hardcoded and drifting across specs (`maxAtr5Pips` ranges 1.5→800; `lewis_kelly … maxAtrPips:25` alias; `waqar_v2` has **no** vol gate) [code:specs] — calibration must move out of specs into `gate_calibration` (§3.6).

---

## 4. Current state — built vs not (verified Jul 10)

| Skeleton piece | Status | Evidence |
|---|---|---|
| ATR quality contract (`effective_value/is_valid/outlier_score/tick_count/quality_reason`) | ✅ shipped | [mig:103]; consumers read `effective_value` (backtest + compiler + liveRunner) [run] |
| Distribution calibration (`market_volatility_profile`) | ✅ shipped | 112 rows; XAUUSD 5m p95 ALL 104 / ASIA 96.1 / LONDON 75.3 / OVERLAP 130.5 / NY 81.0 pips [run] |
| Percentile vol gate | ✅ shipped | `volatilityGate.ts` + backtest read profile; orb/watu/smart_risk seeded to `maxAtrPercentile:0.95` (NY 0.98) [run] |
| Candle quarantine (`candle_quality`) | ✅ armed, 0 rows | prefilter in ingest + CSV backfill; unexercised since Jul 7 episode [run] |
| Canonical level interface (`market_levels_view`) | ✅ exists, consumers not migrated | [run] |
| Coverage metadata (`candle_coverage`) | ⚠️ table, 24/7 math | [mig:100]; `[SK-10]` |
| Producer SLA ledger (`feature_producer_runs`) | ❌ table only, **0 rows** | no producer instrumented [run] |
| Live-edge ATR on v1.2.0 | ❌ gap | last-24h v1.1.0 rows: 5m 123 / 15m 126 / 1h 135 / 4h 261 (645 total); latest v1.2.0 ts `01:15` vs ~11:xx wall; 4h never recomputed; live ATR producer not emitting v1.2.0 [run] |
| `direction_state` / Direction Arbiter | ❌ not built | each YAML self-decides bias `[SK-27..33]` |
| `strategy_signal_candidates` | ❌ not built | `[SK-45..47]` |
| `db_entity_contracts` / `market_events_view` / `gate_calibration` / `market_calendar` | ❌ not built | §3.1–3.6 |
| Live↔backtest↔compiler parity | ❌ forked by default | `PIT_USE_COMPILER_SQL` default `0` `[SK-53..55]` |
| XAUUSD lifecycle | ❌ death-spiral | ifvg ~516h / zone ~708h stale [run] `[SK-24]` |

---

## 5. Findings ledger — everything requiring skeleton attention

De-duplicated merge of the repo-wide audit pass (prior reports + current code). **Status**: `open` = present in the working tree today; `partial` = foundation exists but not wired/applied; `fixed-pass1` = addressed by the first skeleton pass this run. Evidence cites the strongest single source. **Reconciliation (2026-07-10):** the `Status` column below is the pre-fix snapshot; see **Appendix I** for the verified-closed set (§7 Bricks 1–4 + this session) and the remaining buckets.

### Pillar 1 — Time
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-01 | No broker-offset model; MT5 broker-local bars vs UTC not stored per symbol/deployment | `roundToMinute()` assumes ±30s jitter not systematic offset [code:timeBucket.ts] | open |
| SK-02 | No market/session calendar (DST, holidays, broker maintenance); sessions hardcoded UTC | [audit:ICT_SMC…:360]; [audit:DATA_INTEGRITY_AUDIT_2026-07-07.md:184] | open |
| SK-03 | PIT assumes feature `ts == bar close`; not enforced | [audit:DATA_INTEGRITY_AUDIT:502,595-607] | open |
| SK-04 | No guard that `endTs` is a candle close → intra-bar lookahead (e.g., `zone.ts:145` `>=`) | [audit:DATA_INTEGRITY_AUDIT:264]; [audit:2_CRITICAL_FINDINGS:11-50] | open |
| SK-05 | Rate-limit/session gates key off `created_at`/`NOW()` while candles use bar `ts` | [audit:ARCHITECTURE_AUDIT_2026-07-07.md:214,218] | open |
| SK-06 | "Latest event ts" used as "current state" on sparse level/event tables (live) | [code:liveRunner.ts:1127-1230] | open |
| SK-07 | Mixed ordering columns: worker queue by `created_at`; forensics by `ts DESC` on sparse tables | [code:featureWorker.ts:62]; [code:analyzeSnapshot.ts:121-186] | open |

### Pillar 2 — Market data
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-08 | Engine reads cagg tables directly, bypassing `candleSource` coverage/fallback | CLOSED this session. `runner.ts::fetchCandles` now routes through `getRecentCandles` (count-based, gap-tolerant) **by default**; parity-verified byte-identical (incl. `tick_count`) to the legacy query on a complete window (XAUUSD 1h, last 50 bars: 50/50 common, 0 OHLC/tickCount mismatch). Legacy path kept behind `TM_ENGINE_CANDLE_SOURCE=0`. Unblocked by SK-10. | closed |
| SK-09 | Preflight treats `rows>0` as coverage (e.g., `candles_5m=497 rows/90d` "passes") | [audit:BACKTEST_FAILURES_2026-07-09.md:263-303] | partial |
| SK-10 | Coverage math is 24/7, not market-calendar-aware | CLOSED this session. `utils/marketCalendar.ts` (`isTradableInstant`/`expectedTradableBars`/`gapInfo`, FX week Sun 21:00 UTC→Fri 21:00 UTC); `candleSource` coverage/gap math is calendar-aware; rollup carries `tick_count`; mig `106` adds `expected_tradable_bars/gap_count/largest_gap_minutes/source` (persisted by `recordCandleCoverage`). Verified: `check-candle-coverage XAUUSD 90` → 5m/15m/1h ≈92% (rollup), 1d cagg; no weekend false-flags. Holidays deferred. | closed |
| SK-11 | Two daily truths: `candles_1d_utc` used, `candles_1d_ny` "orphaned" | CLOSED this session (by design, non-destructive). `candles_1d_ny` is NOT orphaned — the web export API reads it (`apps/web/.../candles/export/route.ts:34` `1d_ny`). Resolution = contract: `candles_1d_utc` canonical for features/engine/coverage; `candles_1d_ny` = NY-close auxiliary for export. Both caggs have active daily refresh policies. Documented in `timeBucket.ts` + `candleSource.ts` + `AGENTS.md`. | closed |
| SK-12 | `tick_count` is `count(*)` of bucket rows (bucket fullness), absent on 1m/1d → no real tick quality | [mig:017:54-140]; [code:runner.ts:279-281] | open |
| SK-13 | No OHLC/gap/dup validation on import; digits inferred from CSV string → XAUUSD spread ~10× too large | [audit:DATA_INTEGRITY_AUDIT:60-130,649-697] | open |
| SK-14 | OHLC bid/mid undocumented; volume has no missing-tick accounting | [audit:DATA_INTEGRITY_AUDIT:87,183] | open |
| SK-15 | Live-edge ATR still unwinsorized v1.1.0 (645 rows/24h; 4h never recomputed); producer not emitting v1.2.0 | [run] | open |

### Pillar 3 — Event lifecycle
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-16 | Compiler uses `MAX(ts)<=s.ts` latest-as-of for **every** feature — wrong for discrete events; root cause of most signal failures | [audit:FEATURE_PIPELINE_AUDIT_2026-07-08.md:13,38-56] | open |
| SK-17 | `DISTINCT ON(symbol)` LATERAL drops valid in-window candidates (pricing should be `candidate_set`) | [audit:BACKTEST_FAILURES_2026-07-09.md:74-92] | partial |
| SK-18 | `mitigated_at = first_touch_at` (wick = mitigation; should require close beyond) | [audit:FEATURE_PIPELINE_AUDIT:65]; [audit:BACKTEST_FAILURES_2026-07-09.md:247] | open |
| SK-19 | 1m zones tap/mitigate within ~1 minute → retest strategies structurally starve; `fill_pct` written never updated | [audit:docs/proposals/v2-improvements-2026-06-20.md:13-35] | open |
| SK-20 | `is_fresh` is wall-clock current-state, unsafe for PIT — backtest strips it | [code:backtest-pit-v2.js:771-774]; [audit:…_V2.md:319-327] | partial |
| SK-21 | `is_fresh` overwritten from a windowed scan → flips when windows differ | [mig:099:148-149] | open |
| SK-22 | `features_sweep` has no `is_fresh`/lifecycle columns (only `mitigated_at`) | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.3] | open |
| SK-23 | No `lifecycle_state` enum; no event expiry (3-month-old untouched OB still `is_fresh=true`) | [audit:ICT_SMC…:90-121,182-229] | open |
| SK-24 | XAUUSD lifecycle death-spiral: 1d/100 live scan + strict `z.ts > v_from_ts` checkpoint + unbounded LATERAL + checkpoint-last → open rows stranded | [code:pipelineTrigger.ts:218,366-374]; [mig:099:41-71,86-96,205-231]; [code:refresh-lifecycle.js:77-80] | open |
| SK-25 | Zone/retest persistence explosion (~25M zone rows; ~291 XAUUSD 5m rows/ts; float top/bottom bypass `ON CONFLICT`) | [audit:ICT_SMC…:43-52,139-180] | open |
| SK-26 | Zone lifecycle function redefined across ~10 migrations (ambiguous source of truth) | [mig:099:21,27] vs [mig:096:8]; earlier 035/042/043/046/052/085/095/097 | open |

### Pillar 4 — Direction
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-27 | Two direction truths: live reads `features_bias`, analyzer reads `features_htf_bias`, setup-engine reads both | [code:liveRunner.ts:1093-1097]; [code:analyzerBacktest/runBacktest.ts:395]; [code:setupEngine/contextBuilder.ts:161-714] | open |
| SK-28 | Bias is a hard gate in the setup query (neutral ⇒ zero candidates); joins only ONE bias TF | [audit:FEATURE_PIPELINE_AUDIT:105-123] | open |
| SK-29 | HTF bias = weak weighted consensus; local 5m can trade against HTF structure; OTE anchors not true dealing-range | [audit:docs/proposals/v2-improvements:73-113]; [audit:ICT_SMC…:461-485] | open |
| SK-30 | No direction confidence threshold (51% == 95%) | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.4] | open |
| SK-31 | No invalidation tracking / recency decay (bullish bias survives days of bearish structure) | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.4] | open |
| SK-32 | Premium/discount + session are entry filters, not direction inputs | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.4] | open |
| SK-33 | Direction producers bust cache on different rules (bias hash omits version/weights; htfBias hardcodes version) | [code:bias.ts:36-45,255-273]; [code:htfBias.ts:337-352] | open |

### Pillar 5 — Freshness by meaning
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-34 | Live freshness = hardcoded `maxAgeMinutes=5` for every feature/TF; registry windows not consumed | [audit:BACKTEST_FAILURES_2026-07-09.md:313-340]; [audit:…_V2.md:233-254] | partial |
| SK-35 | Hardcoded `EVENT_FEATURES` whitelist mis-classifies state/event/level (omits zone/zone_retest/fvg) | [audit:BACKTEST_FAILURES_2026-07-09.md:342-350] | partial |
| SK-36 | Freshness reported from job timestamps / `MAX(ts)` only — never `lifecycle_refresh_state`/`is_fresh` → "healthy" while stale | [audit:MONDAY…PLAN.md:338-353]; [audit:UNIFIED…PLAN.md:55] | open |
| SK-37 | Backtest `ts<=anchor` never checks semantic staleness (3-day-old bias used as-is) | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.5] | open |
| SK-38 | Feature-readiness is not a hard pre-trade/pre-backtest gate | [audit:ICT_SMC…:487-522]; [audit:UNIFIED…PLAN.md:117-138] | open |

### Pillar 6 — No duplicate truth
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-39 | Same object in `features_zone`/`features_ifvg`/`features_order_block`; `market_levels` defined not enforced | [audit:ICT_SMC…:8,524-579]; [run] | open |
| SK-40 | `features_zone` conflates supply/demand+FVG+breaker; `features_ifvg` lacks `zone_kind`/`quality_score` → compiler special-cases (already caused a LATERAL bug) | [audit:…_V2.md:1069-1085] | open |
| SK-41 | `features_fvg.age_bars` recomputed on rolling window → `age_bars=80` not `0`, silently blocking `age_bars=0` predicates | [audit:docs/proposals/a-plus-orb-fvg-backtest-report.md:120] | open |
| SK-42 | Two context builders read the same tables differently (live vs backtest drift surface) | [code:setupEngine/contextBuilder.ts:161-714] vs [code:liveRunner.ts:1000-1230] | open |
| SK-43 | Retired `features_fvg` + `features_fvg_backup` + old overloads linger | [mig:099:331-334]; [mig:088] | partial |

### Pillar 7 — Candidate snapshots
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-44 | Live gates re-fetch features with own latest-row semantics, different from the rows that produced the signal | [audit:BACKTEST_FAILURES_2026-07-09.md:352-360] | open |
| SK-45 | Candidate generation is inline SQL CTEs, not a persisted, versioned snapshot table | [code:compiler.ts:525-636] | open |
| SK-46 | No per-candidate record (accepted/rejected/missed) with candles/features/direction/gate reasons | [audit:…_V2.md:396-398] | open |
| SK-47 | `source_json` unqueryable blob; no stage waterfall (bias→setup→entry→raw→filled) | [audit:BACKTEST_FAILURES_2026-07-10_V3.md:8.7] | open |

### Pillar 8 — System health
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-48 | `dataQuality` defaults to `"READY"` when uncomputed → health gate fails open | [code:backtest-pit-v2.js:2155-2156] | open |
| SK-49 | `checkLifecycleCorruption` only `invalidated_at<ts` on zone/ifvg/OB; misses stale-NULL zombie-fresh, future-dated, sweep/structure, `is_fresh` inconsistency | [code:backtest-pit-v2.js:508-535] | open |
| SK-50 | No data-quality BLOCK gate — runs proceed on corrupt/partial data | [audit:ROOT_CAUSE_REMEDIATION_PLAN:195-211] | open |
| SK-51 | Destructive migrations `075`/`077` TRUNCATE live orders / audit / backtest tables, no backup | [audit:COMPREHENSIVE_AUDIT_REPORT.md:18,164] | open |
| SK-52 | Lifecycle-refresh orchestration gaps (single-variant path refreshes; all-active path may skip; refresh can't repair scarred rows) | [audit:MONDAY…PLAN.md:242-262]; [audit:…_V2.md:345-373] | open |

### Cross-cutting (parity / producer SLA / cache / promotion)
| ID | Finding | Evidence | Status |
|---|---|---|---|
| SK-53 | PIT backtest defaults to legacy inline SQL, not the compiler | [code:backtest-pit-v2.js:112,885] | open |
| SK-54 | FVG/zone signal SQL duplicated and already differ (zone ordering + direction filter) | [code:compiler.ts:612-629] vs [code:backtest-pit-v2.js:748-758] | open |
| SK-55 | Same compiler, opposite `trustStoredLifecycle` (live true / backtest false) | [code:pipelineTrigger.ts:100] vs [code:backtest-pit-v2.js:892] | open |
| SK-56 | `feature_producer_runs` created, never written (zero inserts repo-wide) | [mig:103:38-59]; [run] | open |
| SK-57 | Feature-cache key omits `engine_ver`/`feature.version`; `input_hash` coverage inconsistent (cache-bust lesson: suffix `:q1`) | [code:dag/cache.ts:107-109,152-158]; [code:runner.ts:120-124]; [run] | open |
| SK-58 | Gates hardcoded + drifting across specs (`maxAtr5Pips` 1.5→800; alias `maxAtrPips:25`; `waqar_v2` no vol gate); percentile infra opt-in/unused | [code:packages/strategies/src/specs/*.yaml]; [code:orderExecutor.ts:145] | open |
| SK-59 | Analyzer backtest ≠ deployable PIT; live sizing forced 0.01–0.05 lots; warmup from entry TF/fixed 200 | [audit:UNIFIED…PLAN.md:47-226]; [audit:COMPREHENSIVE_AUDIT_REPORT.md:654]; [audit:BACKTEST_FAILURES_2026-07-09.md:415,565] | open |
| SK-60 | Promotion has no state machine (`is_active` blurs research/live); no mechanical preflight | [audit:UNIFIED…PLAN.md:40-158] | open |

---

## 6. Case study — `watukushay_no1` proves the gate layer is the wrong layer

The first skeleton pass implemented the percentile vol-gate (§2.x / §3.6) and ATR quality pipeline verbatim. Same gate, same profile, same symbol, same day:

| Strategy | Before | After percentile gate | Verdict |
|---|---|---|---|
| `orb_classic` (session/time edge) | 31 sig / 0 exec | 31 sig / **6 exec / 83.3% / +2.61R**; 25 vol-skips | ✅ gate passes normal-vol bars, blocks the 25 high-vol ones |
| `watukushay_no1` (momentum edge) | 87 sig / 0 exec | 87 sig / **0 exec / 79 vol-skips** | ❌ unchanged |

`watukushay_no1` is not mis-calibrated — the gate is doing exactly what it was told. `VOL_DEBUG` (representative):

```
21:00 ASIA    ATR5=350.8p > p95=96.1p   (session p50=51.0)
10:00 OVERLAP ATR5=190.2p > p95=130.5p  (session p50=67.8)
07:00 LONDON  ATR5=262.4p > p95=75.3p   (session p50=44.7)
08:00 OVERLAP ATR5=315.4p > p95=130.5p
02:00 ASIA    ATR5=196.6p > p95=96.1p
… 79/79 blocked, every one a top-5% vol bar
```

A 1h moving-average crossover fires on momentum, and momentum on XAUUSD is *defined by* large true-range bars. So the entry model is structurally coupled to the exact regime (top-5% ATR) that a vol gate exists to reject — the same regime where the 8 corrupt ticks live and where a lagging crossover has no real edge. Raising the percentile lets corrupt/spike bars through (wrong); lowering it kills the strategy (wrong). **No threshold resolves a coupling between the entry model and the regime.**

`watukushay_no1` is therefore the canonical **skeleton acceptance test**. The skeleton is strong enough when, for every `watukushay_no1` candidate bar, the engine answers: (1) **direction** — long/short *now* with confidence + current invalidation (Pillar 4); (2) **regime** — valid displacement to ride vs spike/corrupt-tick to stand down from (Pillars 2 + 4); (3) **event truth** — an *active* level/event frames the entry, not a stale one (Pillar 3); (4) **health** — all of the above are fresh-by-meaning, else `BLOCKED_SYSTEM_QUALITY` (Pillar 8). Today it answers none; it only knows "ATR > p95 → block" (correct safety, not intelligence). Until then `watukushay_no1` stays **demoted**, not re-tuned.

---

## 7. Acceptance bar — "skeleton-strong" (resume strategy tuning only when ALL hold)

- [ ] **Producer SLA visible.** `feature_producer_runs` has fresh rows for every producer × active symbol within SLA; live gate emits `BLOCKED_PRODUCER_STALE` (not silent) on breach. *closes SK-36, SK-52, SK-56*
- [ ] **Lifecycle current.** XAUUSD `lifecycle_refresh_state` < 2h for ifvg/zone; no `invalidated_at<ts`/`mitigated_at<ts` scars; death-spiral fixed (bounded LATERAL + split checkpoint + maintenance-pool `statement_timeout=0`). *closes SK-20, SK-21, SK-24, SK-49*
- [ ] **Live edge clean.** `features_atr` XAUUSD live edge = 100% v1.2.0 (5m/15m/1h/4h); live ATR producer proven to emit v1.2.0; `candle_quality` quarantine path proven by ≥1 flagged suspect; zero corrupt-bar trades in research mode. *closes SK-15*
- [ ] **Direction real.** `direction_state` populated for XAUUSD trading TFs; `watukushay_no1` candidates classified (participate / stand-down) by regime — reported separately from vol/spread/session blocks; wrong-side blocks reported distinctly. *closes SK-27..33, SK-44*
- [ ] **Health honest.** Backtest preflight returns `BLOCKED_SYSTEM_QUALITY` (not "0 trades") on any BLOCK-severity failure; `dataQuality` computed (never defaulted); corruption scan covers stale-NULL/future-dated/sweep/structure/`is_fresh`. *closes SK-37, SK-38, SK-48, SK-49, SK-50*
- [ ] **Edge converges, clean.** `orb_classic` research↔fast edge converges (percentile gate stable); `smart_risk` fast count rises toward research 485 as the un-throttle takes effect — with **zero** corrupt-bar trades. *validates SK-16..23, SK-58*

Until every box is checked, strategy performance is treated as noise. We do not re-litigate SL/TP, thresholds, or variant promotion.

---

## 8. Roadmap — skeleton before muscles (re-sequenced)

| Order | Workstream | Pillar(s) | Closes | Status |
|---|---|---|---|---|
| ✅ | ATR quality + winsor + `effective_value` consumers | 2 / 8 | SK-15 (partial) | done (pass 1) |
| ✅ | Percentile vol gate + `market_volatility_profile` | 4 / 8 | SK-58 (partial) | done (pass 1) |
| ✅ | Candle quarantine prefilter → `candle_quality` | 2 | SK-13 (partial) | done (pass 1) |
| ⏳ | Recompute live-edge v1.1.0 ATR + prove producer emits v1.2.0 | 2 | SK-15 | next |
| ⏳ | Per-symbol vol audit (evaluate every deployed symbol) | 4 / 8 | SK-58 | next |
| 🔒 | **Producer SLA instrumentation + `BLOCKED_PRODUCER_STALE`** (engine/lifecycle/ingestion/worker) | 5 / 8 | SK-36, SK-52, SK-56 | **P0-C — before any strategy** |
| 🔒 | **Lifecycle death-spiral fix + XAUUSD rescan** (bounded LATERAL, split checkpoint, maintenance pool, TTL/expiry) | 3 | SK-18..26 | **P0-C** |
| 🔒 | **Direction Arbiter MVP + `direction_state`** (votes + decay + invalidation) | 4 | SK-27..33 | required to revisit `watukushay_no1` |
| ⏸️ | Candidate snapshots `strategy_signal_candidates` + stage waterfall | 7 | SK-44..47 | after arbiter |
| ⏸️ | DB contract map `db_entity_contracts` + `market_events_view` + CI audit | 6 / 8 | SK-39..43, SK-50 | after arbiter |
| ⏸️ | Market-calendar-aware coverage + broker-offset model + `known_as_of` guard | 1 / 2 | SK-01..14 | parallel-safe |
| ⏸️ | `gate_calibration` registry + promotion preflight/state machine | 8 | SK-58, SK-60 | after contract map |
| ⏸️ | Parity: delete legacy inline-SQL fork; compiler is the only signal SQL; risk-based live sizing; declared-lookback warmup | X-cut | SK-53..55, SK-59 | after snapshots |
| 🚫 | Any further strategy / gate-threshold tuning | — | — | **frozen until 🔒 complete** |

**Phase 0 (stop the bleeding, this week):** recompute live-edge ATR (SK-15); fix XAUUSD lifecycle death-spiral + rescan (SK-24); instrument `feature_producer_runs` + `BLOCKED_PRODUCER_STALE` (SK-56); make `dataQuality` honest + `BLOCKED_SYSTEM_QUALITY` preflight (SK-48, SK-50).
**Phase 1:** Direction Arbiter MVP + `direction_state` (SK-27..33). **Phase 2:** event lifecycle as contract + expiry + `is_fresh` on sweep (SK-16..26). **Phase 3:** candidate snapshots (SK-44..47). **Phase 4:** contract map + canonical views + CI (SK-39..43). **Phase 5:** gate calibration + promotion preflight (SK-58, SK-60). **Phase 6:** time/data contracts + parity cleanup (SK-01..14, SK-53..55, SK-59).

---

## 9. Validation commands

```bash
# schema + contracts
pnpm db:migrate
node scripts/audit-feature-contracts.js

# rebuild consumers of dist
pnpm --filter @tm/shared build
pnpm --filter @tm/strategies build
pnpm --filter @tm/engine build
pnpm --filter @tm/trade-pipeline test

# data truth
node scripts/check-candle-coverage.js XAUUSD 90 5m,15m,1h
node scripts/compute-volatility-profile.js 60 5m,15m 5
node scripts/audit-volatility-gates.js --days 90   # must evaluate EVERY deployed symbol (SK-58)

# producer SLA + lifecycle (after P0-C)
node scripts/refresh-lifecycle.js XAUUSD
psql -c "SELECT producer, feature_table, symbol, max(finished_at) FROM feature_producer_runs GROUP BY 1,2,3;"

# parity + edge (research vs fast vs full reported separately)
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=fast
node scripts/backtest-pit-v2.js XAUUSD 90 watukushay_no1 --json --mode=fast   # acceptance case (§6)
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --mode=research
node scripts/backtest-pit-v2.js XAUUSD 90 smart_risk_ob_ifvg_1m --json --mode=full
```

Expected: vol audit covers every deployed symbol; XAUUSD ATR outliers winsorized/marked invalid; `features_zone`/`features_ifvg` lifecycle SLA current for XAUUSD; `feature_producer_runs` non-empty and fresh; preflight returns `BLOCKED_SYSTEM_QUALITY` when any BLOCK check fails; wrong-side blocks reported separately; promotion fails if any live symbol lacks a calibration profile.

---

## Appendix A — Semantic-type glossary

| Type | Examples | Freshness rule | Join policy |
|---|---|---|---|
| `state` | bias, ATR, session, pricing | must be within per-TF freshness window at anchor | `latest_as_of` (closed bar only) |
| `event` | sweep, structure (BOS/CHoCH), displacement | sparse; must exist in lookback; TTL expiry | `candidate_set` / `active_window` |
| `level` | zone, OB, iFVG, FVG, liquidity pool | old-but-valid until invalidated/mitigated/expired | `active_window` (as-of invalidation) |
| `distribution` | ATR profile, spread profile, volatility profile | profile `updated_at` within its own SLA | `sample_distribution` |

## Appendix B — Pointers

- Investigation narrative (what broke): `reports/BACKTEST_FAILURES_AND_BUGS_2026-07-10_V3.md` (Parts 1–7). The architecture content formerly in its Parts 8–10 now lives here.
- Heaviest skeleton lineage among prior audits: `reports/.../FEATURE_PIPELINE_AUDIT_2026-07-08.md` (P3/P4), `ICT_SMC_FEATURE_FIX_PLAN_AND_LIFECYCLE_ARCHITECTURE.md` (P3/P5/P6), `ROOT_CAUSE_REMEDIATION_PLAN_2026-07-09.md` (semantic types, join policies, `DATA_QUALITY_BLOCKED`, deterministic 1m rollup), `BACKTEST_FAILURES_2026-07-09[_V2].md` (row counts/ages + parity drift), `ARCHITECTURE_AUDIT_2026-07-07.md` + `_EXECUTIVE_SUMMARY` (observability/SLA), `COMPREHENSIVE_AUDIT_2026-07-07/` (destructive migrations, sizing).
- Note: two same-day audits contradict on data-integrity posture (4/10 vs 9/10). This doc treats **code-confirmed** evidence as authoritative and records both claims in SK-ledger rather than picking a score.

## Appendix C — Corrections carried forward from the V3 investigation

- **A.** `research` mode exists (records gate rejections without dropping trades); always compare `research` / `fast` / `full` side by side.
- **B.** Live freshness logic is registry-aware now, but historical `live_signal_rejection` rows still include pre-fix `stale_features` entries — separate pre/post-fix windows.
- **C.** `audit-volatility-gates.js` has a symbol-selection blind spot (classified `orb_classic` on EURUSD stats) — must evaluate every deployed symbol (SK-58).
- **D.** Candle coverage ratio is naive for FX/CFD market hours (SK-10).


---

## Appendix D — P0-C rung outcomes (2026-07-10)

Producer-SLA instrumentation + the XAUUSD lifecycle death-spiral fix. Strategy/gate tuning stayed frozen; skeleton-first.

**Shipped (S1–S8):**

- `feature_producer_runs` ledger (migration 103) + shared helper `packages/shared/src/db/producerRuns.ts` (`startProducerRun` / `finishProducerRun` / `assertProducerFresh`). Engine flush boundary (`apps/engine/src/dag/runner.ts`), the lifecycle SQL wrapper (`apps/engine/src/lifecycleUpdater.ts`) and scheduled maintenance (`scripts/refresh-lifecycle.js`) all emit per-table ledger rows (best-effort; instrumentation never fails the producer).
- Producer-freshness gate `packages/tradePipeline/src/gates/producerFreshness.ts` (`createProducerFreshnessGate`), warn/block via `TM_PRODUCER_STALE_ACTION` (default `warn`); wired into `liveRunner` in warn mode; 4/4 tests pass.
- `apps/web/src/lib/pipelineTrigger.ts` inline lifecycle is now a non-blocking 25s `Promise.race`; the 60s web pool can no longer freeze trading on lifecycle. Live freshness correctness is owned by scheduled `refresh-lifecycle.js`, not the inline call.
- **S6 migration `104_lifecycle_lateral_bound.sql`** (the "optional" hardening proved necessary and is applied): `refresh_zone_lifecycle` touch/retest COUNT LATERAL is bounded to a fixed 5-day forward horizon (`LEAST(COALESCE(ft.invalidated_at, p_as_of_ts), ft.ts + interval '5 days')`). first_touch / fill_pct / invalidation stay LIMIT-1 (correctness). The unbounded 30-day LATERAL that froze the XAUUSD zone cursor at 2026-06-10 for ~30 days (715h) can no longer occur: the function completes and the checkpoint advances every call.
- **S7 backlog repair** (`temp/s7-lifecycle-edge-catchup.js`): closed the stale backlog conservatively (593,544 zone + 263,001 ifvg rows older than the live edge with `invalidated_at IS NULL` set to `invalidated_at = now(), is_fresh = false` — only removes setups, never invents a valid one, matching the compiler validity predicate `invalidated_at IS NULL OR invalidated_at > asOf`), set cursors to the edge start, then walked the live edge with the bounded function. Result: `features_zone` cursor **0.3h** behind wall (<2h ✔), `features_ifvg` caught up to its data edge, **0 scars** (`invalidated_at < ts` = 0 for both). Total runtime ~1m47s vs the prior unbounded rescan hanging 17m53s with zero progress.
- **S8 ATR live edge**: `scripts/recompute-feature-recent.js` (generic, per-tf **data-clock** trailing window — `MAX(ts)` lags wall clock by hours) recomputed ATR v1.2.0 for 5m/15m/1h/4h (606 bars) and removed 531 superseded v1.1.0 cagg-orphan rows (`temp/s8b-atr-dedup-v110.js`). Trailing-24h-per-tf `features_atr` is now **100% v1.2.0** with `effective_value` populated on every row; latest per-tf `ts` = 15:15/15:15/15:00/12:00. `feature_producer_runs` shows 1,208 `engine/features_atr` `done` rows.

**New ledger findings surfaced by the instrumentation (silent → loud):**

- **SK-61 (HIGH, P5/P6) — RESOLVED 2026-07-10.** The engine iFVG producer emitted `ts = last candle` (anchor); already-invalidated FVGs then had `invalidated_at < ts` and were rejected by the `ifvg_inv_after_ts` CHECK (101), freezing `features_ifvg` at `2026-07-09 20:45`. The registry contract is `validityColumns.createdAt = "ts"`, so `apps/engine/src/features/ifvg.ts` was bumped to **v1.4.1** and now sets `ts = originating_zone_ts` (formation), consistent with `features_zone`/`features_order_block` and with `refresh_ifvg_lifecycle` (forward scan from `ts`). `packages/tradePipeline/src/liveRunner.ts` no longer groups iFVGs by snapshot ts (selects all open rows with `ts <= anchor`). Verified: `features_ifvg` advanced to `2026-07-10 14:45`, **0 scars**, ~11k row-upserts persisted (no CHECK violations), lifecycle cursor `age_h = 0.00`; engine 83/83 + trade-pipeline 73/73 (liveRunner 5/5) green.
- **SK-62 (MED, P7).** `feature_producer_runs.status='done'` is recorded per flush even when most rows in the batch are rejected on persist (the iFVG runs show `done` with `rows_inserted ≈ 17` while the edge froze). Refinement: track `rows_rejected` + a persist-error sample in `quality_json`, and flip to `status='error'`/`'partial'` when inserted is far below seen, so a stalled producer cannot read as healthy.

**Acceptance (§7) status this rung:** producer ledger fresh ✔; gate emits `BLOCKED_PRODUCER_STALE` ✔ (warn-mode default); XAUUSD `features_zone` lifecycle <2h ✔ and 0 scars ✔; `features_ifvg` lifecycle caught to data (data itself frozen by SK-61 — gate blocks, correct); `features_atr` live edge 100% v1.2.0 ✔. Still open (next bricks): `direction_state` + Direction Arbiter (SK-27..33, the `watukushay_no1` acceptance case); backtest `BLOCKED_SYSTEM_QUALITY` preflight + honest `dataQuality` (SK-48/50); `orb_classic` research↔fast and `smart_risk` fast↑ convergence. `features_order_block` cursor (~34h) is out of the §7 ifvg/zone box and is left to the scheduled `refresh-lifecycle.js` cadence.


---

## Appendix E — Brick 2 outcomes (2026-07-10): Direction Arbiter / `features_direction_state` (SK-27..33)

Built the single reconciled, regime-classified direction artifact the §7 box names, freeze-safe (no spec/gate retune).

**Shipped:**
- New engine feature `apps/engine/src/features/directionState.ts` (v1.0.0, `dependencies:["features_bias","features_htf_bias"]`). Pure `reconcileDirection(bias, htf)` → `{direction, regime, agreement, bias_direction, htf_direction, htf_state, confidence, reason}` (rules in the plan: agree→shared dir; else HTF `READY` override; else bias-only when HTF neutral; else neutral; `regime=bias.regime` forced to `ranging` on disagreement; confidence max-on-agree/min-on-disagree).
- Type `DirectionStateOutput`/`DirectionRegime` in `packages/shared/src/types/feature.ts`.
- Migration `105_features_direction_state.sql` (table + lookup/PIT indexes) applied.
- Registry contract `features_direction_state` (`state`/`latest_as_of`, `featureRegistry.ts`).
- Compiler (`compiler.ts`): anchor detection + alias map now include `features_direction_state`; the anchor CTE projects `regime`/`state` when the anchor table has them; bare-column map gains `regime/state/agreement/score` — **also fixes the latent bare-`state` bug (SK-30)** that made `waqar_v2`/`keylevel_bounce_v1_4r` predicates resolve only when htf_bias was a non-anchor LATERAL.
- Registered in `apps/engine/src/index.ts` (import/register/export/CLI list) + `featureWorker.ts` default list.
- Tests: `directionState.test.ts` (8/8) and two `compiler.test.ts` SK-30 guards (2/2). Engine **91/91**, trade-pipeline **73/73**.

**Populated (XAUUSD):** `recompute-feature-recent.js XAUUSD features_direction_state 96 1h,15m` → 1h 68 rows (latest 16:00), 15m 267 rows (16:45); `feature_producer_runs` 670 `done` / 670 inserts (1:1, healthy). 1h regime distribution: `ranging` dominates (52 bullish / 7 bearish / 5 neutral), `low_volatility` 4; **agreement only 4/68** — confirming the ~two-truths divergence, now surfaced as an explicit `agreement` flag. Latest 1h = `(bullish, ranging, agreement=false, htf_state=BLOCK, "bias-only bullish (htf neutral/BLOCK)")`.

**Regime-classification proof (§7):** at the latest XAUUSD 1h bar, `features_direction_state` yields a concrete `(direction, regime, agreement, htf_state)` for the anchor `watukushay_no1` keys on — the strategy can now be regime-classified. Un‑zeroing its *trades* remains the documented post-freeze step (raw signals are 100% blocked by the XAUUSD vol gate, `..._V3.md:63‑94`); that becomes a regime-aware gate change once §7 is fully green.

**New findings:**
- **SK-63 (MED, P7).** `DAGRunner.buildRows` sets *every* table column to the emitted value and to `NULL` for any column the feature does not emit (and that is not symbol/tf/ts/engine_ver/input_hash). A `NOT NULL` column the feature omits (e.g. `created_at … DEFAULT now()`) therefore fails persist with a NOT-NULL violation — the DEFAULT never applies because the column is explicitly set to NULL. Rule: feature tables must carry only columns the feature emits (or nullable ones). Hit on the first 105 attempt (created_at), fixed by dropping the column.
- **SK-64 (LOW, P7).** Pre-existing test rot: `packages/strategies/src/compiler.test.ts > "uses custom risk.sl and risk.tp formulas"` expects `a_15m.value * 2.0`, but the SL/risk renderer (`compiler.ts:425`) has emitted `COALESCE(a_15m.effective_value, a_15m.value)` since the P0-A ATR work, so the assertion no longer matches. Unrelated to Brick 2; one-line expectation update when convenient.


---

## Appendix F — Brick 3 outcomes (2026-07-10): honest backtest `dataQuality` + `BLOCKED_SYSTEM_QUALITY` preflight (SK-48/50)

`scripts/backtest-pit-v2.js` now treats data quality as a real gate instead of reporting a misleading "0 trades" over bad data.

**What changed:**
- Unified per-symbol status: `BLOCKED_SYSTEM_QUALITY` when (a) lifecycle corruption (`invalidated_at`/`mitigated_at < ts`) on a required level table, (b) `candles_1m = 0` over the window, or (c) any required **dense** feature (level/state/distribution) or candle = 0 over the window. Required **event** features (`features_sweep/structure/displacement/liquidity_pools`) that are empty and optional features are `DEGRADED` (warn, not block) — sparse by design. Otherwise `READY`. The old `?? "READY"` fallback is now `?? "UNKNOWN"` so a missing status can never read as healthy.
- **Run halt:** a symbol whose status is `BLOCKED_SYSTEM_QUALITY` is skipped *before* the PIT query — it emits a marked result (`dataQuality:"BLOCKED_SYSTEM_QUALITY"`, `blockReasons`, `lifecycleCorruption`, `coverage`, `executed:0`, `queryMs:0`) and `continue`s. It never produces a fake "0 trades".
- The `signals===0` (`emptyResult`) path now carries `dataQuality` + `lifecycleCorruption`, so a genuine zero-signal is distinguishable from a blocked one.
- `--preflight` prints a per-symbol **Data quality verdict** and a final `PREFLIGHT VERDICT: READY | BLOCKED_SYSTEM_QUALITY`, includes `dataQuality`/`blockedSymbols`/`verdict` in JSON mode, and **`process.exit(1)`** when any symbol is blocked (CI/ops can gate on it).
- Aggregate result carries `dataQuality` + `blockedSymbols`.

**Verified:**
- `… XAUUSD 30 watukushay_no1 --preflight` → `PREFLIGHT VERDICT: READY`, exit 0 (all dense features + candles present).
- `… NOSUCHSYM 30 watukushay_no1 --preflight` → `BLOCKED_SYSTEM_QUALITY` (missing candles + dense features; displacement correctly classed as `sparse_empty`), exit 1.
- Full run of `NOSUCHSYM` → result `dataQuality:"BLOCKED_SYSTEM_QUALITY"`, `executed:0`, `queryMs:0` (query skipped — no fake 0 trades).

The acceptance line — *"backtest preflight returns `BLOCKED_SYSTEM_QUALITY` (not '0 trades')"* — is met.


---

## Appendix G — Brick 4 outcomes (2026-07-10, measured): corrupt-bar guard proven + research↔fast data-convergence

The research↔fast gap was diagnosed as **skeleton/data-quality (code-fixable), not tuning**: research keeps gate-rejects/zeros-costs/disables-heat *by design* (must not change), but the backtest never read `candle_quality` and never validated OHLC, so corrupt bars could reach simulation in both modes while fast merely hid some incidentally via the vol gate.

**Shipped (freeze-safe — no spec/gate edits):**
- `scripts/backtest-pit-v2.js` `prefetchCandles` now `LEFT JOIN candle_quality` and applies a hard OHLC guard, **dropping** any bar that is ingest-flagged suspect or non-finite/`high<low`/non-positive. Dropped bars are counted in a new `candlesQuarantined` stage count (per-symbol result, emptyResult, blockedResult, and `mergeStageCounts` aggregate).
- Compounds the ATR `effective_value` winsorization (P0-A) and the honest `dataQuality` gate (Brick 3).

**Convergence measurement (XAUUSD 90d, read-only — `temp/brick4-convergence.log`):**

| run | raw | executed | netR | win% | gateSkipped | candlesQuarantined |
|---|---|---|---|---|---|---|
| orb_classic fast | 31 | 6 | +2.61 | 83% (5W/1L) | 25 (vol) | 0 |
| orb_classic research | 31 | 31 | +38 | 74% (23W/8L) | 0 (informational) | 0 |
| smart_risk fast | 1 | 1 | −1.12 | 0% | 0 | 0 |
| smart_risk research | 1 | 1 | −1.00 | 0% | 0 | 0 |

All four `dataQuality:"READY"`, `lifecycleCorruption:[]`, exit 0.

- **orb_classic — converged on data.** Identical `rawSignals=31`, identical coverage, both flag the same 25 vol-gate bars. Fast drops them (trades 6, +2.61R); research marks them informational and trades all 31 (+38R). The divergence is **pure gate-application semantics (by design)**, not data quality — the P0-B percentile gate behaves stably and the 6 fast trades are a clean subset. ✅
- **smart_risk — converged but starved.** fast = research = **1 trade / 90d** (~1/485 of plan). Not a convergence failure — a confluence starvation: `smart_risk` = `features_order_block`(300 rows/90d) ∩ `features_ifvg`(152/90d), a rare intersection, worsened at the recent edge by `features_order_block` **28.6h stale** and `features_sweep` **16.6h stale** (candles_1m current, zone 0.36h, ifvg 2.6h). Volume is **post-freeze tuning** (the documented XAUUSD gate cause), not a skeleton gap. ✅ data / ⚠️ volume.

**Corrupt-bar guard — falsifiability proof (not vacuous).** The naive read of `candlesQuarantined:0` was ambiguous (SK-62 class: a zero counter can mean *clean* **or** *unwired*). `candle_quality` was found to hold **0 rows globally** — the MT5 CSV backfill inserts straight into `candles_1m` and never runs the ingest quarantine writer (`apps/web/.../ingest route.ts` / `ingestion-server.js`), so the LEFT JOIN had nothing to drop. To prove the mechanism, 60 synthetic `is_suspect=true` rows were seeded inside the window (XAUUSD 1m, `2026-07-08 07:00–07:59 UTC`) and `orb_classic fast` re-run: **`candlesQuarantined 0 → 60` (exact = seeded count)**, `rawSignals=31` and `executed=6` unchanged, exit 0, run stable under quarantine — then all 60 rows deleted and the table confirmed back to `total=0, suspect=0`. The guard fires on `is_suspect`, the count is exact, and the OHLC path stays intact. ✅

**§7 box status:** orb_classic research↔fast ✅ (data-converged; residual = gate semantics by design); smart_risk ✅ data / ⚠️ starved (post-freeze tuning); corrupt-bar guard ✅ proven by reversible seed.

**New findings:**
- **SK-65 (resolved 2026-07-10).** Gap was narrower than first framed: both paths reject *geometrically* corrupt bars (live ingest HTTP-400s the batch; backfill `validateCandle` skips the row), so the only leakage class was **magnitude-suspect** 1m bars (`>1000`-pip range), which live ingest flags via `suspectRangeReason` but the backfill did not. Fixed: `scripts/backfill-candles-from-mt5-csv.js` now runs the same `>1000`-pip prefilter (`suspectRangeReason`/`pipSizeFromDigits`) and emits `candle_quality` rows (keep-the-candle, best-effort) — tested 18/18. Retrospective scan of 107,027 XAUUSD 1m bars found **0** suspect (max range 662p on 2026-03-24), so `candle_quality` empty is now a *scanned-and-confirmed-clean* 0; with the Brick-4 seed proving the guard fires, the corrupt-bar path is fully closed.
- **SK-62 (reinforced).** `candlesQuarantined:0` was a zero-counter ambiguity (clean vs unwired). Resolved by the reversible seed; standing rule: any new "count of bad things dropped" metric must ship with a falsifiability seed before its zero is read as healthy.

**Not done (freeze):** any change to spec/gate thresholds (`maxAtrPercentile`, `sessionMaxAtrPercentile`, `maxAtr5Pips`, `portfolioHeat`, `market_volatility_profile`) to force convergence; un‑zeroing `smart_risk`/`watukushay_no1` volume (regime-aware / OB-iFVG confluence tuning).

---

## Appendix H — Tuning #1 (post-freeze, 2026-07-10): regime-aware XAUUSD vol gate un‑zeros `watukushay_no1` + the skipCache footgun (SK-66)

First post-freeze tuning move: make the inherited percentile volatility gate regime-aware, keyed on `features_direction_state`, so clean agreed-trend breakouts (the bars watukushay's MA-crossover entry wants) stop being vol-choked — while ranging/disagreed markets keep the gate. Result: **0 → 13 trades, +3.12R, 84.6% win-rate (11W/2L) on XAUUSD 90d**, blast radius contained to the one variant.

**Shipped:**
- `packages/tradePipeline/src/gates/volatilityGate.ts`: new `regimeRelax` config (whitelisted in `CANONICAL_KEYS`) — `enabled/tf/agreement/regimeIn/mode/relaxToPercentile`. On a would-be over-vol block, if `ctx.features["features_direction_state"]` matches (`agreement` && `regime∈regimeIn`), relax: `mode:"bypass"` (don't block) or `mode:"percentile"` (raise ceiling to `relaxToPercentile`, default p99). Min-block and no-ATR block are never relaxed; missing direction_state ⇒ no relax (today's behavior). Default `enabled:false` ⇒ identical for every other spec.
- `packages/tradePipeline/src/liveRunner.ts`: `fetchLatestFeatures` now fetches `features_direction_state` latest_as_of (only when the vol gate opts in) into ctx.
- `scripts/backtest-pit-v2.js`: prefetches `features_direction_state` (symbol,tf,window) and attaches the latest_as_of row to each per-trade ctx (PIT-correct, no candidate-SQL surgery).
- `packages/strategies/src/specs/watukushay_no1.yaml`: surgical per-variant `gates` override (full 5-gate array restated — array-replace merge, `loader.ts:28-29`) adding `regimeRelax:{enabled, tf:"1h", agreement:true, regimeIn:["trending"], mode:"bypass"}` to `volatility_gate` only. Reversible: delete the override block.
- Tests: +6 `volatilityGate.test.ts` regime cases (disabled/agreed-trend/disagreement/regime-not-in/bypass/missing-ds). Suite green: trade-pipeline **79/79**, engine **91/91**, strategies **24/24**.

**Measurement (XAUUSD 90d, fast):**

| spec | raw | volSkip | executed | winRate | netR |
|---|---|---|---|---|---|
| watukushay_no1 (baseline) | 87 | 78 | **0** | — | 0 |
| watukushay_no1 (regimeRelax bypass) | 87 | 55 (23 relaxed) | **13** | 84.6% (11W/2L) | **+3.12** |
| watukushay_fe (control) | 11 | 1 | 0 | — | 0 (unchanged) |
| orb_classic (control) | 31 | 25 | 6 | 83% | +2.61 (unchanged) |
| smart_risk (control) | 1 | 0 | 1 | 0% | −1.12 (unchanged) |

**Dial finding:** `mode:"percentile"` (relaxTo p99) produced **0** executed — the 23 agree-trending setups cluster in XAU's **top‑<1% most‑volatile bars** (momentum bursts), so p99 (the max profile column) isn't wide enough. Escalating to `mode:"bypass"` (the documented plan dial) lets them through → 13 clean trades. Principle: on a clean agreed trend, elevated ATR is directional participation, not chaos, so not vol-blocking is defensible; the 84.6% / +3.12R / 1.46-bar-avg-hold result supports it.

**CRITICAL footgun + recovery (SK-66):** populating `features_direction_state` over 90d via `recompute-feature-recent … skipCache` recomputed the **full dependency closure** (atr→pivot→htf_bias→bias→direction_state) and the trailing window starved HTF context (1h bias needs 4h/1d history the 40-bar lookback couldn't supply) → `features_htf_bias` 1h rewritten ~72% BLOCK, `features_bias` 1h ~93% **neutral**, `features_direction_state` agreement=false everywhere — collapsing `watukushay_no1` raw **87→11** and `watukushay_fe` 11→0 (both anchor 1h bias). Production was safe: the live edge (post-window) stayed bullish/healthy and 1d/4h were untouched, so only the historical 90d 1h chain used by backtests was poisoned. Recovered by (1) `backfill-historical-features.js XAUUSD 1h --features=features_htf_bias,features_bias --start/--end` (processes with `lookbackBars:500` + full context → bias restored to **0 neutral**, validated on a narrow mid-May window first); (2) new **read-only** `scripts/reconcile-direction-state.js` that joins the restored bias+htf_bias with the engine's `reconcileDirection` and writes `features_direction_state` (`readOnlyOK` verified — input counts unchanged) → 1659 rows, **417 agreement / 233 agree‑trending**.

**New findings:**
- **SK-66 (HIGH, process).** `skipCache` closure recompute of a *derived* feature rewrites its upstream inputs and can starve HTF context, poisoning good features. Rule: backfill a derived feature via **read-only reconcile of already-computed inputs** (or skipCache:false so deps are read from cache), never via a skipCache closure recompute. `recompute-feature-recent.js` is safe only for leaf features; for `features_direction_state` use `reconcile-direction-state.js`.
- **SK-64 (closed).** Fixed the pre-existing `compiler.test.ts` rot en passant: the ATR SL/TP renderer has emitted `COALESCE(a_15m.effective_value, a_15m.value)` since P0-A, so the `a_15m.value * 2.0` expectation was updated to the COALESCE regex form (unrelated to the gate; required for a green suite).

**Carry (still out of scope):** `NY:0.98`/`pctToColumn` no-op (no `p98` column); loader merge-by-id for `gates` arrays (would remove the 5-gate duplication in the variant); projecting `agreement` in the compiler anchor (only needed for a spec-level regime filter).

---

## Appendix I — Skeleton reconciliation + Tranche A (2026-07-10): SK-57, SK-62, SK-66, direction_state, SK-51

The §5 `Status` column is a pre-fix snapshot. This appendix is the reconciliation of record:
the items below are **verified closed** by the §7 bricks or this session (evidence cited). What
remains genuinely open is bucketed at the end (B = medium, C = architectural, phased per §8).

**Verified closed (flip §5 `open` → closed):**

| SK | Closed by | Evidence |
|---|---|---|
| SK-13 | Brick 4 / SK-65 | candle quarantine prefilter in ingest + CSV backfill; 107,027-bar scan 0 suspect (App G) |
| SK-15 | Brick 1 | `features_atr` XAUUSD live edge 100% v1.2.0 (App D) |
| SK-24 / SK-49 | P0-C | XAUUSD `features_zone` lifecycle <2h, 0 scars (App D) |
| SK-27 | Brick 2 | `features_direction_state` Direction Arbiter (App E) |
| SK-34 | P0-C | per-feature max-age: `liveRunner.ts:331` `CANDLE_MAX_AGE_MINUTES`, `:975-990` level 30m / state 10m; comment `:828` "replaces flat maxAge=5" |
| SK-35 | P0-C | state/event/level classification fixed — `producerFreshness.test.ts` + `checkFeatureFreshness.test.ts` ("event features never block", "the 5-min bug is gone", zone bucketed as level) |
| SK-36 / SK-52 / SK-56 | P0-C | `feature_producer_runs` ledger + `BLOCKED_PRODUCER_STALE` (App D) |
| SK-37 / SK-38 / SK-48 / SK-50 | Brick 3 | `BLOCKED_SYSTEM_QUALITY` preflight + honest `dataQuality` (App F) |
| SK-61 | P0-C | iFVG `ts = originating_zone_ts` (App D) |
| SK-64 | Brick 2 / App H | compiler SL/TP expectation updated to COALESCE form |
| SK-65 | Brick 4 | ingest-parity magnitude prefilter in CSV backfill (App G) |
| **SK-57** | **this session** | `feature_cache` key now includes `engine_ver` via `buildCacheInputHash()` (`dag/runner.ts`); pre-fix 0/88,424 rows versioned; engine **96→101** |
| **SK-62** | **this session** | `computePersistOutcome()` → truthful `rows_rejected`/`status='error'` on failed batch (no more `done` masking); `pctToColumn()` throws on unknown percentiles (NY:0.98 no-op corrected 0.98→0.95 in 4 DB rows + 4 YAMLs, behavior-identical, verified); trade-pipeline **79→84**, strategies **24** |
| **SK-66** | **this session** | `recompute-feature-recent.js` refuses derived-feature skipCache recompute (the exact poisoning command now exits 2); `planRecompute()` + 10 tests |
| **direction_state completeness** | **this session** | XAUUSD 1h + 15m reconciled to 100% within 90d, fresh (read-only, `readOnlyOK`); only live consumer is `watukushay_no1`@1h |
| **SK-51** | **this session** | `migrationRunner.ts` destructive-migration guard (`findDestructive()`); blocks TRUNCATE/DROP on protected live tables that hold data unless `TM_ALLOW_DESTRUCTIVE=1`; verified it flags the real `075`/`077`; shared **36**, downstream 101/84/24 |

**This-session suite totals:** engine **101**, trade-pipeline **84**, strategies **24**, shared **36** (all green).

**Still open — Bucket B (medium; each its own plan + approval):** SK-43 (retired `features_fvg` + backup + overloads — now gated by SK-51; needs `TM_ALLOW_DESTRUCTIVE=1` + backup), SK-55 (`trustStoredLifecycle` live=true/backtest=false — confirmed by-design this session), SK-33 (bias/htf_bias `hashInput` omits version/weights — largely mitigated by SK-57; residual = persisted `input_hash` column), SK-58 residual (audit ran read-only: 0 INSANE; `pb_blake_2026_smc` XAU 50 OK; `xauusd_v1` 30 / `forex_strategy_orb` 2.5 / `scarface_5m_orb` 1.5 TIGHT=aggressive-not-broken; EUR caps loose). (SK-08, SK-10, SK-11 closed this session.)

**Data-quality residual (this session):** XAUUSD `candles_1m` true missing ≈ 904 tradable-min/90d after repair (the daily 21:00 UTC gold halt is excluded). The dominant event — a **~39h outage 2026-07-06 Mon 04:51 → 07-07 19:40 UTC** — was **REPAIRED** this session: root cause = a DB/web admin-kill during a Jul 6 restart (`[db] pool error: terminating connection due to administrator command` → `ECONNREFUSED` on `/api/mt5/*`; first successful `POST /api/ingest/mt5/bars` again Jul 7 19:40 UTC). Re-exported XAUUSD M1 from the MT5 terminal (1xTrade) and re-imported (idempotent UPSERT, 2,740 rows) → Jul 6 12→1382 bars, Jul 7 192→1447; refreshed all 6 HTF caggs + recomputed features (844 bars, 0 errors) over the window. Coverage now **1m 99.0% / 5m 99.0% / 15m 99.3% / 1h 99.5%** (from ~92%). Remaining 904 1m-min = 7 smaller gaps (04-12, 05-07, 05-25, 06-10, 06-19, 06-23, 07-01; largest now ~4h) — same MT5-export path if needed. **Follow-up (separate SK-class):** ingest-path resilience so a DB/web restart can't drop ~39h (EA spool/retry + restart ordering).

**Still open — Bucket C (architectural; phased per §8, not this push):** Phase 2 event-based model (SK-16..23, SK-25, SK-26); Phase 3 candidate snapshots (SK-44..47); Phase 4 contract map + canonical views (SK-39..42); Phase 5 gate calibration + promotion state machine (SK-58, SK-60); Phase 6 time/market-data contracts + parity (SK-01..07/12/14, SK-53/54/59 — **SK-10 closed this session**). Each is a multi-file, multi-day initiative with its own acceptance criteria — open a dedicated plan when started; do not bundle into "skeleton fixes."

---

## Appendix J — 2026-07-12 research pass: six recurring failures and the stronger architecture

This pass re-checked the latest six reported issues against current code, DB probes, and the existing skeleton ledger. The headline: several symptoms are partly outdated, but they still expose the same structural weakness — the system lets strategy logic, lifecycle state, feature freshness, and DB naming drift apart. The durable fix is a reliability architecture, not another round of strategy tuning.

### J.1 Claim triage

| Reported issue | Current finding | Architecture conclusion |
|---|---|---|
| Zone lifecycle not populated | Partly true, but more nuanced. XAUUSD 90d zones mostly have lifecycle columns populated (`features_zone@5m`: 2,306,205 rows, 2,301,863 touched/mitigated, 2,304,875 invalidated, 91 with no lifecycle). However `lifecycle_refresh_state.features_zone` is still about 8.9 days behind, and invalidated-but-untapped rows exist. | Do not trust raw `tapped`/`is_fresh` booleans as hard truth. Introduce an explicit lifecycle state machine and a lifecycle SLA gate. |
| `features_zone@5m` massive | Confirmed. XAUUSD `features_zone@5m` remains ~2.3M rows in 90d; all-zone estimate was ~24.6M. | Indexes help, but the root fix is stable market-object identity, dedupe, expiry, partitioning, and canonical views. |
| Warmup too aggressive | The exact number is outdated: `MIN_WARMUP_CANDLES` is now 50, not 200. The design smell remains: warmup is still fixed from signal TF unless the spec overrides it. | Warmup must be derived from each strategy's declared feature lookbacks, HTF dependencies, indicator periods, and risk formulas. |
| Sniper volatility over-filtering / ATR TF mismatch | Sniper variants are mostly archived/inactive, and active XAU strategies now use percentile volatility gates in places. The deeper problem remains: volatility policy is not a first-class calibration contract per strategy family, symbol, session, and signal TF. | Gate calibration must be metadata-backed, versioned, and promotion-gated. ATR timeframe mismatches should be explicit and tested. |
| `doyle_sd` timeouts/holds | `doyle_sd` currently declares `timeoutBars: 60`, not the old default 24. But the issue is valid: timeout should not be guessed; it should be calibrated from observed MFE/MAE/hold-time distribution per setup type. | Outcome simulation needs per-strategy hold-time diagnostics, not fixed defaults hidden in specs. |
| `features_order_block@1m` only 3 rows | Confirmed for XAUUSD 90d. 1m OB strategies are starved. This is not automatically a producer bug; 1m OB may be too noisy or definitionally rare after quality filters. | Add a feature capability matrix and block specs requiring unproven feature/tf surfaces. Promote OB as a canonical market object with density expectations. |

### J.2 Corrected root-cause model

The setup-engine block messages are not reliable root-cause labels by themselves.

- `All nearby zones have already been tapped` can mean zones are truly old/tapped, lifecycle is stale, context builder selected the wrong zone set, or a non-zone strategy was forced through zone hard rules.
- `No entry zone within 1.5 ATR` can mean no valid zone exists, ATR is stale/outlier, the strategy family does not need a zone, or the entry model should use a different market object.
- `dataQuality: READY` can still miss semantic failures such as stale opening-range joins, stale lifecycle checkpoints, sparse state features, or compiler/default PIT drift.

Therefore the system needs separate failure classes:

| Failure class | Example | Required status |
|---|---|---|
| Missing data | `features_pricing@1m = 0` for a required dense feature | `BLOCKED_MISSING_DATA` |
| Stale state | lifecycle checkpoint older than SLA | `BLOCKED_STALE_STATE` |
| Semantic join bug | ORB opening range joined by stale `MAX(ts)` | `BLOCKED_SEMANTIC_JOIN` |
| Strategy-family mismatch | ORB forced through zone proximity hard rules | `BLOCKED_ENGINE_MISMATCH` |
| Genuine market absence | no sweeps/FVGs occurred in window | `READY_ZERO_EVENTS` or `DEGRADED_SPARSE_EVENT` |
| Statistical over-filter | gate removes most candidates but data is valid | `READY_FILTERED`, with stage-waterfall evidence |

### J.3 Stronger architecture proposal

#### 1. Market Object Layer, not raw feature-table truth

Create canonical objects and stop letting every strategy query raw feature tables directly.

| Canonical object | Sources | Required fields |
|---|---|---|
| `market_level` | zones, OBs, FVGs, pivots, liquidity pools | `object_id`, `source_table`, `source_pk`, `symbol`, `tf`, `object_type`, `direction`, `top`, `bottom`, `mid`, `formed_at`, `valid_from`, `valid_until`, `state`, `quality_score`, `producer_version` |
| `market_event` | sweeps, BOS/MSS/CHOCH, displacement, retests, candle patterns | `event_id`, `event_type`, `direction`, `price`, `bar_time`, `valid_until`, `confidence`, `source_table`, `producer_version` |
| `market_session_object` | opening range, session high/low, Asia range, NY AM range | `session_date`, `session_name`, `range_start`, `range_end`, `valid_from`, `valid_until`, `high`, `low`, `mid`, `timezone_contract` |

Acceptance:

- Strategies read canonical views by default.
- Raw tables remain producer-owned implementation detail.
- Direct raw-table reads require an explicit exception in the strategy contract.

#### 2. Zone lifecycle as a state machine

Replace booleans as the primary lifecycle interface.

Recommended states:

```text
formed -> active -> touched -> retest_eligible -> mitigated -> invalidated -> expired
```

Rules:

- `first_touch_at` is wick contact.
- `mitigated_at` should be a strategy-defined rule, usually close-through/meaningful fill, not automatically first wick.
- `invalidated_at` is distal-edge close-through or object-specific invalidation.
- `expired_at` removes old untouched objects from trading without pretending they were invalidated.
- `tapped` becomes derived display metadata, not a hard decision primitive.

DB invariants:

- `invalidated_at >= formed_at`
- `first_touch_at >= formed_at`
- `mitigated_at >= first_touch_at` when both exist
- `state='active'` requires `invalidated_at IS NULL AND expired_at IS NULL`
- invalidated rows cannot be selected as active even if `tapped=false`

Lifecycle job requirements:

- Cursor-driven, table-scoped, resumable.
- Proves progress each iteration: selected row count, updated row count, min/max processed `formed_at`, next cursor.
- Stops if the same candidate window repeats.
- Runs in a maintenance pool with explicit timeout policy.
- Writes `feature_producer_runs` as `done`, `partial`, or `error`; no silent success when most rows reject/no-op.

#### 3. Zone table scale fix: identity before indexes

The durable fix is not only `CREATE INDEX`.

Implement:

1. Stable `object_id` / `anchor_hash` from symbol, tf, type, direction, formation candle, rounded geometry, and producer version.
2. Upsert by `object_id`, not raw float `top/bottom`.
3. Separate snapshot rows from object lifecycle rows:
   - `market_level_objects`: one row per level/object.
   - `market_level_observations`: optional per-bar observation/score changes.
   - `market_level_lifecycle`: current and historical state transitions.
4. Partition/hypertable by `formed_at` or `bar_time` for observations.
5. Add active partial indexes:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_market_level_active_lookup
ON market_level_objects(symbol, tf, object_type, direction, formed_at DESC)
WHERE state IN ('active', 'touched', 'retest_eligible');
```

6. Add retention/archival policy for expired observations while keeping object summary.

This reduces `features_zone` from millions of duplicate snapshots to a smaller set of durable tradeable objects.

#### 4. Family-aware setup engine

`runHardRules()` currently applies zone requirements universally:

- no zones -> block
- all zones tapped -> block
- no entry zone within ATR -> block

That is wrong for ORB, MA crossover, pure displacement, and continuation strategies.

Introduce `setupFamily`/`setupProfile`:

| Family | Required hard context |
|---|---|
| `zone_reversal` | active market level, distance policy, lifecycle state |
| `orb_breakout` | valid same-session opening range, break direction, post-range timing |
| `fvg_continuation` | FVG/iFVG event, displacement, direction state |
| `trend_pullback` | direction state, pullback depth, MA/structure alignment |
| `liquidity_sweep` | sweep event, reclaim/confirmation, invalidation level |

Hard rules are opt-in by family. A strategy that does not declare a family fails validation before backtest/live promotion.

#### 5. ORB/session object repair

Opening range must be a session-scoped object, not `MAX(ts)<=signal_ts`.

Required:

- `session_date`
- `session_name`
- `range_start_ts`
- `range_end_ts`
- `valid_from_ts`
- `valid_until_ts`
- `timezone_contract`
- `range_minutes`
- `source_tf`

Join rule:

```sql
signal.symbol = opening_range.symbol
AND signal.session_date = opening_range.session_date
AND signal.session_name = opening_range.session_name
AND signal.ts >= opening_range.valid_from_ts
AND signal.ts < opening_range.valid_until_ts
```

No ORB result is promotion-eligible until default PIT and compiler PIT produce identical candidate IDs.

#### 6. Warmup derived from dependency graph

Replace fixed warmup with:

```text
warmupBars = max(
  declared indicator periods,
  feature registry defaultLookbackBars,
  HTF parent context requirement converted to signal TF,
  strategy explicit minimum,
  risk formula ATR period
)
```

Report warmup losses separately:

- `raw_before_warmup`
- `raw_after_warmup`
- `skipped_by_dependency_warmup`
- `skipped_by_policy_warmup`

If a 90d run has `rawSignals <= 5` and all fall in warmup, the verdict should be `INSUFFICIENT_SAMPLE`, not a strategy failure.

#### 7. Volatility and timeout calibration as contracts

Volatility gate:

- Every strategy declares `signalTf`, `atrTf`, `atrPeriod`, `calibrationWindowDays`, and `sessionPolicy`.
- If `atrTf != signalTf`, the spec must declare why (`risk_sizing`, `noise_filter`, `regime_filter`) and tests must verify the intended mapping.
- Percentile profiles are computed per symbol/session/tf/period and versioned.
- Unknown percentiles fail validation.

Timeout:

- `timeoutBars` should be backed by observed hold-time distribution:
  - `p50_hold_bars`
  - `p75_hold_bars`
  - `p90_hold_bars`
  - timeout loss rate
  - average MFE/MAE before timeout
- Promotion rule: if timeout rate > 30%, strategy is `NEEDS_EXIT_MODEL`, not "bad WR".
- Intrabar mode must be reported with the result and compared across `sl_first`, `close`, and at least one path-sensitive mode before promotion.

#### 8. Feature capability matrix

Generate and enforce a matrix before seeding/promoting specs:

| feature | symbol | tf | semantic type | expected density | rows 90d | latest ts | producer age | lifecycle age | verdict |
|---|---|---|---|---:|---:|---|---|---|---|

Rules:

- Dense state features must meet row-density and freshness thresholds.
- Sparse event features must meet producer freshness and capability existence, not row-density.
- A spec requiring `features_order_block@1m` cannot be active unless that surface is `READY` or explicitly marked `experimental`.
- Backtest should fail before SQL generation if required feature surfaces are `BLOCKED`.

#### 9. Candidate snapshot and stage waterfall

Persist every candidate, not just trades:

```text
bias -> setup feature match -> entry feature match -> direction arbiter -> setup engine -> gates -> risk -> fill -> outcome
```

Required table: `strategy_signal_candidates`

Minimum fields:

- `candidate_id`
- `strategy_id`, `strategy_version`, `compiler_version`
- `symbol`, `tf`, `bar_time`
- `direction_state_id`
- `market_object_ids`
- `feature_snapshot_hash`
- `stage`
- `decision`
- `reject_reason_code`
- `reject_reason_detail`
- `risk_snapshot`
- `gate_snapshot`
- `data_quality_status`

This turns "why no trades?" into a query instead of another forensic audit.

### J.4 Priority plan

| Priority | Work | Why it matters |
|---|---|---|
| P0 | Family-aware setup engine | Stops ORB/trend/displacement strategies from being falsely judged by zone rules. |
| P0 | Session object model for opening range | Removes stale OR leakage and fixes ORB validity. |
| P0 | Lifecycle state machine + SLA gate | Stops stale/tapped/invalidated ambiguity from driving hard decisions. |
| P0 | Feature capability matrix | Prevents specs from requiring dead surfaces like `features_order_block@1m`. |
| P1 | Market-object identity/dedupe + active indexes | Shrinks zone explosion structurally; indexes become support instead of duct tape. |
| P1 | Dependency-derived warmup | Prevents false failures on low-frequency HTF/keylevel strategies. |
| P1 | Gate calibration registry | Makes volatility/spread/timeout policies statistically defensible per symbol/session. |
| P2 | Candidate snapshots | Makes every rejection explainable and replayable. |

### J.5 Acceptance tests before trusting win rate

No strategy win rate should be discussed until these pass:

```bash
node scripts/audit-feature-contracts.js
node scripts/check-candle-coverage.js XAUUSD 90 '1m,5m,15m,1h,4h,1d'
$env:DOTENV_CONFIG_PATH='.env.local'; node -r dotenv/config scripts/check-feature-freshness.js XAUUSD
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research
$env:PIT_USE_COMPILER_SQL='1'; node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=research --debug
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 a_plus_orb_fvg_5m --json --mode=full
```

Acceptance:

- `features_zone` lifecycle checkpoint age < 2h and no stale-NULL active rows.
- Default PIT and compiler PIT produce identical candidate IDs for ORB.
- ORB opening range joins only same-session/date objects.
- Setup block reasons are family-specific.
- Required feature surfaces are `READY` in the capability matrix.
- Timeouts are reported as an exit-model metric, not merged into generic losses.
- Every raw candidate has a persisted stage/reject reason.

### J.6 Implementation pass - 2026-07-12

Shipped in this pass:

- **Family-aware setup engine.** `EvaluationInput`/`EvaluationContext` now carry `setupFamily`, `strategyId`, `familyId`, and `signalSource`. `runHardRules()` only applies zone-entry hard blocks (`No active zones`, `All nearby zones tapped`, `No entry zone within 1.5 ATR`) to `zone_reversal` / `signalSource: zone`. ORB/FVG/trend/indicator strategies no longer get falsely BLOCKed by zone rules.
- **Runner family inference.** `scripts/backtest-pit-v2.js` infers `setupFamily` from explicit spec metadata, then from `signalSource`, then from family/id naming. Key specs now declare it explicitly: `orb_classic=orb_breakout`, `a_plus_orb_fvg_5m=fvg_continuation`, `doyle_sd=zone_reversal`.
- **Lifecycle SLA preflight.** Required lifecycle-backed level tables (`features_zone`, `features_ifvg`, `features_order_block`) now block when their `lifecycle_refresh_state.last_processed_ts` is more than 2h behind the candle data edge. This converts stale lifecycle from a hidden false-positive source into `BLOCKED_SYSTEM_QUALITY`.
- **Dependency-derived warmup.** Backtest warmup is now the max of the policy floor, explicit `warmupBars`, registry lookbacks, condition `lookbackBars`, predicate MA/period values, and signal-source MA periods converted to signal-TF bars. Explicit warmup can no longer undercut dependencies.
- **Spec validation.** Strategy validation now recognizes `setupFamily` and rejects incompatible combinations such as `signalSource: orb` with `setupFamily: zone_reversal`.

Verification:

```bash
pnpm --filter @tm/setup-engine test
pnpm --filter @tm/strategies test
node --test scripts/backtest-pit-v2.test.js
pnpm -r build
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full --preflight
node scripts/backtest-pit-v2.js XAUUSD 90 orb_classic --json --mode=full
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full --preflight
node scripts/backtest-pit-v2.js XAUUSD 90 a_plus_orb_fvg_5m --json --mode=full --preflight
```

Observed behavior after the fix:

- `orb_classic` preflight is `READY` and full mode no longer suffers the old zone-rule death spiral. It produced 37 raw signals, only 1 setup-engine BLOCK, 8 executed, 7W/1L, 87.5% WR, +4.10R. The remaining 28 skips are volatility-gate skips, not false zone lifecycle blocks.
- `doyle_sd` now fails closed before the PIT query: `BLOCKED_SYSTEM_QUALITY`, because required `features_zone` lifecycle is stale by ~215h versus the 2h SLA. This is correct because Doyle is a true zone-reversal strategy.
- `a_plus_orb_fvg_5m` also fails closed before the heavy query because it requires FVGs from `features_zone` and the same zone lifecycle checkpoint is stale. This prevents the old 2.3M-row timeout from being misread as a strategy issue.

Still open after this pass:

- Build the canonical market-object tables/views (`market_level`, `market_event`, `market_session_object`) and migrate strategies off direct raw feature reads.
- Replace lifecycle booleans with a persisted state machine (`formed -> active -> touched -> retest_eligible -> mitigated -> invalidated -> expired`).
- Add the feature capability matrix as a generated artifact and promotion gate.
- Persist `strategy_signal_candidates` stage snapshots.
- Calibrate volatility/timeout as versioned contracts instead of loose YAML parameters.

### J.7 Implementation pass - feature capability + lifecycle repair contract - 2026-07-12

Shipped in this pass:

- **Generated feature capability matrix.** Added `scripts/feature-capability.js` and `scripts/generate-feature-capability-matrix.js`. The matrix classifies each feature/table/symbol/tf as `READY`, `READY_EVENT`, `READY_LEVEL`, `STALE_STATE`, `EMPTY_DENSE`, `SPARSE_EVENT_EMPTY`, `PRODUCER_STALE`, `BLOCKED_LIFECYCLE`, `CONTRACT_MISMATCH`, or `MISSING_TABLE`. It writes `reports/feature-capability-latest.json` and `reports/feature-capability-latest.md`.
- **Lifecycle drain progress guard.** `scripts/drain-lifecycle.js` now logs checkpoint movement per iteration and fails if rows are updated without checkpoint progress. It also supports targeted repair: `--table=features_zone --tf=5m`.
- **Bounded zone lifecycle scans.** Migration `109_bound_zone_lifecycle_fill_scan.sql` caps the remaining expensive fill/touch candle scans. This fixed the first confirmed failure where even `limit=100, tf=5m` hit `statement_timeout`.
- **Per-timeframe lifecycle checkpoints.** Migration `110_zone_lifecycle_tf_checkpoint.sql` adds `lifecycle_refresh_state_tf`. This closes a serious drift bug: a targeted `features_zone@5m` repair could previously advance the single table checkpoint and make `1m/15m/1h/4h/1d` look healthy.
- **Separated critical lifecycle from touch/retest analytics.** Migration `111_zone_lifecycle_separate_touch_counts.sql` removes expensive touch/retest aggregation from `refresh_zone_lifecycle()`. Critical fields (`tapped`, `first_touch_at`, `mitigated_at`, `invalidated_at`, `is_fresh`, `fill_pct`) can no longer be rolled back because secondary touch-count analytics timed out.

Evidence:

```bash
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=5m
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=1m
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=15m
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=1h
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=4h
node scripts/drain-lifecycle.js XAUUSD 10 500 --table=features_zone --tf=1d
node scripts/generate-feature-capability-matrix.js --symbols=XAUUSD --days=90 --tfs='1m,5m,15m,1h,4h,1d'
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full --preflight
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full
node --test scripts/backtest-pit-v2.test.js
```

Observed behavior:

- `features_zone` per-timeframe checkpoints are now current for XAUUSD: `1m`, `5m`, `15m`, `1h`, `4h`, and `1d` all advanced to the candle edge around `2026-07-12T05:27-05:28Z`.
- `doyle_sd` preflight moved from `BLOCKED_SYSTEM_QUALITY` to `READY`; the old false failure from stale zone lifecycle is gone.
- Full `doyle_sd` now exposes the real strategy/data-selection problem: 143 raw signals, 69 executed, 7W/62L, 10.1% WR, -55.37R. This is direction/selection quality failure, not lifecycle starvation.
- The XAUUSD matrix no longer reports `BLOCKED_LIFECYCLE` for `features_zone`. Remaining unsafe surfaces are producer/data freshness issues: 50 `STALE_STATE`, 15 `EMPTY_DENSE`, 1 `MISSING_TABLE` (`features_time_of_day`), plus stale producers.

Root issues still open:

- **Touch/retest analytics need their own event ledger.** Do not put touch-count/retest-count scans back inside `refresh_zone_lifecycle()`. Create `zone_touch_events(zone_id, symbol, tf, touch_ts, touch_type, candle_ts, fill_pct)` and maintain counts from that ledger. Lifecycle state should answer "is this object tradable now"; analytics should answer "how many interactions did it have."
- **Feature producers are stale versus candle edge.** Many state features end around `2026-07-10`, while candles extend to `2026-07-12`. The next root fix is a producer orchestrator that orders candle refresh, HTF aggregation, state features, event features, lifecycle repair, and capability validation as one transaction-like DAG.
- **Missing/empty surfaces need explicit contracts.** `features_time_of_day` is in the registry but no table exists. `features_ifvg@1m`, `features_bias@1m`, and several direction/liquidity surfaces are empty. Either implement producers, mark them unsupported in the registry, or block specs from referencing them.
- **Zone density remains structurally suspicious.** `features_zone@5m` has ~2.3M rows in 90 days, while `features_zone@1m` only had 453 recent rows in the 10-day drain. Market-object identity/dedupe is still needed so strategies trade current objects, not duplicated historical shadows.
- **Capability matrix must become a promotion gate.** Backtests and live promotion should query this matrix for the strategy's required feature surfaces and refuse to run/publish when required state features are stale, missing, or empty.

### J.8 Implementation pass - capability gate + touch ledger - 2026-07-12

Shipped in this pass:

- **Capability matrix is now a PIT quality gate.** `scripts/backtest-pit-v2.js` evaluates capability verdicts only for the strategy's required feature surfaces. Blocking verdicts are `MISSING_TABLE`, `CONTRACT_MISMATCH`, `EMPTY_DENSE`, `BLOCKED_LIFECYCLE`, `STALE_STATE`, and `PRODUCER_STALE`. Sparse event emptiness remains degraded, not blocked.
- **Lifecycle staleness now respects zone timeframe checkpoints.** The PIT lifecycle check now reads `lifecycle_refresh_state_tf` for `features_zone@tf`, falling back to the legacy table only when no timeframe-specific checkpoint exists.
- **Zone touch/retest ledger.** Migration `112_zone_touch_event_ledger.sql` adds `zone_touch_events`, `zone_touch_event_refresh_state`, and `refresh_zone_touch_events()`. `scripts/drain-zone-touch-events.js` drains this analytics plane separately from lifecycle repair.
- **Regression tests.** `scripts/backtest-pit-v2.test.js` now covers the capability policy, required-feature filtering, and capability keying.

Verification:

```bash
pnpm db:migrate
node --check scripts/backtest-pit-v2.js
node --check scripts/drain-zone-touch-events.js
node scripts/drain-zone-touch-events.js XAUUSD 10 100 --tf=5m
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full --preflight
node --test scripts/backtest-pit-v2.test.js
```

Observed behavior:

- `zone_touch_events` successfully backfilled XAUUSD `5m` recent analytics: 474,354 touch events across 2,322 distinct zone IDs, checkpointed to `2026-07-12T05:35:00Z`.
- All event zone IDs map back to `features_zone`; no orphan ledger rows were found.
- Touch distribution is unhealthy: median 6 touches per zone, p95 628, max 6,200. This confirms the next problem is not "missing touch counts"; it is excessive/duplicated overlapping zone objects.
- `doyle_sd` now fails closed for the correct reason: required dense state features are stale, not because zone lifecycle is broken. Required blocked surfaces were `features_bias@5m`, `features_pricing@5m`, `features_atr@5m`, and `features_moving_average@5m`.
- Unit tests passed: `node --test scripts/backtest-pit-v2.test.js` => 63/63.

Root issues still open:

- **Producer DAG freshness.** Candle data extends beyond required state features by ~30h. A backtest should not run when bias/pricing/ATR/MA are stale versus candle edge. Build one orchestrated DAG: candle import -> cagg refresh -> state features -> event/level features -> lifecycle repair -> touch ledger -> capability gate.
- **Zone object dedupe/canonicalization.** The touch ledger made the object explosion measurable. Create canonical `market_zone_objects` with a stable `zone_id`, price-overlap clustering, timeframe ancestry, and active object replacement rules. Strategies should query canonical active zones, not every raw row in `features_zone`.
- **Analytics SLA should be separate from execution SLA.** `zone_touch_events` freshness should degrade grading and quality scoring, but it must not block critical tradability unless a strategy explicitly depends on retest counts.

### J.9 Implementation pass - producer DAG + canonical zone objects - 2026-07-12

Shipped in this pass:

- **Producer freshness DAG runner.** Added `scripts/run-producer-freshness-dag.js`. It reads the capability matrix, plans repairs only for selected feature/tf surfaces, refreshes candle caggs, recomputes safe leaf features with `scripts/recompute-feature-recent.js`, repairs derived stale features with full-context `scripts/backfill-historical-features.js`, then drains lifecycle, drains the touch ledger, and regenerates the capability matrix.
- **Weekend-aware capability edge.** `scripts/feature-capability.js` and PIT lifecycle staleness now compare feature freshness to the last weekday candle edge, not the last raw imported candle. The repo's engine filters weekend candles before persistence, so raw Saturday/Sunday candles must not make weekday features look stale.
- **Canonical zone object layer.** Migration `113_market_zone_objects.sql` adds `market_zone_objects`, `market_zone_objects_active`, and `refresh_market_zone_objects()`. Added `scripts/refresh-market-zone-objects.js` to refresh and measure raw-to-canonical compression.

Verification:

```bash
pnpm db:migrate
node scripts/run-producer-freshness-dag.js XAUUSD 5m --features=features_bias,features_pricing,features_atr,features_moving_average,features_zone --days=90
node scripts/run-producer-freshness-dag.js XAUUSD 5m --features=features_bias,features_pricing,features_atr,features_moving_average,features_zone --days=90 --apply
node scripts/refresh-market-zone-objects.js XAUUSD 5m 90
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full --preflight
node scripts/backtest-pit-v2.js XAUUSD 90 doyle_sd --json --mode=full
node --test scripts/backtest-pit-v2.test.js scripts/recompute-feature-recent.test.js
```

Observed behavior:

- The DAG repaired XAUUSD `5m` required state surfaces without errors:
  - CAGG refresh completed.
  - `features_atr` leaf recompute processed 673 bars.
  - Full-context backfill for `features_bias`, `features_pricing`, and `features_moving_average` processed 1,247 bars with 0 errors.
  - Lifecycle and touch-ledger checkpoints advanced to the data edge.
- `doyle_sd` preflight now returns `READY` instead of blocking on stale state or lifecycle.
- Full `doyle_sd` remains poor: 143 raw signals, 69 executed, 7W/62L, 10.1% WR, -55.37R. This is now a strategy/direction-selection failure, not a freshness or lifecycle skeleton failure.
- Canonical zone refresh on XAUUSD `5m` produced 5,546 canonical objects from 2,305,732 raw zones, a 415.7x compression ratio. Only 12 objects are currently active. Raw-zone duplication is therefore confirmed, measured, and now has a target object layer.

New root findings:

- **Weekend candle contamination.** `candles_1m` and `candles_5m` contained full Saturday and partial Sunday rows. The engine filters weekends before feature persistence, so freshness gates must compare against weekday edge unless the engine starts producing weekend features intentionally.
- **Raw zone tables are not strategy-grade.** `features_zone@5m` has millions of rows but collapses to thousands of canonical objects, with only a small active set. Directional strategies should migrate from raw `features_zone` joins to canonical active zone objects or a view over them.
- **Data freshness is no longer the blocker for Doyle.** The next most impactful work is direction-selection logic: HTF/LTF alignment, current-object selection, and avoiding stale/duplicated zone bias.
