# 15-Day Backtest Sweep + Setup Anatomy Audit — 2026-07-21

**Scope:** every active variant (49) backtested 2026-07-06 → 2026-07-21 on its primary symbol (`backtest-pit-v2.js <SYM> 15 <variant> --json --trades`, mode=full, setupProfile=strict, intrabar=sl_first), plus a per-trade anatomy pass (feature chain rows, ages vs TTL, direction coherence, fill latency, geometry) over the first 25 trades of each variant. Raw artifacts: `temp/audit15d/*.json|err`, `temp/audit15d/anatomy.json`, runner `temp/audit15d/analyze.js`.

**Cost model:** none (per your standing instruction) — no slippage/spread/commission anywhere below.

---

## 0. First: three things you need to know before reading the numbers

1. **Your fixes were in `src/` but the compiled `dist/` was stale** — the backtester, seeder and the web app all run `packages/strategies/dist`, and it predated the migration fixes (the runner itself warned). I rebuilt (`pnpm -r build`). **Any running web/PM2 instance is still on the old compiler until redeployed** — redeploy before trusting live behavior.
2. **Two compiler bugs surfaced the moment the sweep ran, fixed during this audit** (uncommitted so far — your call on committing): progressive `entry_signals` never projected `signal_direction` (crashed every progressive backtest — `compiler.ts:522-540`), and the flat compiler only projected it for `signalSource: generic` (crashed 12 flat variants: gold, orb, smart_risk… — `compiler.ts:768-772`). Both now always project (`NULL::text` fallback → `COALESCE(e.signal_direction, e.bias_direction)` works everywhere). Compiler suite: 93/93 green.
3. **Not everything is implemented.** Verified landed: fill look-ahead fix, gap-through booking, spec-hash fix, `ACTIVE_STATUSES`, 23505 savepoint, paper/live poll guard, wall-clock staleness guard, root-predicate + fan-out validation, smoke test, linear lewis chain, structure freshness in progressive mode, `stripPitLeaks` (fill_pct/tapped PIT stripping). **Verified NOT landed:** `keylevel_bounce_v4` still has no `htf_bias` predicate → **fails the new validator** (its 15d run also blocked by data, see §3-F); R normalization by planned risk (§3.2.12) — **unfixed, and it's the biggest number-distorter below**; synthetic `closeTs` (= ts + holdBars minutes, not the real exit bar); `detected_ts` (#4B); forward-causal chaining (#16); entry TTLs (#15 — structure-freshness port exists, per-entry TTL doesn't); per-spec timeout policy (#20).

---

## 1. Sweep results (15d, primary symbol per variant)

| Variant | Sig | Exec | W | L | Net R | Verdict class |
|---|---|---|---|---|---|---|
| keylevel_bounce_v1_limit | 14 | 3 | 2 | 1 | **+7.00** | Only green keylevel — LIMIT entries |
| 10xroi_v1_5m | 94 | 5 | 1 | 4 | +5.17 | noisy-positive |
| orb_scalper_1m | 8 | 3 | 1 | 2 | +0.24 | flat |
| gold_9sma_scalper_1m | 257 | 19 | 8 | 11 | +0.19 | flat at 257 signals |
| smart_risk_ob_ifvg_1m | 7 | 4 | 1 | 3 | −0.86 | slightly red |
| keylevel_bounce_v1_wider | 14 | 3 | 1 | 2 | −2.70 | drift-bleeding |
| keylevel_bounce_v2 | 14 | 3 | 0 | 3 | −2.88 | drift-bleeding |
| keylevel_bounce_v3 | 14 | 3 | 1 | 2 | −4.53 | drift-bleeding |
| keylevel_bounce_v1_4r | 14 | 3 | 1 | 2 | −4.53 | drift-bleeding |
| keylevel_bounce_v1 | 14 | 3 | 1 | 2 | −5.53 | drift-bleeding |
| 10xroi_v1_5m_fixedpip | 94 | 5 | 1 | 4 | −4.22 | noisy-red |
| keylevel_bounce_v5_shorts | 2 | 1 | 0 | 1 | −7.82 | one-gap-loss |
| keylevel_bounce_v6_ny_overlap_shorts | 2 | 1 | 0 | 1 | −7.82 | one-gap-loss |
| orb_classic | 8 | 3 | 0 | 3 | −8.23 | **degenerate 2–3 pip stops** |
| gold_mssnr_scalper_1m | 81 | 9 | 3 | 6 | −57.66 | drift disaster (−9.9R avg loss) |
| dol_ifvg | 11 | 10 | 2 | 8 | −62.74 | drift disaster |
| 10xroi_v1_1m | 301 | 11 | 3 | 8 | −61.60 | drift disaster |
| 10xroi_v1_1m_fixedpip | 301 | 12 | 1 | 11 | −75.91 | drift disaster |
| five_one_scalp_v1 | 111 | 98 | 20 | 78 | −91.43 | machine-gun, WR 20% |
| five_one_scalp_v10 | 111 | 98 | 20 | 78 | −91.43 | **byte-identical to v1 — spec collapse live in DB** |
| watukushay_no1 | 79 | 0 | — | — | 0 | gates vetoed everything (22 vol, 8 setup) |
| 10xroi_v1_1d / v1_4h | 8 / 278 | 0 | — | — | 0 | **100% warmup-skipped — untestable at 15d** |
| keylevel_bounce_v4 | 0 | 0 | — | — | — | **invalid spec (validator) + blocked data (bias@4h 33%)** |
| a_plus_orb_fvg_5m, forex_strategy_orb | 0 | 0 | — | — | — | preflight-blocked: features_zone@5m stale (today's outage) |
| gold_scalp_1_ob_ifvg | 1 | 1 | 0 | 1 | — | dead (1 signal) |
| gold_anti_bias_sniper_v1 | 2 | 0 | — | — | 0 | dead (2 blocked) |
| gold_scalp_2_breaker_block | 11 | 0 | — | — | 0 | silent |
| gold_scalp_3_choch_fvg | 1 | 0 | — | — | 0 | silent |
| keylevel v5_longs, v7, v8_levels, v8b, v8c | 0–2 | 0 | — | — | 0 | silent |
| lewis_kelly_smc_ny_shorts | 0 | 0 | — | — | 0 | silent post-linearization |
| doyle_sd, scalper_20sma_1m, scarface_5m_orb, waqar_v2, waqar_ebook_v1, watukushay_fe, xauusd_v1, keylevel_bounce_v1_fx, smart_risk sniper + 3 runon + _fx | 0–7 | 0 | — | — | 0 | silent / dead |

Headline: **2 of 49 variants are meaningfully green, 6 are catastrophically red, and ~28 are dead or silent.** The reds are not random strategy noise — they share one mechanical signature, below.

---

## 2. THE dominant finding: the entry-drift disease, now measured end-to-end

The catastrophic reds all show the same trade shape — **the fill is 50–400 pips away from the authored entry**, the SL sits a normal distance from the *authored* entry, and the loss gets normalized by the *planned* risk:

| Trade (from anatomy.json) | drift | SL dist | loss booked |
|---|---|---|---|
| 10xroi_v1_1m sell 2026-07-13 00:15 | **395.5 pips** | 19.8 | **−20.98R** |
| 10xroi_v1_1m sell 2026-07-13 01:30 | 351.2 | 27.1 | −13.98R |
| dol_ifvg buy 2026-07-07 12:00 | 271.2 | 25 | −11.85R |
| gold_mssnr sell 2026-07-13 15:46 | 268.3 | 18.0 | −15.87R |
| keylevel_v1 sell 2026-07-16 14:15 | 270.7 | 50 | −6.41R |
| orb_classic sell 2026-07-20 13:30 | 18.8 | **2.6** | **−8.23R** |

Mechanics, in order of causation:

1. **Authored entries are stale by construction.** With reverse-anchored semantics, the signal fires when the *newest* element (root bias bar) completes — but the entry price is authored from an *older* element (zone edge, pattern reference). The fill happens at `signal.ts + TF` (the #3 fix, correct), i.e. 1–15+ minutes later, at wherever price ran to. Mean-reversion entries at zone edges chase price that already left — exactly the trades a limit order would skip.
2. **R is normalized by *planned* (authored) risk, not realized risk** (§3.2.12 — unfixed). Loss = |fill − SL| / |authored − SL|. A 20-pip real loss becomes −21R when the fill is 400 pips from the authored entry. **Until this is `r_realized = PnL / |fill − SL|`, every netR in your reports is distorted in proportion to drift.** The right harness contract also mirrors live: live has `max_entry_drift_pips` (default 2) and would have *rejected every single one of these fills* — which is why live shows 25/29 rejections while backtests book −3R…−21R. Live and backtest currently evaluate two different games.
3. **The killer proof it's placement, not edge:** `keylevel_bounce_v1_limit` (same checklist, LIMIT entry at the zone) is **+7.00R** while the market-entry `v1` is **−5.53R** on the same 14 signals. Your own data says the setups are fine and the entry mechanic is the difference.
4. Drift clusters at day-open/midnight UTC on XAUUSD — session-open candles + daily-break edges (Sun 21:00 reopen, XAU 21:00 break) produce the worst fills. Anything firing at day-open needs explicit treatment (wait-one-bar rule or session-open exclusion).

**Actions (new, add to plan):** (a) harness: report `r_realized` + drift distribution per trade, and apply the same `max_entry_drift_pips` gate live uses (mark them rejected, don't book them); (b) specs: zone-edge/iFVG/OB entries MUST be `entryConfig.type: limit` (the mean-reversion families); (c) validate: warn when a spec authors entry at a level feature but uses market entry.

## 3. Failure classes C–G

**C. Degenerate geometry is in production results, not just theory.** orb_classic runs 2.4–3.3 pip stops on EURUSD (`orb_midpoint` sizing) → one 18.8-pip drift = −8.23R. Live showed the same class (lewis 0.2-pip SL, Jul 8). **There is no minimum-stop-distance validation anywhere** — add `minStopPips` per symbol to the geometry validator (fail-closed; XAU < $1, majors < 3 pips = reject).

**D. Warmup-units trap makes HTF variants untestable.** `10xroi_v1_1d`: all 8 signals `warmupSkipped` — 96 warmup bars × 1d = ~4.5 months > the 15-day window. `v1_4h`: 278 signals, same fate. **A 15d backtest of a 1d/4h variant is vacuous by construction.** Fix #20's bar-anchored warmup must size to the *slowest feature tf in the spec*, and the runner should refuse HTF variants on windows < ~2× warmup with a clear message instead of reporting "0 trades".

**E. Spec collapse is live in the DB.** `five_one_scalp_v1` and `v10` have byte-identical `overrides` (md5 `99914b93…` ×2) and produced byte-identical results (111/98/20/78/−91.43). The canonical-base guard (#6) is still not enforced at seed. Also: five_one's spec is a bare `features_structure@1m` trigger with **zero setup context** — 98 of 111 signals executed, WR 20.4%. That's not a strategy, it's a coin flip with rent.

**F. The silence class decomposes into four real causes** (don't read "0 trades" uniformly):
- *Preflight-blocked (data):* a_plus_orb_fvg_5m, forex_strategy_orb — `features_zone@5m` stale 6.4h+ (today's outage echo); keylevel_v4 — `features_bias@4h` XAU = **19 rows in 15 days** (expected ~90; 33% density → BLOCKED). `features_bias@1d` XAU = 8 rows/15d. `features_session@1m` = 4% coverage. These are producer-coverage holes nobody is alerted on (Tier-0 alert item #2 should include per-(feature,tf,symbol) coverage, not just candle edge).
- *Invalid spec:* keylevel_v4 fails the new validator (`htf_bias` no predicate) — it can't seed; the DB row it runs from is pre-validator. Fix the YAML (predicate + ~480 TTL) or retire the variant.
- *Over-strict post-fix:* lewis_kelly (0 signals since linearization — htf_bias 4h + premium + retest + NY session + shorts rarely align in 15d; likely correct behavior, small window) — verify with a 60–90d run before judging.
- *Genuinely dead:* most gold_scalp_*, waqar_*, watukushay_fe, xauusd_v1, doyle_sd, scalper_20sma, scarface — zero signals in 15d. Decide convert-or-retire (#22) with data, not sentiment.
- *watukushay_no1 is a special case:* 79 signals, 0 executed — the tautology MA steps (§3.4.2) let the chain fire ~5×/day, and the gates correctly vetoed everything (22 volatility, 8 setup-block). The gates saved you from a spec that currently encodes no filter beyond "1h bias row exists". Fix the spec (real MA relation) — don't celebrate the silence.

**G. Non-bucket-aligned feature rows — data-integrity bug, with a smoking gun.** `features_bias@1h` XAUUSD contains **duplicate rows per bucket**: `13:00:00.000` **and** `13:00:28.840`, then `13:15:27.384`, `13:30:27.375`, `14:00:26.486`, `14:15:25.874`… — one writer stamps bucket-start, another stamps **wall-clock run time** (the 15m inline trigger recomputing 1h bias and keying rows at `now()`). Verified: 15m bias/pricing/1h atr are clean (0 off-bucket); it's `bias@1h` (at least XAUUSD). Consequences observed in this sweep: a keylevel signal inherited ts `14:15:25.874Z` from such a row → fractional signal ts → poisoned dedup fingerprints (each fire is unique → the §1.3 retry loop class), skewed TTL math, and PIT joins that can't decide which row is "the" 14:00 bias. **Action:** find the writer stamping wall-clock ts (engine 1h-bias path), stamp bucket-start instead, add a producer invariant + a DB CHECK (`ts = time_bucket(tf, ts)`) to dense features, and dedupe existing rows keeping bucket-aligned ones.

## 4. TF-communication & feature-age anatomy (your core question)

Measured per trade: each chain step's matched row age vs its parent, TTL compliance, entry-event age, causality direction.

**What's healthy:**
- keylevel chain: `bias@1h → pricing@15m → zone@15m` — pricing median 0m, zone median 0–60m, max 105m, **100% within TTL (240m)**. The TFs ARE communicating inside the declared windows for this family.
- Entry freshness is good where entries are event-driven at the trigger TF: five_one `structure@1m` 1–6m old; keylevel `structure_break`/`zone_retest` 0m at the anchor; smart_risk `sweep@5m` 0–25m.

**What's wrong:**
- **Inverted causality in 1 of 3 keylevel trades**: the entry event is OLDER than the root bias bar (allowed by reverse anchoring — §3.1.4). You're buying the retest of a zone that formed *before* the bias that supposedly justifies it. This is your "past noise as trading angle" complaint — measurably still present, and only #16 (forward-causal) kills it.
- **The worst variants have NO TF chain at all**: 10xroi (bare `candle_pattern@1m`), gold_mssnr (bare `candle_pattern@1m`), five_one (bare `structure@1m`), orb_classic (bare `displacement@15m`). No bias, no location, no regime — a trigger with no context. As a professional review: these are not setups; they're alerts. Either give them a chain (bias → location → trigger) or retire them (#22).
- **HTF features are too sparse to communicate**: bias@4h 19 rows/15d on XAU means the 4h→1h→15m conversation mostly doesn't happen — v4/v5/v6 silence is partially *data*, not design.

## 5. Entry / SL / TP — professional-trader verdict per family

- **keylevel (progressive, limit variants):** structurally sound checklist (bias → pricing position → zone → structure/retest), sane geometry (50/150 pip SL/TP at 3R on XAU). Verdict: **keep, but limit-only**; kill market entries; fix inverted causality via #16 before trusting v5–v8.
- **orb_classic / orb_scalper:** ORB concept fine, geometry broken (2–3 pip midpoint stops on EURUSD = noise; XAU better). Verdict: add min-stop + session-open drift handling before any judgment.
- **smart_risk_ob_ifvg_1m:** concept coherent (sweep → iFVG), low sample (7 signals), near-flat. Verdict: too little data at 15d; run 60–90d.
- **10xroi / gold_mssnr / five_one (bare-trigger family):** no. No context, no location, no selectivity; candle patterns and 1m structure breaks are confirmation tools, not strategies. The −61…−91R scores are what "alert-as-strategy" costs. Retire or rebuild with a real chain.
- **dol_ifvg:** limit-order candidate — iFVG entries *must* rest at the zone; market-filling 250 pips later is buying the top of the mitigation wick.
- **watukushay_no1:** encode the actual MA relationship (fast>slow or cross), or the chain is decorative.
- **lewis_kelly:** right structure post-fix (linear chain); 15d is too short to judge — rerun 60–90d.

## 6. Deep questions for your data-handling quality (answer these in order)

1. Why does `features_bias@4h` XAU have 19 rows in 15 days while bias@15m has 799? Which producer/writer owns 4h, when did it last succeed per symbol — and why did nothing alert until a backtest preflight noticed? (Extend alert #2 to per-(feature,tf,symbol) coverage floors.)
2. Who is writing wall-clock-stamped rows into `features_bias@1h` (§3-G)? When was the last bucketed-TS audit across ALL dense feature tables (`ts % tf_seconds <> 0`)?
3. Why is `features_session@1m` at 4% coverage — dead producer or wrong expectations? If a spec ever makes it required, it silently gates everything.
4. Which of your 49 variants have been live-traded with real orders in the last 30 days? (DB says: almost none — 11 live_signals ever.) If 40+ are dormant, why are they `is_active=true`, evaluated every 15m, and consuming the eval loop?
5. What should the harness do when fill drift exceeds live's `max_entry_drift_pips`? Today: book it. Live: reject it. Pick ONE behavior for parity, or report both columns.
6. Are 1d/4h variants real strategies you intend to trade? If yes, the harness needs warmup-by-slowest-tf and 6–12-month windows; if no, retire them and stop paying their evaluation cost.
7. Why do five_one_v1 and v10 exist as separate DB rows with identical content? Who reviews variant proliferation (13 keylevel variants, 6 smart_risk variants) — is there a variant retirement ritual?
8. Is a 2–3 pip stop ever valid in this system? If not, where is `minStopPips` enforced — validator, compiler, or live geometry check? (Nowhere today.)

## 7. New action items (append to §7 plan)

- **#29 (Tier 1, S): harness `r_realized`** — report `PnL/|fill−SL|` alongside planned-R; add per-trade drift stats; apply live's `max_entry_drift_pips` as a harness gate mode (default: report, flag >2 pips). Fixes netR distortion everywhere.
- **#30 (Tier 1, S): `minStopPips` geometry validation** — fail-closed in the runner + liveRunner + spec validator.
- **#31 (Tier 1, S): fix keylevel_bounce_v4 YAML** (predicate + TTL ~480) or retire; add canonical-base seed guard (#6 incomplete — five_one still collapsed).
- **#32 (Tier 1, M): bucket-TS invariant for dense features** — fix the wall-clock writer on bias@1h, dedupe existing rows (keep bucket-aligned), add producer invariant + DB CHECK; sweep all dense tables for `ts % tf_seconds <> 0`.
- **#33 (Tier 2, S): warmup by slowest-tf + HTF-window guard** — runner refuses vacuous windows with a clear message.
- **#34 (Tier 2, S): entry-mechanic rule** — mean-reversion entries (zone/ifvg/ob level features) must be `entryConfig.type: limit`; validator warns on market-entry-at-level.
- **#35 (Tier 2, S): coverage alerting per (feature,tf,symbol)** — floors for dense features required by any active spec (would have caught bias@4h, bias@1d, session@1m).
- **#36 (Tier 2, M): retirement ritual** — variants with 0 signals in 30d → auto-propose deactivation; cap variant count per family.

## 8. Developer implementation plan (sweep follow-up)

Numbering continues #29–#36 from §7 of the main audit report; #0 is the precondition everything else depends on. Effort: **S** <2h, **M** ≤½ day, **L** 1–3 days. Every item: change → files → tests → acceptance.

**#0 — Land and deploy what's already fixed (precondition). Effort S.**
Currently uncommitted and undeployed: the two `signal_direction` compiler fixes (`compiler.ts:522-540` progressive projection, `:768-772` flat always-project + module-scope `FEATURES_WITH_DIRECTION`), and the #20 timeout-units work (`backtest-pit-v2.js:1984-2000` signal-tf→1m conversion + `0`=no-cap, `validate.ts:168-182`). Change: review + commit; `pnpm -r build`; full test suite; redeploy web/PM2 per runbook (PG → tz-ingestion → web → health-poll); `pm2 save`. Acceptance: `git status` clean; 93+ strategies tests green; the runner's stale-dist warning never prints; live web compiles progressive specs (hit one watukushay_no1 evaluation and confirm fresh `specHash` in logs).

**#29 — Harness reports `r_realized` + drift, and gates like live (root fix for the −21R distortion). Effort M.**
`scripts/backtest-pit-v2.js`: `computeOutcomeR` call sites (`:898-941`) — keep `r_planned` (current) and add `r_realized = PnL / |effectiveEntry − SL|`; summary emits both (`netR_realized`, `avgLossR_realized`); per-trade JSON gains `driftPips`, `rRealized`; add `--drift-gate=live|report` mode — `live` applies the spec's `max_entry_drift_pips` (default 2, same as `orders.max_entry_drift_pips`) and marks over-drift fills as `rejected_drift` (not booked), `report` (default) books them but flags. Mirror in `packages/analyzerBacktest/src/outcomeTracker.ts` (same denominators). Tests: synthetic trade with 100-pip adverse drift → `r_planned` ≈ −3, `r_realized` ≈ −1; drift-gate=live rejects it. Acceptance: 15d sweep re-run shows avg realized loss ≈ 1–1.3R except true gaps; v1-vs-v1_limit comparison table in the report; no |r_realized| > 3 without a `gap_through` reason.

**#30 — `minStopPips` geometry validation, fail-closed (kills the 0.2–3 pip stop class). Effort S–M.**
`packages/shared/src/pairs/pairCharacteristics.ts`: add `minStopPips` per symbol (majors 3, USDJPY 3, XAUUSD 10, USDSEK 10; expose getter). Enforce at three layers: spec-time (`validate.ts` — error when a spec's static SL or geometry can produce < minStop), backtest (`backtest-pit-v2.js::isValidSignalGeometry` — count as `invalidGeometry` with reason `min_stop`), live (`packages/tradePipeline/src/liveRunner.ts` signal risk-geometry block ~`:183-223` — reject with `DEGENERATE_STOP`). Tests: a 2.6-pip-stop orb_classic signal is rejected at all three layers; lewis's Jul-8 0.2-pip signal would have been rejected. Acceptance: orb_classic 15d run reports `invalidGeometry: min_stop` on the 3 affected signals instead of −8.23R.

**#31 — Fix keylevel_v4 + canonical-base seed guard + five_one reconciliation. Effort M.**
`keylevel_bounce_v4.yaml`: add `predicate: direction != 'neutral'` and `ttlMinutes: 480` to the `htf_bias` step; re-validate (must pass the non-empty-predicate rule). `scripts/seed-strategy-specs.js:126`: when a family has multiple YAMLs and no canonical `<familyId>.yaml`, seed **errors** listing the family (currently silently picks `familySpecs[0]`). DB reconciliation for `five_one_scalp_v10` (identical overrides md5 to v1): point it at its intended spec or deactivate — owner decision, recorded in the DB. Tests: v4 hydrates + compiles (#8 fixture); seed fails on a synthetic multi-spec family without canonical base. Acceptance: v4 runs a backtest end-to-end (post-#35 data fix for bias@4h); five_one variants hash differently or v10 is inactive.

**#32 — Bucket-TS invariant for dense features (ledger-proven root cause). Effort M.**
Root cause (verified via `feature_producer_runs.watermark_ts`): `bias.ts serialize()` emits no `ts`; the row inherits the runner fallback `resolveFeatureRowTs(rawTs, sourceMaxTs)` (`apps/engine/src/dag/runner.ts`, used by `buildRows`), and `sourceMaxTs` on the inline 15m trigger is wall-clock run time (~27s past the quarter hour), not a candle bucket. Affects at least XAUUSD + USDJPY bias@1h (40–96 off-bucket rows/day through Jul 17). Change: (a) in `resolveFeatureRowTs`, for dense (non-event) features floor the resolved ts to the feature's tf bucket (`time_bucket` semantics via `TF_MS`) — one place, kills the class for every dense producer; (b) producer invariant: reject a dense row whose ts is not tf-aligned; (c) migration adding a CHECK to dense feature tables where enforceable (or a scheduled audit if CHECK is too invasive for hypertables); (d) cleanup existing data: for each dense table, rows with `ts % tf_seconds <> 0` — UPDATE ts to floored bucket where no bucketed twin exists, DELETE the off-bucket row where a twin exists (sketch: `DELETE FROM features_bias b USING features_bias t WHERE b.symbol=t.symbol AND b.tf=t.tf AND time_bucket('1h', b.ts)=t.ts AND b.ts<>t.ts`). Tests: synthetic engine run with wall-clock endTs persists bucket-aligned ts; invariant rejects a planted off-bucket row. Acceptance: `SELECT COUNT(*) FROM features_bias WHERE tf='1h' AND (EXTRACT(EPOCH FROM ts)::bigint % 3600) <> 0` → 0 and stays 0 for 7 days; no duplicate-bucket pairs on any dense table.

**#33 — Warmup by slowest-tf + vacuous-window guard. Effort S–M.**
`scripts/backtest-pit-v2.js::computeWarmupBars/computeWarmupTs` (`~:200-205`): warmup = max over all spec conditions/steps of `(lookbackBars × tf minutes) + producer confirmation lag` (pivot lookback × tf for structure/pivot-anchored specs); compute over actual bar timestamps, not wall-clock. Guard: if `window < 2 × warmup`, exit with a clear message (`window too short: needs ≥ Nd for this spec's warmup`) instead of "0 trades". Tests: 10xroi_v1_1d on 15d → clear refusal; on 200d → runs. Acceptance: no variant ever again reports a silent all-`warmupSkipped` run.

**#34 — Entry-mechanic rule: mean-reversion entries are limit-only. Effort S.**
`validate.ts`: when any entry condition's feature is a level feature (`features_zone`, `features_ifvg`, `features_order_block` — registry `kind: level`) and `entryConfig.type` is `market` (or unset), emit a **warning** suggesting `entryConfig.type: limit`; add spec escape hatch `allowMarketEntryAtLevel: true` for intentional chases. Convert the affected family specs (dol_ifvg, smart_risk family, gold_scalp_1) to limit entries with sensible `limitOffsetPips`/`maxFillBars`. Tests: validator warns on a zone+market fixture and stays silent with the flag. Acceptance: mean-reversion variants re-run as limit; drift distribution collapses (compare vs #29's report).

**#35 — Coverage alerting per (feature, tf, symbol). Effort M.**
Extend `ops/monitor-v2-health.ps1` (or new `ops/watch-feature-coverage.ps1`): for every (feature, tf, symbol) required by any **active** spec, compute 48h density vs expected dense bars (bias/atr/pricing/zone tables, market-calendar-aware via `isTradableInstant`); alert below 80%; include `features_session`-class sparse tables at a lower floor with a weekly cadence. Reuse the preflight's coverage query logic — extract it to a shared helper instead of re-implementing. Tests: plant a 50%-coverage fixture → alert fires; full coverage → silent. Acceptance: the current holes (bias@4h XAU 21%, bias@1d XAU ~62%, session@1m 4%) are all reported by the first run of the watcher.

**#36 — Variant retirement ritual. Effort S.**
New `scripts/report-dormant-variants.js`: variants with 0 signals in 30d (from `live_signal` + recent backtest evidence) and no open orders → printed deactivation proposal (never auto-deactivates); wire its output into `promote-top3-live.js` as a pre-promotion checklist. Cap variants per family (soft limit 8 — keylevel has 13, smart_risk 6). Acceptance: first report lists the current silent ~28; every future promote run shows the dormant list.

### Sequencing

| PR | Items | Notes |
|---|---|---|
| **PR-A land + deploy** | #0 | Commit, build, redeploy, `pm2 save`. Everything else builds on this tree. |
| **PR-B harness truth v2** | #29, #30, #33 | Then **re-run the full 49-variant 15d sweep** (`temp/audit15d/batch.sh` + `analyze.js` are reusable) as the new baseline — expect the −3R…−21R figures to collapse to realized-risk truth. |
| **PR-C data integrity** | #32, #35 | Bucket-TS fix + cleanup + coverage watcher; verify 7 clean days. |
| **PR-D spec hygiene** | #31, #34, #36 | v4 fix, limit-conversions, canonical guard, dormant report. |
| then resume §7 plan | #4B `detected_ts`, #15/#16 entry TTLs + forward-causal | #16 is what finally retires the 1/3 inverted-causality measured in this sweep. |

## 9. All-features health sweep (added after the scope question — covers all 29 tf-keyed feature tables, not just setup-consumed ones)

The 15d sweep above was strategy-centric; this section audits every `features_*` table (probe: `temp/_probe/allfeatures.js`, read-only).

**9.1 The off-bucket wall-clock writer is fleet-wide and historical — not just bias@1h.**
Off-bucket dense rows exist in ~12 tables, in **every month since April**, still being written (last: `2026-07-17T10:00:57.585Z` — the *same* wall-clock ts in `features_htf_bias` AND `features_atr`, i.e. one inline-engine run stamping several tables at once):

| table@tf | off-bucket rows | | table@tf | off-bucket rows |
|---|---|---|---|---|
| session@5m | **24,817** | | displacement@15m | 6,273 (25% of table) |
| htf_bias@5m | **14,540** | | htf_bias@15m | 6,373 |
| atr@5m | 5,510 | | atr@15m / @1h / @1m | 2,823 / 2,649 / 1,212 |
| pricing (per tf) | ~285–463 | | bias 15m/1h/5m | 490 / 1,135 / 539 |
| direction_state (mirrors bias) | 490/1,135/244 | | indicator (constant 33/tf — one bad batch) | 33 |
| liquidity_pools@5m | 209 | | time_of_day_edge | 3–66 |

Event tables are **clean** (zone, structure, sweep, ifvg, zone_retest, candle_pattern: 0 off-bucket) — the bug lives only in dense state features written through the runner's ts fallback (§3-G / #32). Caveat for #32: `features_opening_range` ts is **range-completion time by design** (67% of its 1d rows are "off-bucket" legitimately) — the bucket CHECK/invariant must be per-feature-contract (anchor vs completion), not blanket, or it will break ORB.

**9.2 Dead/stale producers nobody watches** (lag as of 2026-07-21): `structure@1d` **23 days** (20 rows ever — daily structure is effectively dead), `order_block@1d` 36d, `session_hl@5m` 71d, `pivot@1d` 22d, `eq_liquidity@4h` 13d, `spread@1d` 11d, `features_correlation` 4d (DXY feed death — correlation/heat inputs stale), `push_pull` HTFs 4–6d, `ifvg@1d` 6d, `order_block@1h/4h` 4–8d. #35 must include a "producer silent > N×tf" rule per table, not just density floors.

**9.3 `features_atr` ledger error storm:** **87,080 ledger errors in 7 days** (invariant `output_anchor_stale` looping with no backoff — predates and outlasts today's outage; it stormed all week).

**9.4 Bloat:** `zone_retest@5m` **3.88M rows**, `atr@1m` 3.69M — no retention (#24).

**9.5 Producer universe ≫ consumer universe:** active specs consume ~12 of the 29 tf-keyed feature tables. The rest (bollinger, keltner, eq_liquidity, liquidity_pools, time_of_day_edge, session_hl, volatility_normalized, push_pull, correlation…) are computed, stored, and decaying unmonitored — either wire them into strategies with the same discipline as the consumed ones, or stop paying compute+storage+silent-decay for them (fold into #36's retirement ritual).

*Artifacts: sweep JSONs + errors in `temp/audit15d/`, analyzer `temp/audit15d/analyze.js`, per-trade anatomy `temp/audit15d/anatomy.json`. Compiler fixes (signal_direction ×2) are in `packages/strategies/src/compiler.ts`, built and test-green, currently uncommitted — and not yet in any deployed web/PM2 build.*
