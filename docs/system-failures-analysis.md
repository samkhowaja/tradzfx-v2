# System Failures Analysis

Compiled 2026-07-13 after deep Strat 3 entry=0 investigation. Categories: **registry**, **compiler**, **backtester**, **pipeline**, **monitoring**, **operational**, **design**.

---

## F-01: `features_structure` defaultLookbackBars=8 too short for 1h TF

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Status** | ⚠️ Bandaid fix |
| **File** | `packages/strategies/src/featureRegistry.ts:219` |
| **Specs affected** | `gold_scalp_2_breaker_block`, `gold_scalp_3_choch_fvg`, `pb_blake_2026_smc` (indirect) |

### Description
`features_structure` registry default `defaultLookbackBars: 8` → 8h window at 1h. Structure BOS bullish events cluster outside trading hours (17:00, 00:00 UTC). Gap between BOS and next LONDON session bullish bias often exceeds 8h.

### Concrete example
July 10 00:00 UTC BOS strong bullish → next bullish bias 09:00 UTC (9h gap). 8h lookback misses by 1h. With 24h lookback, July 10 10:00 bias produces valid setup with zone + iFVG.

### Existing fix
Added `lookbackBars: 24` to `gold_scalp_2_breaker_block.yaml` and `gold_scalp_3_choch_fvg.yaml` `features_structure` conditions.

### Long-term solution
Registry defaults should be **TF-aware**. The same `defaultLookbackBars` value means very different time windows for 1m vs 1h vs 1d. Replace scalar `defaultLookbackBars` with a per-TF map:

```typescript
defaultLookbackBars: Partial<Record<TimeFrame, number>>;
// Example for structure:
// { "1m": 48, "5m": 24, "15m": 16, "1h": 24, "4h": 12, "1d": 5 }
```

Validate at seed-time: if a spec condition's `lookbackBars` + registry default < max session gap for that TF, emit a WARNING. Max gaps: overnight 14h, weekend 48h.

---

## F-02: No session-gap-aware lookback validation

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ❌ Not started |
| **File** | `packages/strategies/src/validate.ts` |

### Description
`validateSpec()` checks structural YAML validity but does **not** validate temporal plausibility: whether a condition's lookback window covers the maximum gap between consecutive allowed trading sessions.

### Impact
Strategies silently get 0 matches even when data exists, because the lookback window is too small for session gaps. Developer must manually debug SQL to discover the real cause.

### Solution
Add temporal validation in `validateSpec()`:
1. For each condition with a `tf`, compute `lookbackMinutes = (lookbackBars || defaultLookbackBars) * tfMinutes[tf]`
2. If any timeWindow gap > `lookbackMinutes`, warn
3. If gap > `lookbackMinutes * 2`, error
4. For weekend: calculate Fri 21:00 UTC → Sun 21:00 UTC gap (48h minimum for constant session sets)

---

## F-03: iFVG data sparseness limits entry candidates

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ❌ Not started |
| **File** | `features_ifvg` table |

### Description
`features_ifvg` has only ~8-10 rows for XAUUSD in 30-day window. First bullish iFVG appears July 3 2026. Combined with narrow structure lookback, temporal intersection of (bias × structure × zone × iFVG) approaches zero.

### Impact
Even with wider lookback, strat 3 gets only 1 entry candidate in 30 days.

### Solution
1. Increase iFVG producer comprehensiveness — ensure it detects FVGs on all valid displaced moves, not just winner-picked patterns
2. Add multi-tf iFVG detection (1m, 5m, 15m staggered so entry precision has options)
3. Backfill missing iFVG for earlier dates (script may have started late)

---

## F-04: Silent 0-entry output — no diagnostic feedback

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ❌ Not started |
| **File** | Compiler output, backtest runner |

### Description
When compiler produces 250 bias, 8 setup, 0 entry, there is **zero** diagnostic output explaining which condition failed. No per-stage counts with breakdown. No "why this entry was rejected" logging.

### Impact
Debugging requires manually running SQL fragments to cross-check each condition. Took hours to identify `lookbackBars` root cause.

### Solution
Add a **query plan explainer** mode to compiler:
```bash
node scripts/compile-strategy.js --strat gold_scalp_3_choch_fvg --explain
```
Output:
```
Setup stage:
  htf_bias_reversal: 250 matches
  htf_choch:        12 matches (filtered 238: no structure BOS in 8h window)
  htf_fvg_zone:      8 matches (filtered 4: zone outside 10d or fill>0.8)
Entry stage:
  ltf_ifvg_reversal: 0 matches (filtered 8: no iFVG in 24h window)
```

Each filter step shows count + constraint + dropped count. Use LATERAL with explanatory subqueries.

---

## F-05: Registry defaults not TF-scaled — linear scaling assumption

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ❌ Not started |
| **File** | `packages/strategies/src/featureRegistry.ts` |

### Description
`defaultLookbackBars` is a flat count. For `features_structure` (8 bars):
- At 5m = 40 minutes (fine for intra-session events)
- At 1h = 8 hours (misses overnight gap)
- At 1d = 8 days (too long — stale events)

One value cannot serve all TFs. Currently `features_zone` uses 96 bars:
- At 15m = 24h (reasonable)
- At 1h = 4 days (OK)
- At 1d = 96 days (potentially stale)

### Solution
TF-aware defaults (see F-01 solution). Alternative: make `lookbackBars` **required** in spec conditions, never fallback to registry default.

---

## F-06: No cross-feature temporal alignment visualization

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ❌ Not started |
| **File** | N/A |

### Description
No tool to visualize whether structure events, bias, zones, and iFVG temporally overlap on a timeline. Debugging temporal misalignment requires manual SQL queries and importing results into spreadsheets.

### Solution
Build a timeline visualization script (`scripts/debug-temporal-alignment.js`) that:
1. Queries all features for a (symbol, tf, window)
2. Produces a Gantt-chart-style ASCII or HTML output
3. Marks trading sessions, shows gaps between events
4. Highlights conditions that fail due to lookback limits

---

## F-07: PIT backtester diverges from compiler SQL

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ❌ Not started |
| **File** | `scripts/backtest-pit-v2.js`, `packages/strategies/src/sqlBuilder.ts` |

### Description
The PIT backtester (`backtest-pit-v2.js`) has its own SQL generation logic for setup/entry conditions. It differs from the compiler's SQL in:
- Lookback computation (legacy tf-tier fallback, different `MAX()` logic)
- `equalityGroupByDefaults` handling
- `joinPolicy` interpretation (especially `active_window` vs `candidate_set`)

The compiler SQL is the canonical source; backtester SQL is a fork that may miss fixes.

### Impact
Backtest results may diverge from live signals. A signal the compiler produces may not be found by the backtester, or vice versa.

### Solution
Refactor backtester to **use the compiler's SQL generation functions** directly from `packages/strategies/src/sqlBuilder.ts` instead of maintaining a separate SQL generator. The backtester should:
1. Load the compiled spec (JSON)
2. Call `buildSetupJoin()` / `buildEntryJoin()` from sqlBuilder
3. Parameterize with PIT timestamps
4. Execute generated SQL

---

## F-08: Session-scoped join policy not validated against registry

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Status** | ⚠️ Partially fixed |
| **File** | `packages/strategies/src/sqlBuilder.ts`, `packages/strategies/src/validate.ts` |

### Description
`features_opening_range` uses `joinPolicy: "session_scoped"`. The spec MUST declare a `session` field matching producer case (lowercase). SQL generation throws on mismatch, but validation only catches it at seed-time — a misconfigured condition in a running strategy causes 0 matches silently.

### Solution
Add runtime monitoring: if a condition with `session_scoped` join produces 0 matches for > N consecutive invocations, alert.

---

## F-09: Producer ledger can mask partial batch failures

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ✅ Fixed per AGENTS.md (SK-62) |
| **File** | `apps/engine/src/dag/runner.ts` |

### Description
`DAGRunner.insertRows` logged a failed INSERT but still recorded `status='done'` with `rows_inserted = attempted`. A fully-rejected batch appeared healthy.

### Fix applied
Uses `computePersistOutcome()`: on throw `status='error'`, `rows_inserted=0`, `rows_rejected=attempted`; on success, real `rowCount` and `rows_rejected = attempted - inserted`.

---

## F-10: Volatility percentile typo silent acceptance

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ✅ Fixed per AGENTS.md (SK-62) |
| **File** | `packages/tradePipeline/src/gates/volatilityGate.ts` |

### Description
`pctToColumn()` silently coerced unknown percentiles (e.g., `0.98`) to `p95`. Four live YAMLs had `0.98` intending p98 but getting p95.

### Fix applied
`pctToColumn()` now throws on unknown percentiles. `createVolatilityGate()` validates at load. YAMLs corrected `0.98 → 0.95`.

---

## F-11: iFVG `ts` semantics mismatch with lifecycle CHECK

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ✅ Fixed per AGENTS.md (SK-61) |
| **File** | `apps/engine/src/features/ifvg.ts` |

### Description
iFVG producer emitted `ts = last candle` (anchor) not `originating_zone_ts`. Already-invalidated FVGs had `invalidated_at < ts`, violating the `ifvg_inv_after_ts` CHECK constraint, freezing `features_ifvg`.

### Fix applied
Set `ts = originating_zone_ts` (formation time), matching `features_zone`/`features_order_block` and lifecycle/CHECK semantics.

---

## F-12: Feature cache key omits engine version

| Field | Value |
|-------|-------|
| **Severity** | High |
| **Status** | ✅ Fixed per AGENTS.md (SK-57) |
| **File** | `apps/engine/src/dag/runner.ts` |

### Description
`feature_cache` keyed by `(feature_name, input_hash)` without `engine_ver`. Bumping engine produced identical inputs → cache hit → returned pre-bump output, skipping recompute+persist.

### Fix applied
`buildCacheInputHash()` now includes `engine_ver` in hash. New keys: `1.2.0:<content>:XAUUSD:1h:<ts>`.

---

## F-13: Candle coverage ignores market calendar breaks

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ✅ Fixed per AGENTS.md (SK-10) |
| **File** | `packages/shared/src/utils/marketCalendar.ts` |

### Description
Candle coverage counted weekends/holidays as gaps, false-flagging coverage as low (XAU 91.9%). Metals have daily break at 21:00 UTC not modelled.

### Fix applied
Market-calendar-aware: FX 24/5 (Sun 21:00 → Fri 21:00 UTC), daily breaks per symbol. Coverage tool normalizes to tradable bars.

---

## F-14: Restart ordering not enforced — 39h outage

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **Status** | ✅ Fixed per AGENTS.md |
| **File** | `ops/restart-web-v2.ps1`, `conf/nginx.conf` |

### Description
DB/web admin-kill during Jul 6 restart dropped ingestion ~39h. MT5 EA couldn't connect, bars lost.

### Fix applied
Restart script gates on PG reachable + `tz-ingestion` online before restarting web. nginx exact-match `/api/ingest/mt5/bars` to port 3004. EA spools to file on send failure. MT4 clock fix (TimeLocal not TimeCurrent).

---

## F-15: No early warning for stale data clock

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **Status** | ❌ Not started |
| **File** | N/A |

### Description
The data clock (latest candle/feature timestamp) can lag wall clock by hours without alerting. Producer freshness gate exists but defaults to `warn` not `block`. No dashboard showing data-clock age per symbol.

### Solution
1. Build a `/api/health/data-clock` endpoint showing per-symbol feature lag
2. Configure PagerDuty/email alert when any required symbol > 30min stale
3. Flip `TM_PRODUCER_STALE_ACTION` to `block` after alerting is operational

---

## F-16: Spec `lookbackBars` silently falls back to registry default

| Field | Value |
|-------|-------|
| **Severity** | Low |
| **Status** | ❌ Not started |
| **File** | `packages/strategies/src/featureRegistry.ts`, `packages/strategies/src/validate.ts` |

### Description
When a spec condition omits `lookbackBars`, the registry default applies silently. No warning. No indication at seed-time that the default may be inappropriate for the condition's TF or required window.

### Solution
1. Add optional `lookbackBars` field to YAML schema validation
2. At seed-time, if a **required** condition uses a registry default (no explicit lookbackBars), emit a WARNING with effective lookback window in hours
3. Better: require `lookbackBars` on all conditions for experimental strategies, only allow registry default for well-vetted conditions

---

## Summary

| ID | Issue | Severity | Status |
|----|-------|----------|--------|
| F-01 | structure defaultLookbackBars=8 too short | Critical | ⚠️ Bandaid |
| F-02 | No session-gap lookback validation | High | ❌ |
| F-03 | iFVG data sparseness | High | ❌ |
| F-04 | Silent 0-entry output | Medium | ❌ |
| F-05 | Registry defaults not TF-scaled | Medium | ❌ |
| F-06 | No temporal alignment viz | Medium | ❌ |
| F-07 | PIT backtester diverges from compiler | High | ❌ |
| F-08 | session_scoped join not validated | Low | ⚠️ Partial |
| F-09 | Producer ledger masking failures | High | ✅ |
| F-10 | Volatility percentile typo | Medium | ✅ |
| F-11 | iFVG ts semantics mismatch | High | ✅ |
| F-12 | Feature cache key omits version | High | ✅ |
| F-13 | Candle coverage market calendar | Medium | ✅ |
| F-14 | Restart ordering — 39h outage | Critical | ✅ |
| F-15 | No stale data clock alerting | Medium | ❌ |
| F-16 | Silent registry default fallback | Low | ❌ |

**11 distinct unsolved issues** (F-01 through F-08, F-15, F-16); **5 solved** (F-09 through F-14, with F-08 partial).
