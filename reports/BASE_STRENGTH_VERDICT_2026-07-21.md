# Base-Strength Verdict — is the analyzer finding the RIGHT setups and zones? — 2026-07-21

**Method:** independent ground truth. I recomputed pivots (formal 8-bar rule), zones (displacement-origin/OB), and bias (EMA50 trend) from raw candles for XAUUSD 15m (Jul 8–17) and cross-checked EURUSD, then compared against the DB feature rows and against what the analyzer actually picked in real trades. Charts: `temp/gt_vs_db_xau.png`, `temp/gt_zoom_jul9.png`. Scripts: `temp/gt_vs_db.py`, `temp/gt_zoom.py`, `temp/_probe/biascheck.js`.

---

## The one-sentence verdict

**The analyzer's *eyes* are good but its *memory* is rotten: zone formation logic is correct (98.6% right-side, real levels at real prices) and the setup checklist picks trader-correct setups — but the zone store is 78–95% duplicate foam, "fresh" means nothing (zombies to 129 days), and the selection/timing layer then picks a rung of the foam too late to matter.**

## What is CORRECT at the base (build on it)

1. **Zone formation detection**: 294 demand/supply rows in the window — only 4 wrong-side (demand above price / supply below). The producer understands what a zone is and puts it at the right price. The Jul-9 ladder sits exactly at the real 4110.5–4111 demand level a trader would draw.
2. **Setup pattern-matching**: the Jul-9 keylevel buy (13:00, pullback into demand in a higher-highs uptrend, SL below zone, TP at last high) is **textbook**. On the zoom chart it's visibly the right setup at the right place. The checklist works when the inputs let it.
3. **Structure events**: 26 BOS/CHoCH in the window land on visible swing breaks — placement plausible.
4. **Bias is stable, not random**: no same-bucket direction conflicts; XAU flip rate 4.4% (one flip per ~23 bars). It whips at turns (Jul-13 sample: one-bar bullish blips inside a bearish stretch) and agrees with a crude EMA50 rule only ~46% of comparable bars (54% disagree — partly my crude rule, partly its lag) — **mediocre, usable as a filter, not as a spine.** EUR noisier (9.5% flips).

## What is BROKEN at the base (the "not strong" part)

1. **Zone storage is foam — 95% duplicates in-window.** XAU 15m window: 294 demand/supply rows, **280 are ladder rungs (95%)**; EURUSD: 78% ladder, max 9 rungs. Emission runs **57–89 rows/day** vs the 2–3 levels a trader marks. Every price sits inside demand AND supply simultaneously (see `gt_vs_db_xau.png` — the chart is a wall of red+blue). A checklist asking "is there a zone near price?" is trivially true everywhere → **the analyzer cannot meaningfully fail the zone step**, so setups pass that shouldn't exist.
2. **Pivots over-emit ~1.8×**: DB has 114 rows vs 63 the documented 8-bar rule produces (60/114 match ground truth; the rest are micro-wiggles). Noisy pivots → hyperactive structure (70/day at 1m) → noise triggers everywhere downstream.
3. **"Fresh" zones are zombies**: verified earlier — EURUSD 1d supply avg **129 days**, iFVGs "fresh" at 20–128 days true age. Nothing in the base model enforces *aliveness*.
4. **Consumed zones pass as candidates**: the Jul-9 trade used a zone invalidated 1 minute after formation (283 such in the window). Formation-side is right; **state-side (alive/consumed) is wrong at exactly the moment it matters.**
5. **Selection is arbitrary inside the foam**: `ORDER BY bottom DESC` picks the nearest rung of the nearest ladder — 1-pip-lucky on price, random on quality/fill attributes (one level's rungs score 0.29–0.65).

## What this means for "is the analyzer finding the right setup?"

- **It finds the right PATTERN** (pullback into real demand in trend) — the checklist logic is sound.
- **It cannot reliably find the right ZONE** — because the zone layer doesn't contain zones; it contains foam. Today it gets the price right only because the ladder spans ~1 pip.
- **It finds them TOO LATE** — signal fires when the newest chain element closes, one signal-TF after the level mattered (the 105-pip fill erosion on the Jul-9 win: +0.89R instead of +3R; the Jul-16 sell: 270 pips after the level).

## Base-strength fix list (nothing above this layer matters until these land)

1. **#39 Zone identity + dedup (read-side canonical view first, producer merge second).** One row per (symbol, tf, kind, direction, level±½ATR). Target: ≤ 3 zone rows/day/tf and ≤ 3 candidates per setup. *This is the base.*
2. **#40 Aliveness contract.** Per-kind max age (15m zone ~2–5d, iFVG ~1–2d, 1h zone ~2w) + `is_fresh` expiry + **fill-state as-of**: consumed (fill ≥ 95%, tapped, or invalidated) at anchor ⇒ never a candidate, in PIT and live identically.
3. **#41 Selection semantics.** Swing-scoped candidates (pivot LL→HH) + rank `deepest_unmitigated_discount` per side + premium/discount from pivots (not the self-referential pricing feature).
4. **Pivot noise control.** Enforce the documented per-tf lookback and dedupe pivots by (symbol, tf, kind, ±tick-grid); target DB≈GT counts (63, not 114).
5. **Bias hysteresis.** Minimum dwell (e.g. 4 bars at 15m) before a flip is emitted — kills the one-bar whips at turns; add a confidence that's actually computed (the current column is degenerate).
6. **Timing (#16 forward-causal + limit entries).** The setup fires when the level is actionable, not when the newest bias bar closes. Without this, even perfect zones get traded late.

**Order: 1 → 2 → 3, then 4–6 in parallel.** Everything above this layer (management, gates, promotion, portfolios) is decoration until these six are true — that is what "the base is not strong" means, measured.

---

## Errata & refinements (independent code audit, same day)

A second full code audit of the zone/pivot/selection paths confirmed the diagnosis and corrected four claims in this report:

1. **"Selection is `ORDER BY bottom DESC`" — overstated.** Only the *specialized* zone-entry SQL and `setupEngine::deriveEntryZone()` rank nearest-edge-first (long: highest bottom, short: lowest top, quality as tie-breaker). The *generic* compiler feature joins already rank by `rank_score, strength, quality, recency`. The defect is real but path-specific: **nearest-edge beats quality exactly in the two paths that pick the trade's zone.**
2. **"Pivot lookback not enforced" — wrong as stated.** Current `pivot.ts` and the registry both enforce the 8-bar 15m rule; `features_pivot` rows in the window (114 vs my 63 recomputation) are a **DB-provenance question** (old `engine_ver` rows, prior candle-source windows, or historical duplicates), not a current-producer violation. Action changed from "fix the producer" to "audit provenance by `engine_ver`, then decide cleanup vs producer change" (item B0.2 below). Note also: `pivot.confidence` is always `1.0` — it carries no ranking information.
3. **"Fresh is a lie" — sharpened to three divergent aliveness contracts.** The same setup can receive *different zone sets* depending on execution path: (a) compiler — registry lookback, excludes invalidated+mitigated as-of anchor; (b) batched setup context — 7-day lookback, 50-row cap, excludes invalidated+mitigated; (c) **live single `fetchZones()` — NO age bound, NO cap, excludes invalidated only** (mitigated zones remain candidates). And migration `159_zone_lifecycle_open_rescan.sql` already rescans open zones — but only within a 10-day formation lookback; anything older (the 129-day zombies) is outside every rescan.
4. **"Tapped = consumed" — wrong; retest semantics are intentional.** The shared lifecycle treats first touch as informational and retests as valid candidates. The correct consumption contract is: **invalidated → dead · fill ≥ 95% → dead · mitigation ≥ 50% → strategy-flag · first touch → strategy-flag · max age exceeded → dead.** A blanket tapped-exclusion would break legitimate retest strategies.
5. **Foam mechanism confirmed structurally:** the zone producer scans the full supplied window each run and persists the top-5 ranked detections; repeated runs re-emit overlapping historical formations; `insertRows` dedupes by exact PK only (`symbol, tf, ts, kind, direction, top, bottom`), which identifies a stored *observation*, not a market *level*. Order blocks have `logical_id`; zones have nothing.

---

## Implementation plan — base-strength program

Phases B0→B4. Rule: **no raw-row deletion and no PK rewrites until the canonical view is signal-verified in shadow.** Every item lists change → files → tests → acceptance → effort.

### B0 — Canonical read-side + provenance (zero-risk, shadow only)

**B0.1 — Canonical-level view (the dedup the analyzer reads). Effort M.**
Migration creating `canonical_zones` VIEW: cluster raw zone rows by `(symbol, tf, zone_kind, direction, price_bucket)` where `price_bucket = round((top+bottom)/2 / grid)`, grid per symbol in `pairCharacteristics` (start: XAU $0.50, majors 5 pips); representative row per cluster = latest alive (`invalidated_at IS NULL OR invalidated_at > now()`), tie-break highest `quality_score`; carry `raw_ids int[]` + `rung_count` for audit and the foam metric. Files: new `infra/migrations/16x_canonical_zones_view.sql`; compiler + setupEngine switch reads to the view **behind a flag** (`TM_ZONE_CANONICAL=1`). Tests: the Jul-9 13:00 XAU ladder (10 rungs) collapses to 1 canonical row with `rung_count=10`; unit tests for cluster boundary cases. Acceptance: zones-per-setup median ≤ 3 on the anatomy analyzer; dup-rate < 5%; zero signal changes attributable to representative-choice on a shadow week (B0.3).

**B0.2 — Pivot provenance audit (before any producer change). Effort S.**
`scripts/audit-pivot-provenance.js`: group `features_pivot` rows by `engine_ver`; recompute the documented rule over the same candles; report per-version excess/missing. Decide: historical cleanup (delete stale-version rows) vs producer change — **only after the numbers say which**. Acceptance: a written answer to "why 114 vs 63" for the Jul 8–17 XAU window.

**B0.3 — Shadow signal comparison. Effort M.**
For one week of anchors per active zone-family variant: run the compiled SQL against `features_zone` vs `canonical_zones`; diff signal lists. Acceptance: diffs explainable row-by-row (each = a rung-vs-level choice); no unexplained new/ missing signals.

### B1 — One aliveness contract (the "is it alive?" function everything shares)

**B1.1 — `isLevelAlive()` helper, one semantic, four consumers. Effort M.**
`packages/shared/src/levels/aliveness.ts` implementing the contract: `invalidated → dead`, `fill_pct ≥ 0.95 → dead`, `mitigation ≥ 50% → strategy-flag`, `first touch → strategy-flag`, `age > maxAge(kind, tf) → dead` — plus an **as-of variant** for PIT (`isLevelAliveAsOf(row, anchor)`), and the SQL twin used by compiled queries (`sqlBuilder.buildFreshnessPredicate` rewritten to call the same rule table). Max-age table (initial): 15m zone 5d, 1h zone 14d, 4h 30d, 1d 90d; iFVG 15m 2d, 1h 5d; OB 15m 10d, 1h 30d. Tests: the five rules each with a fixture row; PIT/live produce identical verdicts on the same anchors. Acceptance: the 283 consumed-zone passers of the sweep window all fail the contract at anchor; the 129-day EURUSD supply zones are no longer `is_fresh`-eligible.

**B1.2 — Retire the three-contract divergence. Effort M.**
`packages/setupEngine/src/contextBuilder.ts::fetchZones()` (live): add registry-derived lookback + exclude `mitigated_at <= asOf` + cap **after** canonicalization (not before); batched context and compiler call the same helper from B1.1. Acceptance: same anchor → same candidate set across compiler / batched / live paths (test asserts set equality on fixtures).

### B2 — Selection: level-first, then quality, distance last

**B2.1 — Actionable-score ranking everywhere. Effort M.**
`setupEngine::deriveEntryZone()` and the specialized zone signal SQL: rank = (side-valid ∧ alive ∧ within distance threshold) → then `quality_score × rank_score` → distance **only as final tie-breaker**. Files: `packages/setupEngine/src/contextBuilder.ts` (deriveEntryZone), `packages/strategies/src/compiler.ts` (zone signal select ORDER BY). Tests: two candidate levels — nearer-but-low-quality vs farther-but-high-quality — the latter wins; ladder rungs (post-B0.1: one row) can no longer win by ±1 pip. Acceptance: on the sweep anchors, picked-level quality median rises; entry prices change only where the old pick was foam-driven.

### B3 — Producer-side identity (stop the foam at the source)

**B3.1 — `logical_id` for zones, shadow first. Effort L.**
Migration adding `logical_id` (hash of `symbol|tf|kind|direction|price_bucket` — same bucketing as B0.1) as a **nullable column + backfill**, no PK change; producer (`apps/engine/src/features/zone.ts`) upserts by `logical_id` instead of inserting new rungs (one row per level, refreshed on re-detection); raw observation log optionally kept in a shadow table for provenance. Files: zone.ts serialize/persist path, `apps/engine/src/dag/runner.ts` conflict handling for logical_id. Tests: 20 repeated runs over the same window produce 1 row per level, not N; `rung_count`-equivalent increment tracked. Acceptance: zone emission drops from 57–89 rows/day to ≤ 5 canonical rows/day/tf; the Jul-9 ladder case yields one row.

### B4 — Bias + timing (the last two base items)

**B4.1 — Bias hysteresis + real confidence. Effort S–M.**
`apps/engine/src/features/bias.ts`: neutral band around the decision threshold + minimum dwell (e.g. 4 bars at 15m before a flip is emitted) + confidence from margin-over-threshold (replaces the degenerate constant). Shadow-compare flip rate (XAU 4.4% → target < 2%, EUR 9.5% → < 5%) and one-week trade impact before promoting. Acceptance: one-bar whips (the Jul-13 sample) eliminated; no flip-rate collapse that starves strategies.

**B4.2 — Timing semantics (already planned: #16 + #34).**
Forward-causal chaining so setups fire when the level is actionable; limit-only mean-reversion entries with `allowMarketEntryAtLevel` escape hatch. Acceptance: inverted-causality = 0 in the anatomy pass; fill drift p95 < 10 pips XAU.

### Sequencing + gates

| Order | Work | Gate to proceed |
|---|---|---|
| 1 | B0.1 view, B0.2 provenance, B0.3 shadow | view verified; provenance answered |
| 2 | B1.1 contract, B1.2 path alignment | candidate sets identical across paths; zombies ineligible |
| 3 | B2.1 selection | quality-first picks verified on sweep anchors |
| 4 | B3.1 producer identity | emission ≤ 5/day/tf; shadow table reviewed |
| 5 | B4.1 bias, B4.2 timing | hysteresis shadow-pass; anatomy panel green |

**Standing metrics (the accuracy panel, run after each phase):** zones-per-setup ≤ 3 · dup-rate < 5% · level age within contract · placement correctness ≥ 85% · HTF-conflict visible/filterable · fill drift p95 < 10/2 pips · consumed-zone pass rate = 0.

---

## DB cleanup & retest protocol (verified against live DB state, 2026-07-22)

**Implementation state found:** #0/#29/#30/#32/#33/#35/#31 committed; canonical-zone shadow (migration 161 — PIT-safe `canonical_zone_observations` view + `canonical_zones_as_of()`) and `packages/shared/src/levels/aliveness.ts` in working tree; new rows are bucket-clean (0 off-bucket since Jul 21); direction_state recent rows dialect-consistent; feature_cache 100% versioned. **The stack is DOWN again/still** — 0 producer runs since Jul 21 07:31, candles frozen ~22h. **Pivot provenance (script run):** excess is *current* producer (engine_ver 1.2.0 only; 114 actual vs 65 expected, 57 matched, 57 excess, 8 missing) — and the excess rows share **one input_hash from one flush anchored 2026-07-10T21:55**, i.e. features computed on a stale candle vintage (pre-repair XAU import). Not a rule violation — a recompute-without-cleanup artifact.

### Answer: yes, partial cleanup is required — but it's three classes, not a wipe

**Class 1 — MUST clean (they poison new test results):**

1. **`setup_evaluations` cache rows** (6,896; zero new-format context hashes). The runner's context-hash cache would reuse pre-fix grades via `ON CONFLICT DO NOTHING`. `DELETE FROM setup_evaluations WHERE order_id IS NULL;` (keeps live order-linked audit rows; destroys only the cache).
2. **Off-bucket historical dense rows** — `session@5m` 24.8k, `htf_bias@5m` 14.5k, `atr` (all tfs), `displacement@15m`, `pricing`, `indicator`, `liquidity_pools`, `time_of_day_edge`, `bias`, `direction_state`. New rows are clean but the old off-bucket rows sit at *wrong anchors* in every PIT query. `DELETE … WHERE (EXTRACT(EPOCH FROM ts)::bigint % tf_seconds) <> 0` per affected table (they can't be overwritten by backfill — they're at different ts — so deletion is mandatory, then re-backfill).
3. **Stale-vintage features over the test window** (the pivot excess case proves the class exists): after Class-2 deletes, re-backfill the full feature closure over the test window with the fixed engine so every row is same-vintage: `refresh-candle-caggs.js` → `backfill-historical-features.js <SYMS> 1d,4h,1h,15m,5m --start <from> --end <to>` → `refresh-lifecycle.js ALL 30 10000` (full rescan, resets cursors).

**Class 2 — MUST recompute (state, not rows):**

4. **Zone aliveness over existing rows**: full lifecycle rescan (above) refreshes `invalidated_at`/`mitigated_at`/`fill_pct` with current semantics; then apply the max-age expiry over stored rows (`is_fresh=false` past the per-kind contract — 129-day zombies currently read fresh in live via `trustStoredLifecycle`, so a table UPDATE is required, the query-side contract alone doesn't cover live).

**Class 3 — MUST NOT touch (self-healing or harmless):**

- `feature_cache` (100% versioned — orphans harmless), `feature_producer_runs` (history), `backtest_results` (keep as labeled pre-fix vintage; the API pins latest run), `direction_state` old dialect rows (recent rows consistent; reconcile only if testing deep history), canonical views (recomputed on read), Redis/in-process compiled cache (restart clears; spec-hash fix forces fresh compiles anyway).

### Order of operations

1. **Restore the stack first** (runbook: PG → tz-ingestion → web → health-poll → `pm2 save`) — it's been down ~17h again; live-side verification is impossible until then. DB-only cleanup (Class 1 deletes) can run while down.
2. Class 1 deletes → Class 1.3 re-backfill + Class 2 lifecycle rescan + max-age expiry.
3. **Retest:** re-run the 49-variant 15d sweep (`temp/audit15d/batch.sh`), then `analyze.js`, `rootcause.js`, `zoneanatomy.js`, `llhh.js` — compare against the accuracy panel (zones-per-setup ≤ 3, dup < 5%, consumed-pass-rate = 0, off-bucket = 0, drift p95 < 10/2, inverted-causality = 0, placement ≥ 85%).
4. Only then judge strategies — the pre-cleanup numbers and post-cleanup numbers are different instruments; do not mix them in one report.

### Audit results — exact dry-run counts (2026-07-22, read-only, no deletes executed)

**Stack health (restore first — time-sensitive):** PM2 empty (0 apps); ingestion :3004 down; web :3000 down; candles frozen: majors **20.9h**, XAUUSD **23.9h**, DXY **108.9h**; 0 producer runs since Jul-21 07:31; lifecycle cursors frozen at Jul-21 03:36. **EA spools are alive and growing: 11 MB across 9 symbol files** (`Terminal\Common\Files\tradzfx\spool\*.jsonl`) — bars are recoverable via FIFO replay, but the spool is size-capped: every hour down raises loss risk.

**Class 1.1 — `setup_evaluations`:** 6,896 total → **6,887 cache rows to DELETE** (`order_id IS NULL`), 9 order-linked audit rows to keep.

**Class 1.2 — off-bucket dense rows: 78,270 total to DELETE**, per table: `features_session` 28,299 (5m 24,817) · `features_htf_bias` 22,408 (5m 14,540) · `features_atr` 11,971 · `features_displacement` 7,121 (15m 6,273) · `features_bias` 2,173 · `features_pricing` 1,993 · `features_direction_state` 1,878 · `features_spread` 359 · `features_liquidity_pools` 328 · `features_indicator` 198 (33/tf, one bad batch) · `features_time_of_day_edge` 84. (`features_opening_range` excluded — completion-ts by design.)

**Class 2 — contract-excluded rows (informational; NO delete/UPDATE per the corrected max-age rule — the shared `LEVEL_MAX_AGE_DAYS` contract excludes these at query time):** zone: 5m 405,931 · 1m 203,291 · 1h 51,747 · 15m 40,376 · 4h 12,823 · 1d 594. ifvg: 5m 198,357 · 15m 24,648 · 4h 6,451 · 1m 3,372 · 1d 346. order_block: 5m 10,164 · 1h 686 · 15m 577 · 1m 297 · 4h 63.

**Zombies held for the future shared-semantics expiry pass (NOT touched now):** 394 rows with `is_fresh=true` older than 30d (zone 199, ifvg 141, order_block 54) — stored expiry must go through the shared `LEVEL_MAX_AGE_DAYS` + PIT-safe lifecycle semantics only; no blanket `is_fresh=false` UPDATE (retest strategies + compiler-policy parity depend on it).
