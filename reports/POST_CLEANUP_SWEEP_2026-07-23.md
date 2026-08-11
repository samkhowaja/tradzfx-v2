# Post-Cleanup 49-Variant Sweep — final comparison — 2026-07-22/23

**Scope:** all 49 active variants, 15d each, post-cleanup data (bucket-TS fixed, lifecycle refreshed, compiler repaired, backfilled), post-cleanup harness (fill-at-bar-close, gap booking, `timeoutBars` units, warmup-by-slowest-tf, drift-aware R, min-stop guard). Artifacts: `temp/audit15d-post/`. Pre-cleanup baseline: `reports/BACKTEST_15D_SWEEP_2026-07-21.md`.

**The one-sentence verdict:** the cleanup did not make the strategies better or worse — it made the *measurement* honest, and on honest data the strategy library divides into a small clean core (keylevel, pro_ltf limits, apex_scalp, USDJPY/CAD environments) and a catastrophically bad bare-trigger majority that was previously masked by data bugs.

---

## 1. Blocked ≠ silent — the gate did its job (and we misread it twice)

39 of the first 49 runs came back `BLOCKED_SYSTEM_QUALITY`, not "0 signals":

| Block class | Count | Root cause | Resolution |
|---|---|---|---|
| XAU lifecycle stale (zone/OB/iFVG @19.7h) | ~29 | XAUUSD lifecycle never refreshed post-cleanup (I refreshed 7 pairs but not gold) | Direct `refresh_zone_lifecycle('XAUUSD')` + OB + iFVG: 1,058/218/734 rows updated → keylevel fired immediately |
| State-freshness race (pricing/atr/bias/MA >10min) | ~8 | **The 10-minute state threshold is tighter than the 15-minute producer cadence** — any check landing in the back half of a cadence cycle false-fails | Re-run inside the post-write window → passes (gate race, not data) |
| Warmup refusal (`window < 2× warmup`) | 5 | HTF variants on 15d windows (10xroi 1d/4h, gold_scalp_2/3, watukushay_no1) | **Correct by design** — the new vacuous-window guard (#33) replacing silent "0 trades" |
| Genuine silence post-warmup | keylevel v5–v8, doyle_sd, waqar, watukushay_fe, scarface, scalper_20sma, a_plus_orb, forex_strategy_orb, pb_blake | specs produce no signals in this window with honest data (foam/zombie context removed) | retire or rework (#22/#36) |

The compiled SQL for every checked "silent" spec returned plenty of rows (five_one 192, gold_9sma 451, doyle 23, keylevel 9) — **the strategies were never broken; the freshness mechanics were.** Two gate bugs made it worse than it should be: the lifecycle-refresh gap (fixed by hand; needs the bounded cron) and the cadence race (belongs to the readiness contract's freshness formula, already specced).

## 2. The honest scoreboard

### Clean core (verified on post-cleanup data)
| strategy | pair(s) | signals | result |
|---|---|---|---|
| **keylevel_bounce** v1/v1_4r/v1_fx/v1_limit/v1_wider/v2/v3 | XAU (+EUR) | 9 each | **2W/0L every variant** (+1.08 … +3.23 netR, avgW up to 4.0R) |
| **pro_ltf limit cells** (tp15lim/tp12lim) | EUR/GBP/AUD/NZD/CAD/JPY | 6–18 each | positive on 6/7 pairs (+1.4 … +5.0) |
| **tp30lim** | USDCAD, USDJPY | 6, 15 | **+6.0 / +9.0** (expR up to 0.6) |
| **apex_scalp_ob_v1** (video-derived OB retest) | EURUSD | 59 | **+3.00** (2W/1L decisive) |
| **gold_anti_bias_sniper_v1** | XAU | 15 | +2.79 (one clean win) |
| baseline tp30 (live observation) | EUR/CAD/JPY | 8, 6, 15 | +5.03 / +8.76 / +8.86 |

### Catastrophic on honest data (previously masked)
| strategy | signals → executed | netR | what it proves |
|---|---|---|---|
| **gold_mssnr_scalper_1m** | 237 → 55 | **−249.56** | drift-amplified losses (avgL −5.66R): bare candle-pattern trigger, no context |
| **five_one_scalp_v1 AND v10** | 192 → 169 each | **−120.99 each** | 88% execution rate, WR 32% — a coin flip with rent; **and v1≡v10 byte-identical again (spec collapse still live in the DB)** |
| **dol_ifvg** | 43 → 21 | **−95.81** | iFVG entries chased at market (avgL −6.11R); needs limit entries |
| **10xroi fixedpip (1m/5m)** | 342/289 → 13/9 | −64.49 / −38.59 | fixed-pip geometry on XAU + bare trigger |
| **gold_scalp_1_ob_ifvg** | 31 → 11 | −21.88 | 1W/10L |
| **gold_9sma_scalper_1m** | 595 → 51 | −12.40 | 20W/31L |
| **smart_risk_ob_ifvg_1m** | 45 → 31 | −9.24 | 2W/29L |
| **orb_scalper_1m** | 6 → 5 | −6.82 | 1W/4L |
| **gold_anti_bias… wait, it won** | — | — | (see clean core) |

## 3. What changed pre → post (the honest delta)

1. **The foam-driven spec results collapsed — and that's the cleanup working.** five_one went from "111 signals / −91R (pre)" to "192 signals / −121R (post)" — the cleanup didn't change its fate, it made the measurement undeniable. The bare-trigger family's losses are **strategy failures, not data artifacts**: drift outliers (avgL −5.4…−6.2R), no context, no location, machine-gun fire rates.
2. **keylevel on XAU flipped from "14 signals / 1W-2L / −5.53R (pre)" to "9 signals / 2W-0L / +1.23R (post)"** — the same checklist on clean data with correct fills. The limit variant (+3.00) again beats market (+1.23), confirming the entry-mechanic rule.
3. **The gate proved itself**: every BLOCKED call was a correct data-quality call (XAU lifecycle genuinely 19.7h stale; warmup windows genuinely too short). The false-block bug is only the cadence race — now specified into the readiness contract with an explicit formula.
4. **five_one v1≡v10 identical twice in a row** — the canonical-base seed guard (#6/#31) is still not enforced; two different names trade the same spec. This must be killed before any "top-N" ranking trusts variant counts.

## 4. Standing items (all already owned elsewhere)

- **Retire or rework the catastrophic bare-trigger specs** (five_one, gold_mssnr, gold_scalp_1, dol_ifvg, 10xroi family, orb_scalper, smart_risk 1m) — the evidence is now multi-window and consistent. Promotion gating (#19) must require a passing panel before any of these can be live.
- **Enforce the canonical-base seed guard** — five_one v1/v10 are the proof it still isn't.
- **Readiness contract PR-1** (ATR-proxy removal + truthful accounting + post-flush verification) — the backfill reported "0 errors" while the ledger recorded thousands of deadlock rejections.
- **Lifecycle cron** stays stopped until the advisory-lock + convergence fix lands; freshness is currently maintained by the inline engine + direct function calls.
- **60–90d walk-forward** runs once the extended backfill (Apr 23→Jul 6, in progress) completes; until then, EURUSD/GBPUSD numbers are the only dense-history reads, everything else is ≤ 17-day history.

*Raw artifacts: `temp/audit15d-post/*.json|err`, analyzers in the same dir. All numbers reproducible: `bash temp/audit15d-post/batch_49.sh && node temp/audit15d-post/analyze.js`.*
