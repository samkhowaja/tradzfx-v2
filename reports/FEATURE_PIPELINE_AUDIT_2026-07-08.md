# Feature Pipeline Audit Report — tradzfx-v2

**Date:** 2026-07-08
**Auditor:** Professional Forex Trader (15+ years) + AI Code Analysis
**Scope:** All feature tables, their generation logic, and how the strategy compiler consumes them

---

## Executive Summary

This audit examines every feature table in the tradzfx-v2 pipeline — how features are generated from candle data, stored in PostgreSQL, and consumed by the strategy compiler to produce trading signals. The analysis covers 13 feature tables across the engine, shared types, database migrations, and the strategy compiler SQL generation.

**Primary Finding:** The strategy compiler uses a "latest as of" join pattern (`MAX(ts) <= s.ts`) for ALL feature tables. This pattern is correct for continuous-state features (pricing, bias, ATR, indicators) but **fundamentally broken** for discrete-event features (zones, structure events, sweeps, candle patterns, FVGs). At any moment, multiple zones/events coexist on a chart, but the compiler only sees the single most recent one. This is the root cause of most strategy signal failures.

---

## 1. `features_zone` — Supply/Demand, FVG, Breaker, iFVG

### What It Stores
ICT/SMC zones: supply, demand, FVG, breaker, iFVG. Each row has `zone_kind`, `top`, `bottom`, `direction`, lifecycle columns (`first_touch_at`, `mitigated_at`, `invalidated_at`, `fill_pct`), quality scores (`quality_score`, `strength_score`, `rank_score`), formation type (`rbr`, `dbd`, `rbd`, `fvg`, etc.), and retest counters (`touch_count`, `retest_count`).

### How It's Generated
`apps/engine/src/features/zone.ts` scans candles for:
- **FVGs:** 3-candle gaps where candle[1]'s range does not overlap candle[3]'s range
- **Supply/Demand:** Strong impulse candles (body ≥ 50% of range, volume ≥ 1.5× average) near pivot highs/lows
- **Breakers/iFVGs:** Derived from mitigated zones

Lifecycle is computed via `computeZoneLifecycle()` in `packages/shared/src/lifecycle.ts`, which forward-scans candles to find first touch, mitigation, and invalidation timestamps.

### How the Compiler Uses It
`buildZoneSignalSelect()` in `packages/strategies/src/compiler.ts`:
```sql
JOIN features_zone z ON s.symbol = z.symbol AND z.tf = '${zoneTf}'
  AND z.ts = (SELECT MAX(ts) FROM features_zone
              WHERE symbol = s.symbol AND tf = '${zoneTf}' AND ts <= s.ts)
```

### 🚨 CRITICAL: "Latest as of" Join Returns Only ONE Zone

This is the single biggest problem in the entire feature pipeline. The compiler picks exactly **one** zone — the most recently formed one. But a professional trader looks at **ALL active zones** on the chart. At any given moment there could be:
- 2–3 demand zones below price
- 2–3 supply zones above price
- Multiple FVGs waiting to be filled
- A breaker zone from a recently mitigated level

**Consequences:**
- If the newest zone is a supply zone but price is approaching a demand zone, the signal misses the demand zone entirely.
- If the newest zone is an FVG that already got filled, older but still-valid supply/demand zones are invisible.
- Retest logic (`tapped = true AND retest_count > 0`) can never fire correctly because only one zone is ever considered.

**What a 15-year trader expects:** The strategy should consider ALL zones that are:
1. Not invalidated (`invalidated_at IS NULL`)
2. Within a reasonable age (e.g., formed within last 50 bars)
3. In the correct directional context (demand for buys, supply for sells)

Then the entry logic should pick the **nearest** opposing zone for entry, not the **newest**.

### Other Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Zone width too narrow for supply/demand | Medium | Supply/demand zones use `candleBody()` + ATR buffer instead of the full impulse range + pivot. This makes zones too tight — price "blows through" them without triggering mitigation, producing false "fresh" zones. |
| FVG detection misses overlapping gaps | Low | The 3-candle FVG algorithm requires candle[1] and candle[3] ranges to not overlap. In volatile markets, wicks often overlap even when a real gap exists between bodies. Using bodies instead of full ranges would catch more valid FVGs. |
| No multi-timeframe zone confluence | High | Zones are computed per TF independently. A 15m demand zone that coincides with a 4H demand zone is much stronger, but the compiler has no way to express "zone exists on both 15m AND 4H." |
| `first_touch_at` = `mitigated_at` | Low | In `computeZoneLifecycle`, both are set to the same value (first wick/body intersection). For ICT/SMC, mitigation should require a CLOSE beyond the zone, not just a wick. This makes zones appear "mitigated" too early. |

---

## 2. `features_pricing` — Premium/Discount, OTE, Fibonacci

### What It Stores
Whether price is in premium (above 50% of recent range), discount (below 50%), or equilibrium, plus OTE (optimal trade entry) zone boundaries and Fibonacci position.

### How It's Generated
The pricing feature computes the 20-bar rolling high/low range, then determines where current price sits within that range. OTE is the 62–79% retracement zone.

### How the Compiler Uses It
Joined as "latest as of" in every signal builder:
```sql
JOIN features_pricing p ON s.symbol = p.symbol AND p.tf = '${pricingTf}'
  AND p.ts = (SELECT MAX(ts) FROM features_pricing
              WHERE symbol = s.symbol AND tf = '${pricingTf}' AND ts <= s.ts)
```

### Assessment: ✅ Fundamentally Sound
Premium/discount is a core ICT concept and the implementation is correct. The "latest as of" join is appropriate here — you only need the current pricing position.

### Minor Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Fixed 20-bar lookback | Low | The 20-bar range is hardcoded. For higher timeframes (4H, daily), 20 bars covers a very long period. A configurable lookback would be better. |
| No HTF pricing context | Medium | A 5m chart might show "discount" but the 4H chart might show "premium." The compiler can't express "5m discount AND 4H discount" for higher-conviction entries. |

---

## 3. `features_bias` — Directional Bias per TF

### What It Stores
Bullish/bearish/neutral bias per timeframe, based on market structure (higher highs/lows vs lower highs/lows).

### How It's Generated
The bias feature analyzes swing highs/lows to determine if the market is making higher highs+lows (bullish), lower highs+lows (bearish), or neither (neutral).

### How the Compiler Uses It
In `buildSetupCandidatesSql()`, bias is the primary filter:
```sql
JOIN features_bias b ON s.symbol = b.symbol AND b.tf = '${biasTf}'
  AND b.ts = (SELECT MAX(ts) FROM features_bias
              WHERE symbol = s.symbol AND tf = '${biasTf}' AND ts <= s.ts)
WHERE b.direction IN ('bullish', 'bearish')
```
Setup candidates are ONLY generated when there's a directional bias. Neutral markets produce zero candidates.

### Assessment: ✅ Correct for Directional Strategies
The "latest as of" join is appropriate — you need the current bias.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| No HTF bias alignment | High | The compiler supports `features_htf_bias` in predicates, but the setup query only joins ONE bias TF. A strategy requiring "5m bullish AND 4H bullish" can express the HTF part in the predicate, but the HTF bias join uses the same "latest as of" pattern — correct but means HTF bias changes rarely. |
| Neutral = no candidates | Medium | Range-bound markets produce zero signals. Some strategies (ORB, session HL) work well in neutral conditions but can't fire because the setup query filters them out. |

---

## 4. `features_indicator` — RSI, MACD, Stochastic, etc.

### What It Stores
Indicator values per timeframe — `indicator_name`, `value`, `period`.

### How the Compiler Uses It
Joined as "latest as of" in `buildIndicatorSignalSelect()`:
```sql
JOIN features_indicator i ON s.symbol = i.symbol AND i.tf = '${indicatorTf}'
  AND i.ts = (SELECT MAX(ts) FROM features_indicator
              WHERE symbol = s.symbol AND tf = '${indicatorTf}' AND ts <= s.ts)
```

### Assessment: ✅ Sound
The "latest as of" join is correct for indicators — you want the current RSI/MACD value at the time of the setup.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Single indicator per signal | Medium | The compiler joins only ONE indicator row. A strategy needing "RSI < 30 AND MACD histogram > 0" can't be expressed because only one `indicator_name` comes through. |
| No multi-TF indicator confluence | Medium | Can't express "5m RSI oversold AND 1H RSI oversold." |

---

## 5. `features_moving_average` — SMA, EMA

### What It Stores
MA values per `ma_type`, `period`, and `tf`.

### How the Compiler Uses It
In `buildMovingAverageSignalSelect()`, it joins TWO MA rows (fast and slow):
```sql
JOIN features_moving_average fast_ma ON ... AND fast_ma.period = ${fastPeriod}
JOIN features_moving_average slow_ma ON ... AND slow_ma.period = ${slowPeriod}
```
Plus a directional guard:
```sql
AND (
  (s.bias_direction = 'bullish' AND fast_ma.value > slow_ma.value)
  OR (s.bias_direction = 'bearish' AND fast_ma.value < slow_ma.value)
)
```

### Assessment: ✅ Well-Implemented
The dual join for fast/slow MA is the right pattern. The directional guard ensures MA alignment matches bias. One of the better-implemented signal sources.

### Issues: None significant.

---

## 6. `features_structure` — Market Structure (BOS, CHoCH, etc.)

### What It Stores
Market structure events — Break of Structure (BOS), Change of Character (CHoCH), liquidity sweeps.

### How the Compiler Uses It
Joined as "latest as of" in `buildStructureSignalSelect()`:
```sql
JOIN features_structure st ON s.symbol = st.symbol AND st.tf = '${structureTf}'
  AND st.ts = (SELECT MAX(ts) FROM features_structure
              WHERE symbol = s.symbol AND tf = '${structureTf}' AND ts <= s.ts)
```

### 🚨 CRITICAL: Same "Latest as of" Problem as Zones
Market structure events are discrete events, not continuous states. The "latest as of" join returns only the single most recent structure event. But a trader needs to know:
- Was there a recent BOS confirming the trend?
- Was there a CHoCH signaling a potential reversal?
- Was there a liquidity sweep at a key level?

These are different event types that can coexist. If the latest event is a "liquidity sweep," the fact that there was a "BOS" 3 bars earlier is invisible.

**What a 15-year trader expects:** The strategy should check for multiple structure events within a lookback window:
- "BOS in the last 10 bars" → trend confirmation
- "CHoCH in the last 5 bars" → reversal signal
- "Liquidity sweep above recent high" → trap entry

---

## 7. `features_sweep` — Liquidity Sweeps

### What It Stores
Liquidity sweep events — where price pierces a key level (previous high/low, session high/low) to hunt stops before reversing.

### How the Compiler Uses It
Joined as "latest as of" in `buildSweepSignalSelect()`:
```sql
JOIN features_sweep sw ON s.symbol = sw.symbol AND sw.tf = '${sweepTf}'
  AND sw.ts = (SELECT MAX(ts) FROM features_sweep
              WHERE symbol = s.symbol AND tf = '${sweepTf}' AND ts <= s.ts)
```

### Assessment: ❌ Same Structural Issue
Sweeps are discrete events. The "latest as of" pattern means you only see the most recent sweep, not all recent sweeps. The sweep lifecycle (`computeSweepLifecycle`) uses wick-touch for first contact and close-cross for mitigation, which is correct — but the compiler can only filter the single row it gets.

---

## 8. `features_opening_range` — ORB (Opening Range Breakout)

### What It Stores
Opening range high/low/midpoint per session (NY, London, Asia) per day, with configurable range minutes (5, 15, 30).

### How the Compiler Uses It
In `buildOrbSignalSelect()`:
```sql
JOIN features_opening_range o ON s.symbol = o.symbol AND o.tf = '${orbTf}'
  AND o.ts = (SELECT MAX(ts) FROM features_opening_range
              WHERE symbol = s.symbol AND tf = '${orbTf}' AND ts <= s.ts)
```

### Assessment: ✅ Feature is Sound, Minor Integration Issues
The ORB feature itself is well-implemented. The "latest as of" join is appropriate — you only need today's opening range.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| `tf` column is always `'1d'` | Low | Migration 011 backfills `tf = '1d'` and the feature's `serialize()` doesn't write `tf` — it relies on the DB default. The compiler passes `orbTf` from the spec, which is typically `'15m'` or `'5m'`. If the spec says `orbTf: '15m'` but the DB has `tf = '1d'`, the join silently returns nothing. In practice, specs use `orbTf: '1d'`, so this may not be actively breaking. |
| No session filtering in compiler | Medium | The compiler doesn't filter by `session`. If you want "NY ORB only," you can't express it in the predicate because `session` isn't in the translated columns. |

---

## 9. `features_session_hl` — Session High/Low

### What It Stores
Session high, low, open, close per session per day.

### How the Compiler Uses It
In `buildSessionHlSignalSelect()`:
```sql
JOIN features_session_hl sh ON s.symbol = sh.symbol AND sh.tf = '${sessionTf}'
  AND sh.ts = (SELECT MAX(ts) FROM features_session_hl
              WHERE symbol = s.symbol AND tf = '${sessionTf}' AND ts <= s.ts)
```

### Assessment: ✅ Sound, Same Minor Issues as ORB
The "latest as of" join is correct for daily session data.

### Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| Same `tf` mismatch risk as ORB | Low | `tf` is always `'1d'` in the DB. If the spec uses a different `sessionTf`, the join fails silently. |
| No session filtering in compiler | Medium | Can't filter by session in predicates. |

---

## 10. `features_candle_pattern` — Engulfing, Pin Bar, etc.

### What It Stores
Candlestick patterns — engulfing, pin bar, doji, morning/evening star, etc. — with direction and confidence.

### How the Compiler Uses It
Joined as "latest as of" in `buildCandlePatternSignalSelect()`:
```sql
JOIN features_candle_pattern cp ON s.symbol = cp.symbol AND cp.tf = '${candleTf}'
  AND cp.ts = (SELECT MAX(ts) FROM features_candle_pattern
              WHERE symbol = s.symbol AND tf = '${candleTf}' AND ts <= s.ts)
```

### Assessment: ❌ "Latest as of" is Wrong Here Too
Candle patterns are discrete events. If the latest pattern is a "doji" but 2 bars ago there was a "bullish engulfing," the engulfing is invisible.

**What a trader expects:** "Show me any engulfing or pin bar in the last 3 bars at this zone."

---

## 11. `features_fvg` — Standalone FVG Table

### What It Stores
A separate FVG table (migration 088) with `direction`, `top`, `bottom`, `age_bars`, `is_fresh`.

### How the Compiler Uses It
In `buildFvgSignalSelect()`:
```sql
JOIN features_fvg f ON s.symbol = f.symbol AND f.tf = '${fvgTf}'
  AND f.ts = (SELECT MAX(ts) FROM features_fvg
              WHERE symbol = s.symbol AND tf = '${fvgTf}' AND ts <= s.ts)
```

### Assessment: ❌ Same "Latest as of" Problem + Redundancy
This table partially duplicates `features_zone` (which already stores FVGs with `zone_kind = 'fvg'`). The standalone FVG table has fewer columns — no lifecycle tracking, no quality scores, no retest counters.

**Issue:** Unclear why both `features_zone` (with FVGs) and `features_fvg` exist. This looks like redundant schema evolution that should be consolidated.

---

## 12. `features_atr` — Average True Range

### What It Stores
ATR values per period per timeframe.

### How the Compiler Uses It
Joined in every signal builder for SL/TP calculation:
```sql
JOIN features_atr atr_5m ON s.symbol = atr_5m.symbol AND atr_5m.tf = '5m'
  AND atr_5m.period = 14
  AND atr_5m.ts = (SELECT MAX(ts) FROM features_atr
                   WHERE symbol = s.symbol AND tf = '5m' AND period = 14 AND ts <= s.ts)
```

### Assessment: ✅ Correct
ATR is a continuous value; "latest as of" is appropriate. Used for dynamic SL/TP sizing via `buildSlSql()` and `buildTpSql()`.

---

## 13. `features_correlation` & `features_spread`

### What They Store
DXY correlation and symbol spread data.

### How the Compiler Uses It
The compiler has `buildCorrelationJoin()` and `buildSpreadJoin()` helper functions, and `translatePredicate` supports correlation fields (`correlation_1h`, `correlation_4h`, `correlation_1d`, `divergence_detected`, `divergence_type`, `reference_symbol`). These are used in setup/entry predicates for filtering.

### Assessment: ✅ Correct
Auxiliary filters. The "latest as of" join is correct for current correlation/spread values.

---

## 🔴 Root Cause: The "Latest as of" Join Pattern

The single biggest architectural issue across the entire strategy compiler is the uniform use of:

```sql
JOIN features_xxx ON ... AND xxx.ts = (
  SELECT MAX(ts) FROM features_xxx
  WHERE symbol = s.symbol AND tf = '...' AND ts <= s.ts
)
```

### ✅ Correct for Continuous-State Features
These features represent a single current value — "latest as of" is exactly right:

| Feature | What You Get | Verdict |
|---------|-------------|---------|
| `features_pricing` | Current premium/discount position | ✅ |
| `features_bias` | Current directional bias | ✅ |
| `features_atr` | Current ATR value | ✅ |
| `features_indicator` | Current RSI/MACD value | ✅ |
| `features_moving_average` | Current MA value | ✅ |
| `features_opening_range` | Today's ORB | ✅ |
| `features_session_hl` | Today's session HL | ✅ |

### ❌ Wrong for Discrete-Event Features
These features produce multiple independent events that coexist — "latest as of" returns only one, discarding all others:

| Feature | What You Get | What You Need | Verdict |
|---------|-------------|---------------|---------|
| `features_zone` | Single newest zone | ALL active zones (not invalidated, within age window) | ❌ |
| `features_structure` | Single newest structure event | ALL recent BOS/CHoCH/sweep events within lookback | ❌ |
| `features_sweep` | Single newest sweep | ALL recent sweeps at key levels | ❌ |
| `features_candle_pattern` | Single newest pattern | ALL patterns in last N bars at the entry zone | ❌ |
| `features_fvg` | Single newest FVG | ALL unfilled FVGs within age window | ❌ |

### The Fix
The compiler needs **window-based joins** for discrete-event features instead of "latest as of." For example, zones should join as:

```sql
-- Instead of: z.ts = (SELECT MAX(ts) ...)
-- Use:
JOIN features_zone z ON s.symbol = z.symbol AND z.tf = '${zoneTf}'
  AND z.ts <= s.ts
  AND z.ts >= s.ts - INTERVAL '${zoneMaxAgeBars} bars'
  AND z.invalidated_at IS NULL
```

This returns ALL active zones within the lookback window. The predicate then filters which specific zone(s) to act on (e.g., "nearest demand zone below price").

This is a significant architectural change to `packages/strategies/src/compiler.ts` affecting `buildZoneSignalSelect`, `buildStructureSignalSelect`, `buildSweepSignalSelect`, `buildCandlePatternSignalSelect`, and `buildFvgSignalSelect`.

---

## 🟡 Secondary Issues Summary

| # | Issue | Affected Features | Impact |
|---|-------|-------------------|--------|
| 1 | No multi-timeframe confluence in compiler | All | Can't express "5m demand zone AND 4H demand zone" |
| 2 | `tf` mismatch risk for daily tables | ORB, Session HL | If spec tf ≠ '1d', join returns nothing silently |
| 3 | `features_zone` and `features_fvg` overlap | Zone, FVG | Redundant tables, unclear which to use |
| 4 | Zone mitigation = first touch (too early) | Zone | Zones marked mitigated on wick, not close |
| 5 | Supply/demand zone width too narrow | Zone | `candleBody()` + buffer instead of impulse range |
| 6 | No session filter in compiler predicates | ORB, Session HL | Can't target specific sessions |
| 7 | Single indicator per signal | Indicator | Can't combine RSI + MACD in one signal |
| 8 | Neutral bias = zero candidates | Bias | Range-bound strategies can't fire |

---

## 📋 Recommended Fixes — Priority Order

### P0 — Critical (Strategies Cannot Work Correctly Without These)

1. **Fix discrete-event joins in compiler:** Change zone/structure/sweep/candle-pattern/FVG joins from "latest as of" to window-based queries that return all active/recent events. This is the root cause of most strategy failures. Affects `buildZoneSignalSelect`, `buildStructureSignalSelect`, `buildSweepSignalSelect`, `buildCandlePatternSignalSelect`, `buildFvgSignalSelect` in `packages/strategies/src/compiler.ts`.

### P1 — High (Major Improvement to Signal Quality)

2. **Add multi-timeframe confluence:** Allow the compiler to join the same feature table at multiple timeframes (e.g., `features_zone` at both `'15m'` and `'4h'`) and express predicates across them. This enables "15m demand zone AND 4H demand zone" entries.

3. **Fix zone mitigation semantics:** Change `mitigated_at` to require a close beyond the zone (not just a wick touch). Use `first_touch_at` for wick touches separately. Affects `computeZoneLifecycle()` in `packages/shared/src/lifecycle.ts`.

### P2 — Medium (Quality of Life / Edge Cases)

4. **Add session filtering to compiler predicates:** Add `session` to the translated columns for ORB and Session HL signal builders in `translatePredicate()`.

5. **Consolidate `features_zone` and `features_fvg`:** Pick one table for FVGs. `features_zone` is richer (has lifecycle, quality scores, retest counters). Deprecate or merge `features_fvg`.

### P3 — Low (Nice to Have)

6. **Allow neutral-bias strategies:** Add a spec option (`allowNeutralBias?: boolean`) to generate setup candidates even when bias is neutral, for range-bound strategies like ORB.

7. **Support multiple indicators per signal:** Allow the compiler to join `features_indicator` multiple times with different `indicator_name` filters.

---

## Appendix: Files Examined

| File | Purpose |
|------|---------|
| `packages/strategies/src/compiler.ts` | Strategy → SQL compiler (all signal builders, predicate translator) |
| `packages/shared/src/lifecycle.ts` | Zone/sweep/iFVG lifecycle computation |
| `packages/shared/src/types/feature.ts` | All feature output TypeScript interfaces |
| `apps/engine/src/features/zone.ts` | Zone feature generation (FVG, supply/demand, breaker) |
| `apps/engine/src/features/openingRange.ts` | ORB feature generation |
| `apps/engine/src/features/sessionHl.ts` | Session HL feature generation |
| `infra/migrations/001_schema.sql` | Core feature table definitions |
| `infra/migrations/006_extensions.sql` | Zone extensions (is_fresh, quality_score) |
| `infra/migrations/008_opening_range.sql` | ORB table (original, before tf/ts migration) |
| `infra/migrations/009_session_hl.sql` | Session HL table |
| `infra/migrations/011_session_daily_tf_ts.sql` | Added tf/ts to daily tables |
| `infra/migrations/027_feature_lifecycle.sql` | Added lifecycle columns |
| `infra/migrations/032_incremental_lifecycle.sql` | Set-based lifecycle refresh |
| `infra/migrations/033_zone_direction.sql` | Added direction to zones |
| `infra/migrations/088_features_fvg.sql` | Standalone FVG table |