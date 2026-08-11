# Setup Accuracy Plan — the 12 professional setups vs our data — 2026-07-21

**Basis:** the 12 pro setups (see chat/report history), the 15d sweep (49 variants × multi-pair), the zone anatomy (foam/dupes/zombies), and the feature-readiness probe (`temp/_probe/readiness.js`, all numbers below measured 2026-07-21). This plan answers one thing: **what must be true in our data and setup generation for each of the 12 setups to execute with professional accuracy — and in what order we build it.**

---

## 1. Feature readiness matrix (measured)

Legend: ✅ usable now · ⚠️ exists but degraded/needs contract fix · ❌ dead or missing

| Capability (setup dependency) | 1m | 5m | 15m | 1h | 4h | 1d |
|---|---|---|---|---|---|---|
| Pivots (swing scope, LL→HH, structural SL) | ✅ lag 0–3h | ✅ lag 1–5h | ✅ lag 5–9h | ⚠️ sparse, lag 14–24h | ❌ lag 5–13d | ❌ **0 rows/15d, lag 21–40d** |
| Structure (BOS/CHoCH triggers) | ⚠️ **hyperactive ~70/day/sym** | ✅ 220–330/15d | ✅ 41–100/15d | ⚠️ stale 5.5d on AUD/EUR/GBP | ❌ 0–2 rows/15d | ❌ **0 rows/15d (22–81d stale)** |
| Sweeps (stop hunts) | ✅ | ✅ | ✅ XAU 100/15d | ✅ | ⚠️ thin | ⚠️ thin |
| Displacement | ⚠️ **over-fires: AUDUSD 774/15d ≈ 51/day** | ⚠️ same class | ⚠️ same class | ✅ thin | thin | thin |
| Zones (demand/supply/FVG) | ⚠️ foam 60%+ | ⚠️ foam 61% | ⚠️ foam 60% | ⚠️ zombies avg 3–23d old | ⚠️ zombies avg 23–42d | ⚠️ zombies avg **100–129d** |
| iFVG | ✅ | ✅ | ⚠️ "fresh" avg 20d true age | ⚠️ | ❌ | ❌ "fresh" avg 128d |
| Order blocks | ✅ | ✅ | ⚠️ | ⚠️ lag 4d | ❌ lag 8d | ❌ lag 36d |
| Session levels (`session_hl`) | — | ❌ 1,690h stale | ❌ 168d stale | ✅ lag 1–4h | ✅ lag 4–7h | ✅ lag 4–7h |
| Opening range per session | — | — | ✅ asia/london/ny all current | — | — | — |
| `zone_retest` (wick/close/engulfing flags at zone) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| MA periods 9/15/20/21/50/100/200/250 ema+sma + cross | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Direction arbiter | ⚠️ timid (78% ranging), dialect-split, confidence broken | — | — | ✅ | — | — |
| Candle patterns | ✅ ~380/15d | ✅ | ✅ | ✅ | ✅ | ✅ |
| Correlation (DXY) | — | — | ❌ DXY feed dead 4d+ | — | — | — |

**Read of the matrix:** the machinery for LTF setups (1m–15m) is mostly *present but undisciplined* (foam, over-firing, stale attributes). HTF context (4h/1d pivots, structure, OBs) is **dead** — anything needing daily/4h structure is currently built on fossils. That is why your strategies quietly became XAU-only scalpers.

## 2. Setup-by-setup verdict (buildable now?)

| # | Setup | Verdict | Blocking gaps (in dependency order) |
|---|---|---|---|
| 1 | HTF Demand Bounce + CHoCH | **Build now** (flagship) | #39 dedup, #40 age bounds, swing scope, limit entry (exists) |
| 5 | ORB + First Retest | **Build now** | `zone_retest` already has wick/close/engulfing flags; needs min-stop #30 + retest-TTL |
| 9 | MA Momentum Alignment | **Build now** | spec-only fix (express `fast>slow`, slope, price-vs-MA) — data has all periods |
| 4 | Sweep + Reclaim | Build after #42 | entry expressible today; kill rule ("exit on acceptance") needs **#42 setup-invalidation DSL** |
| 7 | FVG Pullback in Trend | Build after #40 + fill-as-of | age bound + as-of fill state for `zone_kind='fvg'` |
| 12 | London-sweep-of-Asia → NY | Build after #41 | session-scoped OR ✅ + sweep ✅; needs swing/HTF-level annotation |
| 2 | OB First Retest | Build after touch-as-of | `touch_count` as-of + age bound |
| 3 | iFVG Continuation | Build after #40 + date-pin | same-day confirmation pinning, age bound |
| 10 | Displacement Follow-Through | Mostly buildable | displacement threshold fix (#44) + FVG-left = existing zone kind |
| 6 | Breaker Block | Needs **#43 breaker derivation** (SQL view over zone+lifecycle — no new producer) |
| 8 | Range-Extreme Reversion | Needs range construct (pivot range + edge-touch count — v2; approximate with `zone_retest` counts at range edges) |
| 11 | Turtle Soup | Needs excursion-pattern feature (v2; crude approximation via sweep exists — accept lower fidelity or defer) |

## 3. The build plan (6 phases, each with an acceptance gate)

### Phase 0 — Data integrity floor (before ANY setup work means anything)
Items: **#39 zone identity + canonical-level view** (merge ladder rungs; compiler reads the view), **#40 max-age contract** (per-kind, per-tf `is_fresh` expiry — kills 20-day iFVGs and 129-day zones), **#32 bucket-TS fix** (floor at `resolveFeatureRowTs` + cleanup), **#35 coverage alerting** incl. producer-silence rule.
*Gate:* zones-per-setup median ≤ 3; dup-rate < 5%; no `is_fresh` level older than its contract age; off-bucket = 0 for 7 days.

### Phase 1 — Feature contracts (accuracy of what rows mean)
**#4B `detected_ts`** on pivot/structure/zone/ifvg/OB (PIT honesty); **as-of fill state** (`fill_pct`/`tapped`/`touch_count` computable at any anchor — PIT and live consistent); **#38 arbiter repair** (one writer, one dialect, fix confidence units, recalibrate neutral threshold); **#44 event-rate guards** — displacement threshold per-symbol-scaled (fix the 51/day AUDUSD over-fire), 1m structure confirmation tightening (fix the 70/day hyperactivity that feeds bare-trigger specs).
*Gate:* a replayed week shows identical setup lists between live-compile and PIT-compile on the same anchors; displacement ≤ 5/day/symbol at 15m; structure@1m ≤ 15/day/symbol.

### Phase 2 — Selection semantics (which level, from where)
**#41 swing-scoped join policy** (`scopeToSwing: true` on level steps; pivot-derived LL→HH range; **guard: `swingTf ∈ {5m,15m,1h}` — 4h/1d pivots are dead, error at seed otherwise**); **ranking rule**: `deepest_unmitigated_discount` per side (replaces `bottom DESC` — the drift-maximizing pick); **premium/discount from pivots** replacing the self-referential pricing feature for placement; **HTF-zone annotation** on level rows (containing 4h zone id/kind) so 1m scalps can see what they're inside.
*Gate:* premium/discount correctness ≥ 85% on keylevel-class setups (from 67%); HTF conflict visible and filterable; 0 setups ranked to ladder rungs.

### Phase 3 — Spec DSL upgrades (what a spec can say)
**#42 setup-invalidation DSL**: `invalidateIf:` on specs — `zone_mitigated`, `level_closed_through`, `bias_flip`, `bars_without_trigger: N`, `session_end` — compiled into both the harness and the live executor (parity); **#37 management schema** (`breakevenAtR`, `trailAfterR`, `partialAtR`); **#30 minStopPips** (three layers); per-entry **ttlMinutes** (#15).
*Gate:* setups #4, #5, #10 expressible verbatim including kill rules; harness and live produce the same verdict on a replayed week.

### Phase 4 — Minimal new derivations (no new raw producers unless unavoidable)
**#43 breaker view** (zone + `invalidated_at` + return-through → breaker rows, SQL-only); **range construct v1** (pivot range + `zone_retest`-count ≥2 per edge); **excursion pattern v1** (level + max excursion beyond + re-entry within N bars — powers Turtle Soup); **leg midpoint** (displacement row + candle 50% — computed in compiler from existing data).
*Gate:* setups #6, #8, #11 generate signals on historical windows with manually-verified correctness on 20 samples each.

### Phase 5 — Reference specs (prove the stack end-to-end)
Rewrite four flagships with the full discipline and freeze them as the template library:
1. **`pro_htf_demand_bounce`** (setup #1): `arbiter/bias@1h → swing-scoped deepest-unmitigated demand@15m (age-bounded, as-of-unmitigated) → CHoCH trigger@15m ttl=60m` · limit at zone top · SL below zone low (≥ minStop) · TP opposing swing · invalidateIf zone_mitigated|bias_flip|8 bars no trigger.
2. **`pro_sweep_reclaim`** (setup #4): `regime filter → session level (session_hl@1h) → sweep → reclaim within 3 bars ttl=30m` · limit at swept level · SL wick extreme · TP opposite range side · invalidateIf 2 closes beyond.
3. **`pro_orb_retest`** (setup #5): `opening_range(session) → displacement break → zone_retest wick/close flags ttl=90m` · limit at range edge · SL retest-bar other side ≥ minStop · TP range height.
4. **`pro_ma_alignment`** (setup #9): `bias@1h + bias@4h agree → MA fast>slow & rising@15m → pullback to MA zone + shift trigger` · limit at MA zone · SL pullback pivot low (features_pivot) · TP prior 1h high · trail after +1R (needs #37).
*Gate (all four, 60–90d backtest on the #29 harness):* drift p95 < 10 pips XAU / 2 pips FX; inverted-causality 0; loss avg |r_realized| ≤ 1.3R; per-setup accuracy panel (§4) green.

## 4. The accuracy panel (what we measure from now on — this is "data handling" made objective)

Per setup run, report these six numbers (the anatomy analyzers already produce most of them):
1. **Zones-per-setup** (target ≤ 3; today 6–21) — foam index.
2. **Dup rate** (target < 5%; today 60%).
3. **Level age at use** (target: within #40 contract; today iFVGs 20–128 days "fresh").
4. **Placement correctness** vs LL→HH (target ≥ 85%; today 67% keylevel, 25% smart_risk).
5. **HTF conflict rate** (target 0% taken; today smart_risk 100%).
6. **Fill drift** (target p95 < 10/2 pips; today avg 186 pips on XAU losses) + **consumed-zone pass rate** (target 0; today 283 in window).

## 5. What NOT to build (scope discipline)

- No new indicator families — the 12 setups need zero new indicators; they need the existing levels to be *true*.
- No 4h/1d structure-dependent specs until pivot/structure 4h/1d producers are repaired (they're 5–81 days stale — reviving them is part of #35, not a spec problem).
- No management tuning (#37 parameters) until Phases 0–3 land — you cannot tune exits on entries that don't exist yet.

## 6. Order + effort + dependencies (compressed)

```
Phase 0 (#39,#40,#32,#35)        L   everything depends on it
Phase 1 (#4B, fill-as-of, #38, #44) L   can parallel Phase 0 after #39
Phase 2 (#41 swing scope, ranking, HTF annotation)  M   needs Phase 0's dedup to be meaningful
Phase 3 (#42 invalidation, #37 mgmt, #30, #15)      L   independent of Phase 2
Phase 4 (#43 breaker, range, excursion, leg-mid)    M   after Phase 1–2
Phase 5 (4 flagship specs + 60–90d validation)      M   after Phases 2–3
```

After Phase 5: re-run the full matrix; the accuracy panel (§4) becomes the permanent pre-promotion gate (#19 promotion already requires a passing backtest — now it requires a passing *panel*).
