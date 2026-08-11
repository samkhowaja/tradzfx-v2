# Setup Zone Anatomy — the basics, measured — 2026-07-21

**Question set (yours):** Do setups contain multiple confusing zones? Old FVGs? Which zone types does one setup contain from LL→HH, across timeframes, and how many? Method: 35 executed zone-family trades from the 15d matrix, each dissected at its signal anchor (zones valid at anchor within ±1.5 ATR, the compiler's own as-of lifecycle semantics), an LL→HH swing-range census per setup (pivot-confirmed ranges), plus a global inventory of what "fresh" zones/iFVGs/OBs exist. Scripts: `temp/audit15d/zoneanatomy.js`, `temp/audit15d/llhh.js`; data `zoneanatomy.json`.

---

## Z1. Your database doesn't hold zones — it holds zone FOAM (the root of "confusing zones")

**60–62% of all zone rows at 5m/15m are duplicate "ladder rungs"** (same symbol/tf/ts/kind/direction, >1 row) — max **36 rungs** for one level since Jul 1. Concrete proof, the Jul-9 keylevel win: **10 near-identical demand rows for the same 13:00 bar**, bottoms 4110.5→4111.1 in 10-cent steps, quality scores 0.29→0.65 scattered:

```
2026-07-09 13:00 demand/bullish [4110.6–4123.5] fill=1.00 tapped q=0.294 inv=13:01
2026-07-09 13:00 demand/bullish [4110.5–4123.5] fill=1.00 tapped q=0.294 inv=13:01
2026-07-09 13:00 demand/bullish [4110.6–4123.4] fill=1.00 tapped q=0.294 inv=13:01
... 7 more rungs, each ±0.1 ...
```

One real price level, ten rows. Every zone-consuming query then sees a crowd where there is one level. **Fix (new #39): zone identity + merge** — canonicalize zones by (symbol, tf, kind, direction, rounded level ±½ ATR tolerance) with a `logical_id` like order_block already has (migrations 138–141 pattern); producers merge/refresh the canonical row instead of inserting rungs; backfill a dedupe pass.

## Z2. Every setup sits in a zone crowd — and the pick among them is arbitrary

Per setup, zones **valid at anchor within ±1.5 ATR of entry** (not even counting the ladder inflation):

| family | zones near | same-dir | opp-dir | setups with >1 candidate | setups with dupes |
|---|---|---|---|---|---|
| keylevel (all variants) | **14.3** | **11.3** | 3.0 | 67–100% | 67% |
| gold_scalp_1_ob_ifvg | 21 | 15 | 6 | 100% | 100% |
| smart_risk_ob_ifvg_1m | 8.3 | 5.3 | 3.0 | 50% | 25% |
| dol_ifvg | 5.8 | 2.5 | 3.3 | 40% | 40% |

The compiler answers "is there a demand zone?" with 11 yes-votes and picks `ORDER BY bottom DESC LIMIT 1` — the rung whose bottom is closest to price, i.e. **the rung that maximizes entry lateness/drift** (the tightest possible edge). With a deduplicated level table (Z1 fix) the crowd collapses to the 1–3 real levels a trader would draw.

**LL→HH census (zones inside the pivot-confirmed swing range):** calm setups look sane (Jul-9 keylevel: 236-pip range, 9 zones@15m, 31@5m, 5@1h). Trend days are foam: **dol_ifvg Jul-9 00:00 — 1,121-pip range containing 177 zones@5m, 79@15m, 21@1h** (29 demand + 22 bull-FVG + 16 bear-FVG + 12 supply at 15m alone — both directions of every kind stacked inside the same range). A checklist asking "is there a zone?" in that soup is meaningless without identity, quality ranking, and direction exclusivity.

## Z3. Old FVGs — yes, and "fresh" is a lie of a label

- **90–100% of setups contain iFVGs older than 4h** (true age from `originating_zone_ts`): dol_ifvg 90%, keylevel 100%, smart_risk 75%, gold_scalp_1 100%.
- The **fresh iFVG inventory** is geriatric: EURUSD 15m fresh iFVGs average **479.6h (20 days)** true age, max 483.9h; EURUSD 1d: **3,063h ≈ 128 days**. `is_fresh=true` only means "not yet invalidated" — nothing bounds *age*. A 20-day-old unmitigated iFVG is context at best; it is not an entry trigger by any SMC standard.
- **Fix (new #40): age bounds in the level-feature contract** — `maxZoneAgeBars` per tf in the registry + spec validator warns when a spec has no age bound on trigger features; engine marks `is_fresh=false` past a per-kind max age (an iFVG older than ~2–3 days at 5m/15m is never fresh).

## Z4. Zombie "fresh" zones on FX pairs (lifecycle per-symbol evidence)

Fresh-zone average ages: EURUSD 1d supply **129 days**, GBPUSD 1d demand 100 days, EURUSD 4h FVG 42 days, XAUUSD 1h supply **23 days** — vs XAUUSD 15m demand 32h (healthy). This is the §3.3.3 open-set rescan bug with per-symbol numbers: zones older than the cursor window are never re-examined, so on the less-maintained pairs they live forever. **#17 (full open-set rescan) fixes the mechanism; #40's max-age caps the damage independently.**

## Z5. Consumed zones still trigger setups (283 in this window)

All 10 Jul-9 rungs: `fill_pct=1.00, tapped=true, invalidated 13:01` — formed and consumed in the same minute, yet valid at the 13:00 anchor. Globally: **283 XAU 15m zones since Jul 6 were consumed AND invalidated within 5 minutes of formation** — and each passes `invalidated_at > anchor`. In PIT mode the `fill_pct < 0.95` guard is *stripped* (stripPitLeaks), so backtests accept consumed zones; live reads current-state fill and may pass them too (fill was ~0 during the forming bar). **Fix (part of #29/#4B-family): level features need fill-state *as-of anchor* in both modes — and the anchor for "was it consumed" must be the fill anchor (`ts + TF`), not the signal bar open (§3 parity gap).**

## Z6. Placement correctness vs the swing structure (LL→HH)

Entries on the correct side of the range (buy in discount ≤50%, sell in premium ≥50%):

| family | premium/discount correct | HTF (4h) zone conflict |
|---|---|---|
| keylevel (all) | 67% (v2: 33%) | 0% |
| dol_ifvg | 50% | **50%** |
| smart_risk_ob_ifvg_1m | **25%** | **100%** (4/4 buy-inside-4h-supply or sell-inside-4h-demand) |
| gold_scalp_1 | 0% | 0% |

keylevel's `features_pricing` position mostly agrees with real pivot structure (67%), but a third of its setups and nearly all smart_risk setups **enter on the wrong side of the actual LL→HH range** — the pricing feature's internal range window is not the trader's swing range. And smart_risk's 1m OB entries fight the 4h zone they sit inside 100% of the time. **Fix (new #41): premium/discount must be computed from confirmed pivots (features_pivot), not a self-referential range feature; 1m scalping specs must declare an HTF-zone-awareness step (or the engine auto-annotates containing-HTF-zone on every level row).**

## Z7. How many zones do we have? (inventory answer)

- **Per setup:** 6–21 valid zones within ±1.5 ATR (should be 1–3 after Z1 dedup); inside a wide swing range: up to 177@5m / 79@15m / 21@1h.
- **Per market (is_fresh=true, XAUUSD):** 15m: 10 demand / 8 fvg / 0 supply — 1h: 0 demand / 5 fvg / 19 supply — 4h: 0/4/5 — 1d: 0/4/5. Note the imbalance: XAU currently offers **zero fresh demand zones at 1h/4h/1d** — long setups on HTF context literally have nothing valid to stand on right now.
- **Types present per setup (LL→HH):** demand, supply, fvg (bull/bear) from the zone table; iFVGs (0–4 in window, mostly >4h true age); OBs (0–2 near price, 35–340h avg age on FX).

## Action items added to the plan

- **#39 (Tier 1, L): zone identity + dedup** — `logical_id` for zones (OB pattern), producer merge, dedupe backfill; the compiler then ranks candidates by quality within one identity. *This is the single highest-leverage data fix: it turns foam into levels.*
- **#40 (Tier 1, S): max-age contract for level features** — registry + engine `is_fresh` expiry + validator warning for specs missing age bounds.
- **#41 (Tier 2, M): structure-true premium/discount** — compute from `features_pivot`; auto-annotate containing-HTF-zone on level rows; require HTF-zone-awareness for 1m scalps.
- (#29/#4B already cover as-of fill-state; #17 covers zombie rescan; add "fill anchor = ts + TF" to the validity check.)

*All numbers reproducible: `node temp/audit15d/zoneanatomy.js && node temp/audit15d/llhh.js`.*
