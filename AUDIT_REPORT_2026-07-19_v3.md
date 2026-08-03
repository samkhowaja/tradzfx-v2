## 2026-07-27 ORB readiness and PIT volatility repair

- Added `infra/migrations/170_volatility_profile_pit_versions.sql`.
- Added `market_volatility_profile_pit`, leaving protected live profile table unchanged.
- Updated `scripts/compute-volatility-profile.js` with explicit historical `asOfTs` and causal source bounds.
- Updated `scripts/backtest-pit-v2.js` to select `market_volatility_profile_pit` rows with `as_of_ts <= signalTs`.
- Generated daily causal snapshots for 2026-06-20 through 2026-07-20.
- ORB full-mode rerun changed from 0 executions to 6 executions.

EURUSD 30-day full-mode result:

```text
Raw signals: 18
Setup blocked: 11
Volatility skipped: 1
Executed: 6
Wins: 1
Losses: 5
Net R: -1.7439
WR: 16.7%
```

Remaining issue: `features_opening_range@15m` reports `STALE_STATE` because lifecycle checkpoint remains stale. This is readiness metadata, not missing ORB rows. Historical override remains explicit through `BACKTEST_HISTORICAL_STALE_OK=1`; no future profile data enters PIT lookup.

# TRADZFX-V2 FORENSIC AUDIT REPORT v3
**Date:** 2026-07-19 | **Auditor:** Automated Analysis Engine

---

## EXECUTIVE SUMMARY

**Verdict: UNSAFE FOR LIVE DECISIONS — Backtest results cannot currently be trusted**

Three independent critical issues found:

**F-1 (CRITICAL): watukushay_no1 backtest TP/SL inverted.** Take-profit set BELOW entry for ALL buy trades across 1,587 backtest rows. Trade structure guarantees max loss. Example: entry=1.174, TP=1.145 (29 pips BELOW entry, ~5 pips above SL). Entire 3-month backtest is structurally invalid.

**F-2 (CRITICAL): Feature pipeline stalled ~50h.** Latest features_atr = Jul 17 10:38 UTC (49.8h stale). Engine worker explicitly disabled (`TM_DISABLE_FEATURE_JOBS=true`). Candle data fresh to Jul 19. All active paper strategies running on stale features.

**F-3 (MEDIUM): 146,979 multi-broker raw duplicates with CONFIRMED OHLC conflicts.** E.g., AUDUSD Jul 17 10:18 shows opens differing by 166 pips between brokers. **Mitigated** by canonical view layer — 0 duplicates at consumer level.

---

## 1. RAW MARKET DATA INTEGRITY

### 1.1 Row Counts (candles_1m, all brokers)

| Symbol  | Rows    | Date Range          |
|---------|---------|---------------------|
| EURUSD  | 220,186 | 2024-07 — 2026-07   |
| GBPUSD  | 172,001 | 2024-07 — 2026-07   |
| NZDUSD  | 161,950 | 2026-03 — 2026-07   |
| USDCHF  | 159,942 | 2026-03 — 2026-07   |
| USDCAD  | 151,016 | 2026-03 — 2026-07   |
| AUDUSD  | 150,754 | 2026-03 — 2026-07   |
| USDJPY  | 145,753 | 2024-07 — 2026-07   |
| XAUUSD  | 142,070 | 2025-01 — 2026-07   |
| USDSEK  | 142,150 | 2026-03 — 2026-07   |
| DXY     | 12,433  | 2026-07-07 — 2026-07-17 |

### 1.2 OHLC Structural Validity

**All constraints pass. 0 violations.**

| Check | Result |
|-------|--------|
| `high < low` | 0 rows |
| `open` outside `[low, high]` | 0 rows |
| `close` outside `[low, high]` | 0 rows |
| NULL OHLC | 0 rows |

### 1.3 Duplicate Analysis (RAW candles_1m)

**Finding: Multi-broker duplicates expected by design. PK = `(symbol, broker, ts)`.**
- Total raw rows: ~1,458,173
- Unique `(symbol, ts)`: ~1,311,194
- Extra rows from broker multiplicity: 146,979

**Confirmed conflicting OHLC in same (symbol,ts) across brokers:**

| Symbol | Timestamp | Broker A | Broker B | Conflict |
|--------|-----------|----------|----------|----------|
| AUDUSD | 2026-07-17 10:18 | open=0.69705 | open=0.69871 | **166 pips diff** |
| USDJPY | multiple | open=1.0209 | open=161.89 | **~16000x scale mismatch** |
| XAUUSD | multiple | open=1.148 | open=4138.56 | **~3600x scale mismatch** |

Scale mismatches (USDJPY, XAUUSD) show one broker storing raw price, other storing points/pips. AUDUSD 166p difference is genuine mid-price conflict between 1xTrade vs MT5.

### 1.4 Canonical View Deduplication

**Finding: Canonical view correctly resolves conflicts. 0 duplicates in consumer path.**

```
market.candles_1m_canonical → VIEW governed by raw.symbol_broker_policy
                            → LATERAL join selects single broker per (symbol, ts)
                            → 0 duplicate (symbol, ts) pairs
```

All 10 symbols → `1x Trade Ltd.` priority=1, manual failover. AUDUSD: raw=150,754 vs canonical=124,471 rows (excludes ~26K MT5/OANDA rows).

**All consumer paths use canonical views. No consumer reads raw `candles_1m` directly.**

| Consumer | Source |
|----------|--------|
| `backtest-pit-v2.js` (lines 650, 1605, 1713) | `market.candles_1m_canonical` |
| Engine DAG `runner.ts` via `getCandleTableForTf()` | `market.candles_*_canonical` |
| `candleSource.ts` default path | canonical views |
| `candleSource.ts` with `canonicalBrokerId` | broker-filtered raw (optional) |

### 1.5 Spread Quality (candles_1m)

| Symbol | Avg | Med | P95 | Max | Nulls |
|--------|-----|-----|-----|-----|-------|
| EURUSD | 1.84 | 1.70 | 2.10 | 10.5 | 0 |
| XAUUSD | 3.01 | 3.00 | 3.60 | 43.9 | 0 |
| USDSEK | 55.5 | 37.0 | 120 | 568 | 0 |
| DXY | null | null | null | null | **12,433 (100%)** |

**DXY spread 100% NULL** — synthetic broker doesn't populate spread field. Acceptable if DXY only used for correlation feature, not trading.

### 1.6 Coverage Gaps (90d canonical 1m)

| Symbol | Max Gap (min) | Character |
|--------|---------------|-----------|
| XAUUSD | 2076 (34.6h) | Weekend + daily break |
| EURUSD | 1781 (29.7h) | Weekend gap |
| USDJPY | 1782 (29.7h) | Weekend gap |
| NZDUSD | 1784 (29.7h) | Weekend gap |
| AUDUSD | 1779 (29.6h) | Weekend gap |

All max gaps consistent with FX 24/5 schedule (Sun 21:00 UTC → Fri 21:00 UTC). No unexpected long gaps.

**7-day small gaps (>2m):** EURUSD=18, USDJPY=18 events. Some intraday missing minutes — investigate if linked to Jul 6-7 outage window.

### 1.7 Candle Quality Flags

2 suspect bars flagged: USDSEK, both 1m range = 1376 pips (>1000p sanity cap). Flagged correctly in `candle_quality`, quarantined in backtest.

---

## 2. CANONICAL VIEW & BROKER ARCHITECTURE

### 2.1 Schema Structure

```
public.candles_1m                  → raw multi-broker (PK: symbol, broker, ts)
market.candles_1m_canonical        → VIEW deduplicating via symbol_broker_policy
market.candles_5m_canonical        → TimescaleDB continuous aggregate
market.candles_15m_canonical       → TimescaleDB continuous aggregate
market.candles_1h_canonical        → TimescaleDB continuous aggregate
market.candles_4h_canonical        → TimescaleDB continuous aggregate
market.candles_1d_utc_canonical    → TimescaleDB continuous aggregate
market.candles_1d_ny_canonical     → TimescaleDB continuous aggregate (auxiliary)
```

HTF canonical = materialized continuous aggregates. `1m_canonical` is the only actual VIEW.

### 2.2 Broker Policy

- All symbols → `1x Trade Ltd.`, failover_mode=manual, priority=1
- `broker_session_leases` table: empty (no active lease management)
- No automatic failover — if 1xTrade dies, system goes dark

### 2.3 Risk: No Failover

**Severity: HIGH. Confidence: Confirmed.**

`failover_mode=manual` for all 10 symbols. If 1xTrade feed fails, there is zero automatic recovery. MT5 and OANDA data arrives in `candles_1m` but canonical view never selects it. Recovery requires manual policy INSERT.

---

## 3. FEATURE COMPUTATION & FRESHNESS

### 3.1 Feature Table Status

| Feature Table | Rows | Latest Timestamp | Age (h) at audit |
|--------------|------|------------------|------------------|
| features_atr | 4.76M | Jul 17 10:38 UTC | 49.8 |
| features_bias | 255K | Jul 17 16:45 UTC | 49.8 |
| features_htf_bias | 441K | Jul 17 16:45 UTC | 49.8 |
| features_direction_state | 52K | Jul 17 19:55 UTC | 46.6 |
| features_correlation | 1,973 | Jul 17 16:45 UTC | 49.8 |
| features_spread | 15,256 | Jul 17 16:45 UTC | 49.8 |
| features_session | 221K | Jul 17 16:45 UTC | 49.8 |
| features_opening_range | 7,747 | Jul 17 16:00 UTC | 50.6 |
| features_zone | 718K | Jul 17 16:45 UTC | 49.8 |
| features_ifvg | 243K | Jul 17 16:32 UTC | 50.0 |
| features_order_block | 12,129 | Jul 17 16:29 UTC | 50.1 |
| features_sweep | 7,986 | Jul 17 16:41 UTC | 49.9 |
| features_structure | 46K | Jul 17 16:32 UTC | 50.0 |
| features_displacement | 261K | Jul 17 16:45 UTC | 49.8 |
| features_pricing | 279K | — | — |
| features_moving_average | 2.33M | — | — |

**ALL features stale 46-50 hours. Candle data fresh to Jul 19 18:32 UTC.**

### 3.2 Root Cause: Feature Pipeline Stalled

| Factor | Value |
|--------|-------|
| `TM_DISABLE_FEATURE_JOBS` | `true` (worker explicitly off) |
| Inline `runFeatureEngine()` | Triggered on 15m interval |
| Latest candle (canonical 1m) | Jul 19 18:32 UTC (fresh) |
| Latest feature (ATR) | Jul 17 10:38 UTC (50h stale) |
| Producer runs | ~2,600 `done` in 24h, all inserting 0-3 rows onto frozen timestamp |

**Finding: Engine runs but never advances past Jul 17.** Likely cause: 11h 1m ingestion gap (Fri Jul 17 14:37 → Sat 01:40 UTC) punched hole in 15m cagg. `getRecentCandles()` gap-tolerant path cannot see enough post-gap bars for 400-bar window. Forward-only event gate (`maxCandleTs <= lastTs → skip`) pins every feature to pre-gap anchor.

### 3.3 DXY Features

DXY features (correlation, spread) stale ~6 days (DXY candles end Jul 17). DXY is synthetic broker — underlying data source may have independent freshness schedule.

### 3.4 Missing Registry Tables (Informational)

Feature Registry references tables that DON'T EXIST:
- `features_volatility`
- `features_regime`
- `features_momentum`
- `features_volume_profile`

Never migrated. Not referenced by active strategy specs.

### 3.5 Cache Integrity

- `engine_ver` in ATR, bias, zone, ifvg tables ✅ (SK-57 fix)
- `input_hash` in majority of rows ✅
- Old unversioned cache rows orphaned, harmless
- `computePersistOutcome()` row counting accurate ✅ (SK-62 fix)

---

## 4. SIGNAL GENERATION AUDIT

### 4.1 Active Strategy Variants

| Variant ID | Family | Symbol | Active | Mode |
|-----------|--------|--------|--------|------|
| smart_risk_ob_ifvg_1m_runon_15r | smart_risk_ob_ifvg_1m | XAUUSD | ✅ | paper |
| smart_risk_ob_ifvg_1m_runon_15r_zone_tp | smart_risk_ob_ifvg_1m | XAUUSD | ✅ | paper |
| smart_risk_ob_ifvg_1m_sniper_10r_demand_supply_zone_tp | smart_risk_ob_ifvg_1m | XAUUSD | ✅ | paper |
| smart_risk_ob_ifvg_1m (base) | smart_risk_ob_ifvg_1m | XAUUSD | ❌ | — |
| watukushay | watukushay | multi-pair | ❌ | — |
| watukushay_no1 | watukushay | XAUUSD | ❌ | — |

3 active variants, all paper mode on XAUUSD.

### 4.2 Spec Sniper 10R Risk Parameters

Sniper 10R variants use:
- SL = 10 pips (hardcoded)
- TP via `opposing_zone_profit_beyond_min_rr` with minRR=10
- Entry = `limit` with zonePips=0

### 4.3 Live Orders

26 orders in DB history. Mix of paper/live:

| Order Set | Direction | Status | Reason |
|-----------|-----------|--------|--------|
| gold_9sma_scalper_1m (sell, paper) | SELL | Expired | — |
| gold_9sma_scalper_1m (sell) | SELL | Rejected | Spread 3.1 pips > max |
| ninja_turtle_scalper (buy×2) | BUY | Expired | — |
| ninja_turtle_scalper (buy×3) | BUY | Rejected | Entry drift 58.0p > max 2.0 |

**Finding: 0 filled orders in system history.** All 26 rejected or expired. Live pipeline never executed a trade.

### 4.4 Setup Evaluation Funnel

4,618 setup evaluations recorded. Schema has `variant_id`, `symbol`, `setup_data` fields. ~0.1% linked to orders. Top rejection: "No entry zone within 1.5 ATR" (125 occurrences) — consistent with stale/frozen zone+ATR features.

---

## 5. BACKTEST INTEGRITY — CRITICAL

### 5.1 watukushay_no1: TP/SL Inverted

**Finding: TP below entry for ALL buy trades across 3 months.**

Sampled from `backtest_results` (watukushay_no1, EURUSD, 90d):

| Timestamp | Dir | Entry | SL | TP | RR | Outcome |
|-----------|-----|-------|----|----|----|---------|
| May 1 15:00 | BUY | 1.17410 | 1.14495 | 1.14540 | 0.98 | LOSS |
| May 1 14:00 | BUY | 1.17392 | 1.14495 | 1.14540 | 0.98 | LOSS |
| May 1 13:00 | BUY | 1.17366 | 1.14495 | 1.14540 | 0.98 | LOSS |
| May 1 12:00 | BUY | 1.17345 | 1.14495 | 1.14540 | 0.98 | LOSS |
| May 6 08:00 | BUY | 1.17179 | 1.14495 | 1.14540 | 0.98 | LOSS |

**Quantification:**
- Entry ~1.174, TP = 1.14540 → TP is **286 pips BELOW entry**
- TP is only 4.5 pips ABOVE SL (1.14495)
- Price must drop 286 pips to hit TP, but only 5 pips to hit SL
- RR = 0.98 despite spec intent for 1.5R SL, 2R TP
- 100% loss rate across all 1,587 results

### 5.2 Root Cause Analysis

**Spec missing `risk:` block.** `watukushay_no1.yaml` has no risk configuration. Compiler falls back to default TP/SL computation which:
- Uses `atr(1h) * 1.5` for SL
- Sets TP minimally above SL (likely ATR * 0.x instead of atr * 2.0)
- Computes TP reference from wrong anchor (probably uses SL price rather than entry)

SL value (1.14495) is suspiciously consistent — suggests hardcoded fallback reference price, not ATR-based.

### 5.3 Backtest Determinism (Positive)

**Two consecutive identical runs of `backtest-pit-v2.js EURUSD 30 orb_classic --mode=fast --json` are byte-identical (modulo timing fields).** PIT discipline verified:
- `trustStoredLifecycle: false` in backtester ✅
- 15m rollup parity exact (12/12 buckets)
- Corrupt-bar quarantine working ✅

### 5.4 Other Backtest Issues

- `confidence: 0` for all results (confidence scoring never implemented for watukushay_no1)
- `heat_dropped: false` consistently
- All trades show `risk_reward ~0.98` (guaranteed loss configuration)

---

## 6. DATABASE & PIPELINE INTEGRITY

### 6.1 Schema Constraints

| Object | Constraint | Status |
|--------|-----------|--------|
| candles_1m | PK `(symbol, broker, ts)` | ✅ Correct |
| feature tables | No FK to symbol | ⚠️ By design, timeseries |
| feature CHECK | `ifvg_inv_after_ts` | ✅ SK-61 fixed |
| Migration guard | `findDestructive()` | ✅ Blocks unsafe ops |

### 6.2 Pipeline Guards

| Guard | Active | Notes |
|-------|--------|-------|
| Spread gate | ✅ | Rejected order: 3.1 pips spread |
| Volatility gate | ✅ | Percentile-based, regime relaxation |
| Session gate | ✅ | LONDON/OVERLAP/NY |
| Portfolio heat | ✅ | 1 concurrent per symbol |
| Rate limit | ✅ | 2 signals/h, 5/day |
| Entry drift | ✅ | Rejected: 58p drift > 2p max |
| Producer freshness | ⚠️ | Warn only, not block |
| Lifecycle staleness | ✅ | 2h max age check |
| Destructive migration | ✅ | Blocks unprotected DDL/DML |

### 6.3 Orders/Trades/Backtest Summary

| Table | Rows | Notes |
|-------|------|-------|
| orders | 26 | 0 filled |
| signals | — | Not queried |
| setup_evaluations | 4,618 | 0.1% order-linked |
| backtest_results | 1,587 | All watukushay_no1 |
| trades | 0 | Table doesn't exist |

---

## 7. ADVERSARIAL ANALYSIS

### 7.1 Resilience Defenses

| Vector | Defense |
|--------|---------|
| Multi-broker OHLC conflict | Canonical view via governed policy |
| Corrupt bars | `candle_quality` flags + backtest quarantine |
| Stale cagg | Deterministic 1m rollup fallback |
| Weekend silence | Market calendar 24/5 awareness |
| DB outage | EA spool + ingestion server spool file |
| Cache poisoning | `input_hash` includes `engine_ver` (SK-57) |
| Migration damage | `findDestructive()` guard (SK-51) |
| Producer silent failure | `computePersistOutcome()` (SK-62) |

### 7.2 Untested Vectors

- Duplicate signal generation (no `(variant_id, symbol, direction, ts)` UNIQUE in signals)
- Order idempotency (INSERT could duplicate on replay)
- Race condition: concurrent lifecycle + feature compute
- Cross-broker timestamp alignment (different clocks)

---

## 8. FINDINGS REGISTER

### CRITICAL

| ID | Finding | Evidence | Impact |
|----|---------|----------|--------|
| **F-1** | watukushay_no1 backtest TP/SL inverted | All 1,587 EURUSD trades: entry~1.174, TP=1.145 (<entry). RR=0.98. Verified `backtest_results` rows. | Entire 3-month backtest structurally invalid |
| **F-2** | Feature pipeline stalled ~50h | Latest ATR = Jul 17 10:38. `TM_DISABLE_FEATURE_JOBS=true`. Candle data = Jul 19. | All active strategies on stale features. Lifecycles frozen. |

### HIGH

| ID | Finding | Evidence | Impact |
|----|---------|----------|--------|
| **F-3** | No broker failover | `failover_mode=manual` for all symbols. `broker_session_leases` empty. | 1xTrade failure = total system blackout |
| **F-4** | watukushay_no1 has no risk config | YAML spec missing `risk:` block. Compiler fallback produces inverted SL/TP. | Spec incomplete. Backtest + live both invalid. |
| **F-5** | `market_volatility_profile` 9d stale | Latest `updated_at` = Jul 10 | Volatility gates resolve against stale distribution |

### MEDIUM

| ID | Finding | Evidence | Impact |
|----|---------|----------|--------|
| **F-6** | DXY spread 100% NULL | 12,433 rows, all spread IS NULL | Hidden if DXY ever routes to spread gate |
| **F-7** | Coverage metadata only for XAUUSD | candle_coverage: XAUUSD only, last Jul 11 | No coverage visibility for 9/10 symbols |
| **F-8** | 0 filled orders in system history | 26 orders, all rejected/expired | Live pipeline never executed. Gates too tight or routing broken. |
| **F-9** | Producer run ledger inaccessible | Query failed — column naming mismatch | Monitoring blind spot |
| **F-10** | 11h ingestion gap (Jul 17 14:37→01:40) | Presumed cause of feature-anchor freeze | Cascaded into 50h feature stall |

### LOW / INFORMATIONAL

| ID | Finding | Evidence |
|----|---------|----------|
| **F-11** | 4 registry features missing tables | volatility, regime, momentum, volume_profile never migrated |
| **F-12** | XAUUSD coverage ratio >1.0 | Daily break bars counted as extra |
| **F-13** | `confidence: 0` all backtest rows | Confidence scoring unimplemented for watukushay_no1 |
| **F-14** | 2 suspect USDSEK candles | Both flagged, 1376p range |
| **F-15** | Raw candles: USDJPY/XAUUSD scale mismatches | Brokers store prices in different units — expected, resolved by canonical view |

---

## 9. RISK MATRIX

| Risk | Rating | Notes |
|------|--------|-------|
| Data integrity | 🟢 LOW | Canonical layer resolves broker conflicts. OHLC structurally valid |
| Backtest reliability | 🔴 CRITICAL | One backtest invalid. May affect others |
| Feature freshness | 🔴 CRITICAL | 50h stale across ALL features |
| Live execution | 🟡 MEDIUM | 0 filled orders ever |
| System resilience | 🟡 MEDIUM | No broker failover. Worker off by default |
| Schema integrity | 🟢 LOW | Constraints correct. Migration guards working |
| Monitoring | 🟡 MEDIUM | Producer runs blind spot. Coverage 1/10 symbols |

---

## 10. FINAL VERDICT

**UNSAFE FOR LIVE DECISIONS — Backtest results cannot currently be trusted**

**Why:**

1. **watukushay_no1 backtest is structurally invalid.** TP below entry for every buy = guaranteed loss. The 1,587 results and derived metrics (win rate, Sharpe, drawdown) are meaningless. Any decision based on them — variant promotion, parameter optimization, capital allocation — is founded on corrupted data.

2. **Feature pipeline stalled ~50h.** ALL active paper strategies operate on stale features. Zone lifecycles frozen Friday afternoon. This compounds: a) stale ATR means wrong SL/TP distances, b) stale zones means wrong entry/exit levels, c) stale volatility means wrong gate thresholds.

3. **Remaining architecture is sound.** Canonical view layer correctly handles multi-broker conflicts. Schema constraints, migration guards, ingest resilience are well-engineered. Spread/OHLC data quality is high. PIT backtest discipline is correct.

**Immediate actions:**
1. Fix watukushay_no1 YAML spec — add proper `risk:` block with correct SL (atr*1.5) and TP (atr*2.0 or zone-based)
2. Restart feature pipeline — disable `TM_DISABLE_FEATURE_JOBS` or fix `getRecentCandles()` gap handling
3. Re-run watukushay_no1 backtest with corrected spec
4. Validate ALL other variant backtests for similar SL/TP inversion
5. Refresh `market_volatility_profile`
6. Implement broker failover monitoring
7. Investigate 0-fill rate — adjust entry drift threshold or order routing
8. Fix producer run ledger column naming for monitoring

---

*Generated 2026-07-19 ~23:00 UTC. All SQL queries executed read-only within `BEGIN READ ONLY` transactions against `tradzfx_v2` (TimescaleDB).*
