# Post-Cleanup Staged Audit — corrected report (v2) — 2026-07-23

**This file supersedes `POST_CLEANUP_SWEEP_2026-07-23.md` (v1).** An independent review of v1 found the raw numbers mostly correct but several interpretations wrong or overstated. Every correction is applied here and marked where it changes a conclusion. v1 is kept for provenance; quote numbers from this file.

**What this is:** a *staged* post-cleanup audit, not an atomic 49-variant sweep. The evidence comes from four runs that must not be conflated: (1) the initial 49-variant run (many blocked), (2) manual XAU lifecycle repair + re-run, (3) race-window re-runs after state-feature writes, (4) the separate pro_ltf pair/parameter matrix, plus (5) the Apex validation runs. Run artifacts live in `temp/audit15d-post/` (a working directory, overwritten by re-runs — not an immutable run store).

---

## 1. Both R metrics, always (v1's biggest error)

v1 showed only **planned R** (denominator = |authored entry − SL|), which drift inflates. **Realized R** (denominator = |fill − SL|) is the honest "return on risk actually taken". They diverge violently on drift-heavy specs — including one outright contradiction:

| strategy | sig→exec | W/L | netR **planned** | netR **realized** | v1's label was |
|---|---|---|---|---|---|
| gold_mssnr_scalper_1m | 237→55 | 9/46 | −249.56 | **−15.78** | catastrophic → bad, not −250R |
| five_one_scalp_v1 & v10 | 192→169 | 55/114 | −120.99 | **−43.13** | catastrophic → confirmed bad, smaller |
| dol_ifvg | 43→21 | 4/17 | −95.81 | **−8.16** | catastrophic → bad |
| gold_scalp_1_ob_ifvg | 31→11 | 1/10 | −21.88 | **−5.64** | bad |
| **gold_9sma_scalper_1m** | 595→51 | 20/31 | −12.40 | **+15.77** | **"catastrophic" was WRONG — realized-positive** |
| smart_risk_ob_ifvg_1m | 45→31 | 2/29 | −9.24 | **−2.84** | bad |
| orb_scalper_1m | 6→5 | 1/4 | −6.82 | **−1.93** | bad |
| 10xroi fixedpip (1m/5m) | 342/289→13/9 | 3/20 | −64.49/−38.59 | **−8.09/−2.50** | bad |

Read: planned R measures how far fills landed from authored entries (the drift disease); realized R measures what the trades did per unit of true risk. Both matter — planned R exposes the entry-mechanic problem, realized R judges the strategy. **Any "catastrophic" label must cite both.** gold_9sma is the proof: planned-negative, realized strongly positive — it needs its own review (its losses are fill artifacts, its trades are profitable per true risk).

## 2. Corrected scoreboard

### Clean core (with honest sample sizes)
- **keylevel_bounce** (XAU, EUR): 9 signals per variant, **2 executed trades per variant, correlated** (all variants share the same 9 raw signals — they are parameter variants of one idea, not independent evidence). v1/v1_4r/v1_wider/v3/v1_fx: 2W/0L (+1.078…+3.232); **v2: 1W/1L (+1.198)**; **v1_limit: 1W/1L (+3.00 netR = realized)**. v1's "2W/0L every variant" was wrong on two variants. Verdict: *positive and preliminary — 2 correlated trades per variant proves the chain works, not that it earns.*
- **apex_scalp_ob_v1** (video-derived): `temp/audit15d-post/yt_3step_scalp_ob_v1__EURUSD.json` (file predates the apex rename — the review's "no Apex artifact" was a name miss; it exists): 59 signals → 5 outcomes, comprising 3 resolved trades (2W/1L) and 2 window-end timeouts; netR = +3.00 (planned and realized identical). apex_scalp_orb_v1: 9 signals → 5 outcomes, 1W/4L, −2.00.
- **gold_anti_bias_sniper_v1** (XAU): 15 signals → **3 executed, 1W/2L**, planned +2.79, realized +0.87 (v1's "one clean win" hid two losses).

### Bad on both metrics (labels hold)
five_one v1 & v10 (−120.99 planned / −43.13 realized, 88% fire rate — and **byte-identical results twice in a row: the v1≡v10 spec collapse is still live in the DB**), dol_ifvg, gold_scalp_1, smart_risk_1m, orb_scalper, gold_mssnr (−15.78 realized), 10xroi fixedpip.

### Needs its own review
**gold_9sma_scalper_1m** — the only spec that is planned-negative / realized-positive. Judge it on realized R with the drift gate on, not on v1's label.

## 3. Blocked vs silent — corrected framing (v1 was contradictory)

v1 said "every BLOCKED call was correct" and also that a "false-block race" exists. Both cannot hold. The corrected statement:

- **Lifecycle and warmup blocks were real readiness failures.** XAU zone/OB/iFVG lifecycle was genuinely 19.7h stale (refreshed by hand: 1,058/218/734 rows); the 5 warmup refusals are correct-by-design window guards. The ~29 XAU lifecycle blocks were operator-observed from the `.err` files at the time — re-runs overwrote some, so the exact count (39 blocked of 49) is **operator-observed, not independently reproducible from the current directory** (files are overwritten per run; an immutable run store is on the contract's list).
- **The state-freshness blocks are a design bug, and worse than v1 said.** v1 claimed a "10-minute threshold vs 15-minute cadence race". The truth (`featureRegistry.ts:96-104`): `FRESHNESS_STATE = {1m: 3, 5m: 7, 15m: 20, 1h: 70, 4h: 280, 1d: 1440}` minutes, and the capability gate's `STALE_STATE` compares table `MAX(ts)` against these per-tf windows (`feature-capability.js:48-49`). With a 15-minute write cadence, **a 5m state feature is stale ~53% of the time and a 1m state feature ~80% of the time, by construction** — not a race, a guarantee. This is why pricing@5m/atr@5m/atr@1m/bias@5m/moving_average@5m blocked repeatedly. The fix is the readiness contract's freshness formula (maxAge = max(cadence + grace, 2×tf)), which is already specced.
- **"Compiled SQL returned plenty of rows" proved nothing about strategy health.** The 192/451/23 figures were *candidate rows* from direct compiles, not final gate-approved signals; the runner's gates/warmup killed them. v1 conflated candidates with valid signals.

## 4. pro_ltf matrix — its own section, symmetric evidence

Separate experiment (7 variants × 7 pairs), not part of the 49-variant sweep. Limit cells (tp15lim/tp12lim) were positive on EUR/GBP/AUD/NZD/CAD/JPY and negative only on USDCHF. **tp30lim is environment-dependent, not a free win: +9.0 on USDJPY and +6.0 on USDCAD, but −1.0 GBP, −3.0 AUD, −3.0 NZD, −5.0 CHF** (v1 headlined the two wins and underplayed the four losses). Market entries remain boom/bust; limit entries are the consistent cell.

## 5. The verdict that survives

- **keylevel and pro_ltf-limit cells are the only candidates for extended validation** — 60–90d walk-forward once the extended backfill (Apr 23→Jul 6) completes. Everything else here is either proven-bad evidence or preliminary.
- **No strategy is production-ready from this audit.** Keylevel's evidence is 2 correlated trades per variant; pro_ltf's best cells are n=6–18 with CIs crossing zero; gold_9sma is unresolved pending its realized-R review. Remaining completed runs are negative or unresolved; blocked and silent variants remain unassessed (no valid strategy evidence produced either way).
- **The measurement stack is now honest enough to trust negative results** — the labels that remain (five_one, gold_mssnr, dol_ifvg, smart_risk, orb_scalper, gold_scalp_1, 10xroi fixedpip −64.49/−38.59 planned → **−8.09/−2.50 realized**) stand on both R metrics.

## 6. Errata of v1 (kept for the record)

1. Showed only planned R; gold_9sma was mislabeled catastrophic (realized +15.77).
2. "keylevel 2W/0L every variant" — v2 and v1_limit are 1W/1L.
3. "gold_anti_bias one clean win" — it was 1W/2L.
4. "Apex evidence absent" — actually present at `temp/audit15d-post/yt_3step_scalp_ob_v1__EURUSD.json` (pre-rename name).
5. "final comparison" — it's a staged audit with overwritten artifacts.
6. "10-minute threshold race" — the real thresholds are {1m:3, 5m:7, 15m:20…} minutes; 5m/1m state features are structurally stale most of each cadence cycle.
7. "Every BLOCKED call correct" — replaced by: lifecycle/warmup blocks real; freshness blocks are threshold-design false positives.
8. "Compiled SQL rows prove strategy health" — those were candidates, not final signals.

## 7. Developer-ready implementation plan

Architecture invariants land before strategy tuning. No PR below may tune performance thresholds against this 15-day sample.

### PR-1 — Truthful backfill and post-write proof (P0)

**Goal:** success means every requested output was persisted and verified over requested window.

**Changes**

- `scripts/backfill-historical-features.js`: remove unbounded ATR-presence shortcut; never use one feature as proof of whole DAG completeness.
- Aggregate requested, attempted, inserted, rejected, and failed rows per `(symbol, feature, tf, window)` from engine outcomes, not only outer-loop exceptions.
- `apps/engine/src/dag/runner.ts`: propagate persistence failure and actual row counts to caller.
- Add shared postflight verifier using `packages/strategies/src/featureRegistry.ts` contracts:
  - dense state: coverage plus edge watermark;
  - sparse event/level: successful producer run plus source coverage, without requiring event rows;
  - session-scoped: session/date/range key and completion-anchor checks.
- Emit machine-readable readiness manifest. Exit non-zero for any required cell not `READY`.

**Tests**

- ATR exists but requested bias is absent: fail.
- Batch insert throws: ledger `status='error'`, all attempted rows rejected, process exits non-zero.
- Dense output behind source edge: fail.
- Legitimate sparse zero-output run with covered source window: pass.
- Idempotent rerun with complete persisted output: pass.

**Acceptance**

- Every requested cell appears exactly once in manifest.
- `attempted = inserted + rejected` for every batch.
- No successful run can coexist with newer matching producer-ledger error.

### PR-2 — Unified Data Readiness Contract (P0)

**Goal:** live, backtest, capability, health, and promotion paths return same readiness verdict.

**Changes**

- Add shared module under `packages/shared/src/readiness/` with typed verdicts: `READY`, `DEGRADED`, `BLOCKED_COVERAGE`, `BLOCKED_EDGE`, `BLOCKED_PRODUCER`, `BLOCKED_LIFECYCLE`, `BLOCKED_VERSION`, `CONTRACT_MISMATCH`.
- Resolve active spec requirements into `(feature, tf, semanticType, producer, engineVersion)` cells.
- Prove coverage, latest-tradable-data edge, producer/version success, and lifecycle convergence independently.
- Replace duplicate checks in `scripts/feature-capability.js`, `scripts/backtest-pit-v2.js`, and `packages/tradePipeline/src/liveRunner.ts`.
- Use producer-aware state freshness:

$$
\operatorname{maxAgeMinutes}=\max(\operatorname{producerCadenceMinutes}+\operatorname{graceMinutes},\ 2\times\operatorname{tfMinutes})
$$

- Preserve event semantics and explicit session-scoped overrides. Use market/data clock, not raw wall clock.

**Tests**

- Healthy 1m/5m output never becomes stale inside 15-minute producer cadence.
- Weekend and XAU daily break create no false staleness.
- Fresh rows plus latest failed producer attempt block.
- Fresh producer plus stale lifecycle cursor blocks only lifecycle-owned levels.
- Wrong engine version blocks despite fresh timestamp.
- All adapters return identical verdict for same fixture.

**Acceptance**

- One library owns verdict math.
- Structural cadence-boundary false blocks disappear.
- Missing, failed, or version-mismatched required data still fails closed.

### PR-3 — Lifecycle locking and convergence (P0)

**Goal:** one bounded lifecycle owner advances checkpoints or reports truthful failure.

**Changes**

- `scripts/refresh-lifecycle.js` and `apps/engine/src/lifecycleUpdater.ts`: add PostgreSQL advisory lock scoped by owner/symbol.
- Add batch cap, wall-clock deadline, iteration cap, and no-progress guard.
- Record checkpoint before/after, rows examined/updated, remaining lag, and convergence verdict in `feature_producer_runs.quality_json`.
- Mark no movement as error when eligible work exists.
- Keep inline lifecycle best-effort only. `tz-refresh-lifecycle` remains canonical owner.
- Alert on cursor lag, consecutive failures, and repeated no-progress runs.

**Tests**

- Concurrent runs: one owns lock; other exits `already_running` without mutation.
- Eligible work with stationary cursor: fail `NO_PROGRESS`.
- Large backlog: bounded partial run advances cursor and reports remaining lag.
- Converged run succeeds without fabricated updates.

**Production gate:** seven clean days across active universe, no overlap, no unbounded invocation, all cursors inside SLA. Cron remains stopped until this gate passes in staging/dry-run mode.

### PR-4 — Immutable backtest run store (P1)

**Goal:** every reported number maps to immutable inputs, outputs, and execution metadata.

**Changes**

- Add run ID and manifest containing git SHA, spec ID/hash, symbol, window, mode, setup profile, intrabar mode, harness version, data edge, readiness-manifest hash, arguments, timestamps, and exit code.
- Store attempts under `reports/runs/<runId>/` or DB/object-store equivalent. Never overwrite.
- Store summary, trades, stdout/stderr, and SHA-256 artifact hashes.
- Add parent audit ID linking initial pass, repairs, reruns, matrices, and spec aliases.
- Make report generators consume manifests, not mutable filename conventions.

**Tests and acceptance**

- Same command creates distinct immutable run IDs.
- Hash check detects changed artifact.
- Failed, blocked, and refused attempts remain queryable.
- Fresh report reproduces every row from cited run IDs.

### PR-5 — Harness/live parity closure (P1)

**Goal:** backtest and live execution share entry, risk, and outcome contracts.

**Changes**

- Keep planned and realized R in every trade and summary.
- Add `--drift-gate=report|live`; `live` uses same `max_entry_drift_pips` rule and rejection code as live runner.
- Centralize minimum-stop and pair-characteristic validation across validator, backtest, and live paths.
- Keep warmup-by-slowest-TF, bar-close fill, and gap-through behavior in shared parity fixtures.
- Separate resolved trades, window-end timeouts, invalid outcomes, and rejected entries. Define `executed` once in JSON schema.

**Primary files**

- `scripts/backtest-pit-v2.js`
- `packages/analyzerBacktest/src/outcomeTracker.ts`
- `packages/tradePipeline/src/liveRunner.ts`
- `packages/shared/src/pairs/pairCharacteristics.ts`
- `packages/strategies/src/validate.ts`

**Acceptance:** parity suite passes market, limit, gap-through, timeout, drift-rejection, and degenerate-stop fixtures. Reports never mix planned and realized labels.

### PR-6 — Spec governance and strategy research (P1)

**Goal:** prevent semantic duplicates; require durable evidence before promotion.

**Changes**

- `scripts/seed-strategy-specs.js`: enforce canonical family base and reject ambiguous families.
- Compute hydrated semantic hash; block simultaneous activation of identical variants unless explicitly aliased.
- Promotion requires immutable 60–90d panel, minimum sample, pair and walk-forward splits, readiness `READY`, and no unresolved parity warning.
- Add dormant-variant report; propose retirement, never auto-deactivate.
- Strategy changes use new versioned variants in separate research PRs:
  - keylevel, pro_ltf-limit, Apex OB: extended validation without tuning first;
  - gold_9sma: dedicated drift-gated review;
  - bare-trigger families: rebuild with context or retire;
  - limit-vs-market behavior: explicit variants, never silent mutation.

**Acceptance:** byte-identical variants such as `five_one_scalp_v1` and `v10` cannot both activate. No candidate promotes without immutable panel evidence.

### Merge and rollout order

| Order | Deliverable | Merge gate | Production gate |
|---|---|---|---|
| 1 | PR-1 truthful backfill | failure-path integration tests | repaired 15d replay; zero hidden failures |
| 2 | PR-2 readiness contract | adapter verdict parity | 48h warn-mode observation, then fail-closed |
| 3 | PR-3 lifecycle convergence | lock/progress tests | seven clean days across active universe |
| 4 | PR-4 immutable run store | manifest/hash tests | all new audits cite run IDs |
| 5 | PR-5 harness parity | shared parity fixtures | 15d baseline rerun without schema ambiguity |
| 6 | PR-6 governance/research | seed/promotion tests | 60–90d panel after extended backfill |

### Definition of done

- Every required feature cell has coverage, edge, producer/version, and lifecycle proof.
- Backfill exits non-zero on hidden persistence failure or incomplete output.
- Live, backtest, health, and promotion paths agree on readiness.
- Lifecycle runs under one locked, bounded owner and proves progress.
- Every audit result has immutable provenance.
- Planned/realized R and outcome classes are schema-explicit.
- Strategy research starts only after all panel inputs are `READY`.

*Raw artifacts: `temp/audit15d-post/` — current final artifacts are parseable from this directory (the analyzers regenerate the tables). The full staged history is **not** reproducible: re-runs overwrote prior artifacts (initial blocked results, manual lifecycle states, the Apex pre-rename mapping), so original block counts are operator-observed only. An immutable run store is on the readiness contract's list.*
