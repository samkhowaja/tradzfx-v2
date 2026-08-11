# System Failure Map — why fixing one thing changes nothing — 2026-07-21

Companion to `DEEP_SYSTEM_AUDIT_2026-07-21.md` (architecture) and `BACKTEST_15D_SWEEP_2026-07-21.md` (49-variant evidence + all-features sweep). This document answers one question with evidence: **why does every bad outcome in this system have 3–5 simultaneous causes in different layers — and what does a fix have to span to actually move the numbers?**

---

## 1. The thesis, proven on your own trades

Every catastrophic number in the 15d sweep decomposes into a **chain** of defects, each in a different layer, each capable of zeroing the result on its own. Three representative chains:

### Chain A — 10xroi_v1_1m, −61.6R (and its −21R single trade)
1. **Spec design:** a bare `features_candle_pattern@1m` trigger — no bias, no location, no regime. 301 signals in 15d.
2. **Calendar/data handling:** fires at day-open/midnight-UTC candles — the worst liquidity of the day.
3. **Entry mechanics:** market fill one bar later; the fill is **395 pips** from the authored entry.
4. **Harness accounting:** R normalized by *planned* risk → the 20-pip real loss books as **−20.98R**.
5. **Parity:** live's drift guard (max 2 pips) would have *rejected* the fill — the backtest books it anyway.

→ Fix only accounting (#29): the trades are still 395-pip-drifted garbage, now honestly reported. Fix only entry mechanics: the spec still fires 301 noise signals. Fix only the spec: the harness still misprices everything else. **All five must move together for THIS number to become meaningful.**

### Chain B — keylevel_bounce_v1, −5.53R vs keylevel_bounce_v1_limit, +7.00R (same 14 signals)
1. **Entry mechanics:** market fill at `ts + 15m`; authored entry = zone edge; drift 100–270 pips. The limit variant *same signals, same zones* is green — placement, not edge.
2. **Accounting:** planned-risk R → losses book −3.2R where realized risk was −1R.
3. **Chain semantics:** inverted causality in 1/3 of trades — the entry event predates the bias bar that justifies it (reverse anchoring, §3.1.4). Only #16 kills this.
4. **Lifecycle-at-anchor vs at-fill:** the zone behind the Jul-9 win was formed 13:00 and **invalidated 13:01** — valid at the anchor (as-of check passes), dead before the 13:15 fill. Live (wall-clock `is_fresh=false`) would reject it; the backtest books the win. Backtest ≠ live, in backtest's favor.
5. **Feature identity:** **3 duplicate demand-zone rows for the same (XAU, 15m, 13:00)** — zone identity isn't unique; LATERAL picks arbitrarily.

→ Fix only the entry (limit): placement solved, but 1/3 of setups still have inverted causality and zones that die at 13:01 still pass the anchor check. Fix only causality: entries still chase. This is why #34 alone "changes nothing" — it needs #29 (accounting), #16 (semantics), and a fill-time validity check together.

### Chain C — five_one_scalp_v1/v10, −91.43R (identical results, twice)
1. **Seed governance:** v1 and v10 are byte-identical in the DB (canonical-base guard missing).
2. **Spec design:** bare `structure@1m` trigger; 98 of 111 signals executed — near-zero selectivity.
3. **Strategy quality:** WR 20.4% at ~2R — a coin flip with rent.
4. **(machinery here is *clean*: setup cache fresh-evaluated, 0 skips; fills fresh; R honest.)**

→ The uncomfortable corollary: some variants can't be saved by any platform fix. The machinery correctly reports a bad strategy. The fix is **retirement** (#36), not engineering.

## 2. The layer model — each layer can zero the results independently

| Layer | Defects (evidence) | If fixed alone, results are still wrong because… |
|---|---|---|
| **L1 Ops/runtime** | 7h outage, empty PM2 dump, no alerts (§0 audit) | …everything downstream computes on holes. |
| **L2 Data coverage** | bias@4h 21%, bias@1d 62%, session@1m 4%, 8 dead producers (§9 sweep) | …HTF context silently absent; steps match nothing or worse, match stale rows. |
| **L3 Feature integrity** | off-bucket ts fleet-wide since April; pivot/structure look-ahead (formation-ts); wall-clock attrs (fill_pct/tapped/quality) read at anchor; two lifecycle writers disagree (mitigated_at/fill_pct) | …the checklist reads the future *and* the present at once; backtest and live see different worlds. |
| **L4 Compiler/specs** | dropped root predicates (fixed, undeployed), dropped fan-out (fixed), v4 invalid, five_one collapse, tautology MA steps, 28 dormant variants | …the rules you wrote are not the rules that run. |
| **L5 Harness** | fill look-ahead (fixed), planned-risk R (open #29), gap/timeouts (fixed), synthetic closeTs (open), warmup-units (open #33), no drift gate (open), min-stop (open #30) | …the numbers are untrustworthy even when the logic is right. |
| **L6 Chain semantics** | reverse anchoring → stale authored entries, inverted causality in 1/3, entry events ≤83h old (TTL gap), no per-entry TTL (#15) | …the setup is a snapshot of old pieces, not a progression. |
| **L7 Execution/parity** | market-entry-at-level (drift disease), live rejects what backtest books (drift, dead zones at fill), gates fail-open (warn-only freshness, corr-cache poison, setup-throw → proceed) | …live and backtest play two different games; you can't transfer learnings either way. |

**Read the table vertically:** any single row fixed in isolation leaves six other reasons for the same bad numbers. Read it horizontally through one trade: a single keylevel trade passes through L2 (bias@1h off-bucket ts), L3 (zone row wall-clock attrs), L4 (spec compiled correctly *now*), L5 (planned-risk R), L6 (inverted causality), L7 (market fill at a dead zone). Six defects, one trade.

## 3. New findings from this round (interconnect checks)

- **Lifecycle coverage in the sweep window is healthy** (credit): XAU 15m zones 873 → 98.7% have `invalidated_at` populated; only 4 fresh zones older than 2 days (the #17 open-set rescan exposure is small *here* — it grows with zone age).
- **Setup-engine cache was clean this sweep**: every variant shows `N persisted, N evaluated, 0 context-hash skips`; no swallowed batch failures. The immortality bug (#3.2.8) didn't distort these runs — but stays unfixed for future ones.
- **New parity gap — validity is checked at the anchor, not at fill time.** Zones invalidated minutes after the anchor (13:00 → 13:01) pass the as-of check and the trade proceeds at 13:15. Fix: re-validate level-feature freshness at the *fill anchor* (`signal.ts + TF`), or make the fill itself conditional (limit entries do this naturally — the market re-touches the zone or you don't trade).
- **Inconsistent PIT stripping (v3 confirmed):** `fill_pct` and `tapped` are stripped in PIT, but `quality_score` is kept — and it's wall-clock-computed (§3.3.2). So keylevel_v3's backtest is *partially* leaked (quality) and *semantically different* from live (tapped/fill ignored). Decide per-attribute: either compute as-of-anchor in PIT (best) or strip consistently + keep live/backtest predicates identical.
- **Zone identity duplicates:** 3 rows for the same (symbol, tf, ts, kind) with diverging `mitigated_at` (02:11 vs 02:46) — the two lifecycle writers disagree *and* the producer emits non-unique identities. Needs a zone identity key (the order-block logical-identity migration 138-141 pattern already exists — extend it to zones).

## 4. The unified fix program — bundles that must land together

Order matters; each bundle has a measurable "you'll know it worked" check. Nothing here is optional-without-consequences; skipping a bundle leaves a named distortion in place.

**Bundle 0 — Ops spine (do first; nothing runs without it).** #0 commit+deploy pending fixes (compiler ×2, #20 timeouts), #1 restore stack, #2 data-edge + coverage alerting (#35 folded in), PM2 `save` discipline. *Check:* no alert silence > 15 min on any active symbol/feature; stale-dist warning gone everywhere.

**Bundle A — Feature truth (L2+L3).** #32 bucket-TS everywhere (fix at `resolveFeatureRowTs` + cleanup + per-contract CHECK that respects opening_range's completion-ts), #4B `detected_ts` for pivot/structure/zone/ifvg/OB, #17 lifecycle bundle (open-set rescan, one writer per lifecycle column, canonical candles), zone identity key, #24 ledger retention + ATR-storm backoff (87k errors/7d). *Check:* off-bucket = 0 for 7 days; coverage watcher green; PIT joins on structure no longer shift signal counts vs formation-ts (measure on one known window).

**Bundle B — Spec truth (L4).** #8 smoke test everywhere, #31 v4 + canonical guard + five_one reconcile, watukushay real MA relation, #36 retirement of the dormant ~28, #22 convert-or-retire the flat remainder. *Check:* 100% of active variants hydrate+compile; no two variants with identical content; every active variant has a stated reason to exist.

**Bundle C — Harness truth (L5).** #29 `r_realized` + drift stats + drift-gate=live mode, #30 minStopPips (three layers), #33 warmup-by-slowest-tf + window guard, real `closeTs`, then **re-run the full 49-variant 15d sweep as the new baseline**. *Check:* avg realized loss ≈ 1–1.3R except true gaps; no silent all-warmup-skipped runs; v1_limit-vs-v1 drift comparison printed.

**Bundle D — Chain semantics (L6).** #15 entry TTLs + #16 forward-causal chaining (+ fill-time/anchor consistency for level features). *Check:* inverted-causality = 0 in the anatomy pass; entry-age p95 < entry TTL; keylevel results re-measured — expect FEWER signals, later entries, honest outcomes.

**Bundle E — Live parity (L7).** #34 limit-only mean-reversion entries, #18 fail-closed gates then `TM_PRODUCER_STALE_ACTION=block`, drift-gate identical in harness and live (same `max_entry_drift_pips`), v3-class attribute divergence resolved (as-of compute or consistent strip). *Check:* a backtested trade and a live evaluation of the same setup reach the same verdict (replay-live-signals over one week, diff verdicts = 0).

**Anti-pattern to avoid:** landing, say, Bundle C alone and re-running the sweep — you'd get prettier numbers for the same bad trades (drift entries honestly accounted, still bad). The bundles are cheap enough together; they are worthless one at a time.

## 5. What changes when it's all done — set expectations now

- **Fewer signals** (retirements, entry TTLs, forward-causal, drift gate): expect −30–60% raw signal counts. That's the point.
- **Later, better entries**: limit-at-level + fill-time validity kills the 100–400-pip drift class entirely.
- **Honest R**: netR per family will *rise* from the absurd negatives (−61…−91R → realized-risk truth), not because trades improve, but because accounting stops amplifying drift.
- **Several "strategies" will still be red** — five_one-class bare triggers, orb_classic-class noise-stops. The platform's job is to make that *visible and attributable*, not to make them win. Final selection is yours, and for the first time it'll be based on numbers that mean something.
