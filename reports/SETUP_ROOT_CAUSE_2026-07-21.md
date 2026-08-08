# Root-Cause Analysis of Bad Trading Setups — multi-pair, multi-TF — 2026-07-21

**Method:** the 49-variant single-symbol sweep PLUS a 24-run multi-pair matrix (watukushay ×4 pairs, doyle_sd ×4, orb_classic ×4, lewis ×2, a_plus_orb ×3, scarface ×2, waqar ×2, pb_blake ×2, others) — 15d each. **315 executed trades** decomposed per-trade: MFE/MAE in realized-R units, entry drift, session, 1h-bias alignment, direction_state arbiter alignment. Analyzers: `temp/audit15d/rootcause.js`, data `temp/audit15d/rootcause.json`. Total: **W=69, L=246, netR −494.2**.

---

## 1. The ranked root causes (by attributed lost R)

| # | Root cause | Losses | Lost R (share) | Evidence |
|---|---|---|---|---|
| **RC1** | **Entry fill mechanics — drift outliers** | 167/246 (68%) | **−485.2 (98%)** | avg drift 186 pips on XAU; fills at `ts+TF` land far from the setup's intended price |
| **RC2** | **No trade management (BE/trailing/partial exists NOWHERE)** | 17 | −11.3 direct, ~−100+ opportunity | avg MFE 1.84R on these losses; gold_9sma avg MFE **2.32R** with netR ≈ 0 |
| **RC3** | **Context-free specs (bare triggers, mostly counter-bias)** | ~100 of bare-trigger losses | ~−330 | 215/282 bare-trigger trades AGAINST 1h bias; with-bias WR 31% vs against-bias WR 19% |
| **RC4** | **Degenerate geometry (no minStop)** | 5 | −31.9 (−6.4 avg) | orb_classic EURUSD 2.4–3.3 pip stops; lewis 0.2-pip live signal |
| **RC5** | **Session toxicity (ASIA/day-open)** | 39 | −189.9 | ASIA WR 15%, avg drift 135p; LONDON WR 25%, drift 58p |
| **RC6** | **Direction arbiter is miscalibrated + dialect-split** | — | unpriced | 60% of trade-adjacent rows `neutral`, 78% `ranging`; same column holds BOTH `buy/sell` and `bullish/bearish` dialects; `confidence` degenerate (=1.0 always, known units bug) |
| **RC7** | **The multi-pair universe is fictional** | — | — | doyle_sd/waqar/scarface/lewis **silent on every FX pair**; when doyle fires on XAU it goes 0/6 with drift outliers; orb_classic on FX pairs = degenerate geometry |

### RC1 is THE root cause of root causes
68% of losses, **98% of lost R**. The mechanism is now fully traced: reverse-anchored signals fire when the *newest* element (root bar) completes → the fill happens one signal-tf later → market-order-at-level chases price that already left → and (pre-#29) planned-risk R amplifies the damage. **Live rejects these fills (drift guard, max 2 pips); the backtest books them.** Until the harness applies the same drift rule live uses, every backtest number is measuring a game you don't actually play.

The positive control proves it: `keylevel_bounce_v1_limit` — same checklist, same zones, **limit entry at the zone** — is the ONLY clean strategy in the matrix (WR 67%, +7.0R, MFE 2.74R). Every market-entry sibling bleeds.

### RC2 is the invisible one — and it's big
The simulator has **no break-even, no trailing, no partial** logic, and no spec declares any (grep-verified). Measured cost: 17 losses that were up an average of **1.84R** before dying at full SL; gold_9sma's trades travel **2.32R** in favor on average and net ≈ 0. A primitive "SL→BE at +1R" rule converts a meaningful slice of these. **This is a missing feature of the whole platform (spec schema + simulator + live executor), not of any one strategy.** New action item #37.

### RC3 — context works; its absence costs
With-1h-bias trades: **WR 31%**. Against: **WR 19%**. The bare-trigger specs (10xroi, five_one, gold_mssnr, orb_classic, dol_ifvg) fire against the 1h bias in 215 of 282 trades — mean-reversion triggers with no trend filter, taken counter-trend by construction. The fix is not better triggers; it's the missing chain (bias → location → trigger) — the exact architecture the progressive migration is for, extended to these families.

### RC4–RC6 — real but secondary
- **RC4**: 2–3 pip stops are noise; `minStopPips` (#30) kills it in one rule.
- **RC5**: ASIA session (and day-open minutes) concentrates both bad fills and bad outcomes. A session-open cool-down (or ASIA exclusion for drift-sensitive entries) is a one-line spec filter — but check per-strategy; some ORB specs are *designed* for session opens.
- **RC6**: the arbiter says `neutral`/`ranging` for ~60–78% of trade time, its `confidence` column is degenerate (always 1.0 — units bug), and the same `direction` column mixes `buy/sell` and `bullish/bearish` dialects (714 `sell` + 580 `buy` rows vs 5,679 `bullish` + 5,116 `bearish` rows — two writers, two dialects, one column). When it DOES agree (`agreement=true`), WR improves 20%→28% — the arbiter adds value; it's just timid, internally inconsistent, and unit-broken. New action item #38.

### RC7 — your "multi-pair" system trades one pair
FX-pair variants produced essentially zero trades in 15d (doyle_sd, waqar, scarface, lewis, smart_risk FX, watukushay gated everywhere). Either the feature coverage on FX pairs can't feed the specs (see §9 dead/sparse producers), or the specs' thresholds are XAU-calibrated. **Decision point: either invest in making FX pairs real (coverage first, then FX-tuned specs), or formally declare the system XAU-only and stop paying for the fiction.**

## 2. What is NOT the root cause (cleared by this analysis)

- **Bias feature quality**: with-bias trades meaningfully outperform (31% vs 19%) — the bias feature discriminates. It's under-used, not broken.
- **Zone lifecycle in the window**: 98.7% invalidated-coverage; ghost zones are not driving these losses.
- **The compiler (post-fix)**: chains compile as authored now; lewis-class silence is strictness/small-window, not dropped rules.
- **Timeouts**: zero timeout-outcomes in the entire matrix (all losses are decisive SL/TP/gap resolutions).

## 3. The fix order that follows from the numbers

1. **Entries first (RC1 = 98% of lost R):** #29 (r_realized + harness drift-gate=live), #34 (limit-only mean-reversion entries), fill-time validity. Expect: −485R of the −494R to either convert to rejections (honest) or disappear.
2. **Management second (RC2):** new **#37 — trade-management schema**: `breakevenAtR`, `trailAfterR`/`trailStepR`, `partialAtR` in spec risk blocks; simulator + live executor both implement it (parity). Test rule of thumb: BE at +1R on the matrix.
3. **Context third (RC3):** extend progressive chains to the bare-trigger families (or retire them — #22/#36); require bias/arbiter alignment where evidence supports it (31% vs 19% is a real edge).
4. **Discipline rules (RC4/RC5):** #30 minStop; session-open cool-down per spec.
5. **Arbiter repair (RC6):** new **#38** — one writer/one dialect for `direction_state.direction`, fix the degenerate `confidence`, recalibrate neutral/ranging thresholds; then re-measure its gating value.
6. **Reality decision (RC7):** FX-pairs: invest or abandon; don't leave 20+ fictional variants active.

## 4. Expected shape of results after RC1+RC2+RC3

- Signal counts drop ~40–60% (drift rejections, limit-only entries, context requirements).
- Loss distribution shifts from "−3R…−21R outliers" to "−1R mechanical stops + managed exits".
- WR rises toward the with-bias baseline (≈30%) before management tuning; the honest question stops being "why do we lose 20R on a stop" and becomes "is 30% WR at 3R enough" — which is a strategy question you can finally answer with clean numbers.
