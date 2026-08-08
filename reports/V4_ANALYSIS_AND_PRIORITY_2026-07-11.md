# V4 Full Sweep Findings — Independent Analysis & Prioritized Action Plan

**Date:** 2026-07-11
**Author:** Kimi (verification pass against live repo + DB)
**Sources:** `V4_FULL_SWEEP_FINDINGS.md`, `reports/BACKTEST_FAILURES_AND_BUGS_2026-07-10_V3.md`, live DB probes (tradzfx_v2), repo code inspection

---

## 1. Verdict on the report

The V4 report is **substantially accurate and well-verified** (its own Codex addendum reran the key claims against the DB — good practice). Three caveats:

1. **BUG-11 (ORB stale opening-range join) is the scariest finding and it is REAL.** Code confirmed at `scripts/backtest-pit-v2.js:582-583` — a generic `MAX(ts) <= signal_ts` latest-as-of join for a session-scoped object. It **fabricates trades**: 35 executed, 54.3% WR, +22R of phantom results from opening ranges a median of ~465 minutes (max ~70h) old. Any ORB win-rate claimed from the default PIT path is invalid until fixed.
2. **BUG-1's root-cause hypothesis is the weakest part.** The setup-engine block reasons (`"All nearby zones have already been tapped"`, `"No entry zone within 1.5 ATR"`) come from simple deterministic rules in `packages/setupEngine/src/rules/hardRules.ts` — there is no evidence of the "tap state persists across signals" bug the report hypothesizes. The sharper diagnosis (already in V3 §7.3) is: **zone-proximity/tapped-zone hard rules are applied universally to every strategy family**, including ORB breakouts that should be evaluated on range/displacement/session rules. It is a design flaw plus stale/sparse data (ATR, displacement), not a state-leak bug.
3. **Several claims are already outdated** (see §2) — some "missing" things now exist in code/DB. The V3 report's §7.2 already corrected the biggest ones.

## 2. Claim-by-claim verification (live DB, 2026-07-11)

| V4 claim | Live check | Status |
|---|---|---|
| ORB stale `MAX(ts)` join | `backtest-pit-v2.js:582-583` exact match; `features_opening_range` has `date`+`session` cols (fix needs no migration) | **CONFIRMED — P0** |
| `features_zone` explosion | 24,616,047 total rows; XAUUSD@5m = 2,911,399 | **CONFIRMED — P0** |
| `a_plus_orb_fvg_5m` timeout (57014) | Consistent with 2.9M-row lateral joins, no lookback bound | **CONFIRMED — P0** |
| ATR@1m XAUUSD stale | latest = 07-03 14:52 UTC (~8 days); EURUSD@1m fresh (07-10 23:12) — XAU 1m producer dead, not a global ATR outage | **CONFIRMED (narrower than stated)** |
| ATR outliers (max 1643.10) | 7 rows >100, 11 `is_valid=false` still in history | **CONFIRMED, but mitigated**: quality cols exist and the backtest runner already uses `COALESCE(effective_value, value)` (lines 59, 80) |
| Missing 1m features (zone_retest, candle_pattern, pricing) | @1m = 0 rows for XAUUSD — but 505K/17K/31K rows exist at other TFs | **CONFIRMED for @1m only** |
| displacement@1m sparse | XAUUSD = **0** rows; EURUSD = 295 (waqar_v2's surface) | **CONFIRMED** |
| sweep@15m, ifvg@5m, OB@1m sparse | 0 / 273 / 3 rows respectively | **CONFIRMED** |
| MIN_WARMUP_CANDLES=200 hardcoded | `backtest-pit-v2.js:110`; `computeWarmupTs()` already accepts a `minCandles` param — trivial to wire to spec | **CONFIRMED — easy win** |
| Inline trigger missing ATR/spread | **OUTDATED** — `pipelineTrigger.ts` includes `features_atr@15m`, `features_spread@1m`, `features_session@1m` (V3 §7.2 already corrected this) | Partially fixed |
| candles_1d missing | **Reclassified** — `candles_1d_utc` is canonical (SK-11, closed) | Not a bug |
| market_levels 3.3M stale | **Reclassified** — table now empty; `market_levels_view` is canonical | Not a bug |
| check-feature-freshness.js no dotenv | Confirmed — fails with SCRAM error without `-r dotenv/config` | **CONFIRMED — P1** |
| refresh-lifecycle.js not scheduled | No pm2 app, no schtasks entry | **CONFIRMED** |
| Live engine barely trades | 14,670 rejections vs **4 signals** in 7 days (latest 07-09) — worse than V3's 8,379/4 | **CONFIRMED — P0 investigate** |

## 3. Prioritized action plan

### P0 — do immediately (truth/safety, ordered by danger × effort)

| # | Fix | Why first | Effort | Status |
|---|---|---|---|---|
| 1 | **ORB session-scoped join** (`backtest-pit-v2.js:582`): replace `MAX(ts)` with same-`symbol`/`tf`/`session`/`date` match (+ `ts >= range complete` guard). Columns already exist — no migration. Then rerun orb_classic default vs `PIT_USE_COMPILER_SQL=1` and require parity. | Stops fabricated trades/results; every ORB number currently published is suspect | 0.5–1d | ✅ DONE 07-11 (session_scoped join policy, spec validation, data repair, tests) |
| 2 | **Live spread-source investigation**: live engine sees 40–102p XAU spreads while `features_spread` holds 2.7–3.1. Find where `liveRunner` reads spread (unit/source drift). With only 4 signals/7d the exposure is small, but a unit bug in a live gate is a real-money risk. | Live-trading safety | 0.5d investigate | ✅ DONE 07-11 (pipMath 4-digit fix, USDSEK registration, producer caps, data repair 292 rows, EA pipDigits) |
| 3 | **Zone-query quick win**: add bounded PIT lookback (`ts >= signal_ts - interval '7 days'`, configurable) in `compilePITSQL` + partial index `(symbol, tf, ts DESC) WHERE is_fresh`. Unblocks `a_plus_orb_fvg_5m` and cuts 1.5s queries without touching the 24.6M-row structure. | Unblocks a whole strategy class | 0.5–1d | ✅ DONE 07-11 (registry-bounded lookback 8h@5m, predicate pushdown, covering index 107, LATERAL candles join; 90d ALL = 2m35s) |
| 4 | **Revive XAU ATR@1m producer + schedule `refresh-lifecycle.js`** (pm2 app or schtasks): ATR@1m dead since 07-03; lifecycle refresh unscheduled entirely. | Gates/distance filters fly blind on the tail of every window | 0.5d | ✅ DONE 07-11 (risk-ATR collection in pipelineTrigger + freshness guardrail; `tz-refresh-lifecycle` pm2 cron 6h; historical backfill) |
| 5 | **Spec-configurable warmup**: wire `spec.warmupBars` into `computeWarmupTs` (param already exists) + preflight warning when warmup eats 100% of signals. | Unblocks 12 keylevel variants for 0.5d | 0.5d | ✅ DONE 07-11 (`spec.warmupBars` wired, seed-time validation ≥50, tests) |

### P1 — this sprint

6. **Family-aware setup profiles** (the real BUG-1 fix): `zone_reversal` gets zone proximity/tap rules; `orb_breakout`/`fvg_continuation`/`indicator` get their own rule sets. Until then, full-mode block rates are uninterpretable.
7. **Feature/TF capability matrix + seed gate**: block/park specs requiring empty surfaces (zone_retest@1m, candle_pattern@1m, pricing@1m, displacement@1m-XAU, sweep@15m, OB@1m). Mark 1m-OB specs experimental.
8. **Audit-script hardening** (BUG-13): dotenv bootstrap everywhere, PowerShell-safe argv, nonzero exit on DB failure, registry-driven thresholds.
9. **Shared `runSystemHealthCheck()`** (BUG-12): replace READY fail-open with `READY / DEGRADED_DATA / BLOCKED_MISSING_DATA / BLOCKED_STALE_STATE / BLOCKED_SEMANTIC_JOIN / BLOCKED_COVERAGE` used by live, PIT, and promotion.
10. **ATR quarantine at ingest + recompute** of the 11 invalid rows; audit that no consumer selects raw `value` without the effective_value coalesce.

### P2 — structural (plan, don't rush)

11. Zone table structural fix: stable `zone_id`/anchor-hash dedupe → upsert-by-identity, then hypertable/partition + 90d retention (destructive ops need `TM_ALLOW_DESTRUCTIVE=1` + backup per repo rules).
12. Compiler/default PIT unification: parity tests first, then deprecate the legacy fork (it's the one with BUG-11).
13. Spread data contract (bid/ask provenance on every 1m row — currently 286 rows/90d).
14. Direction Arbiter mandatory; `strategy_signal_candidates` audit table; symbol contract layer (pip size per asset class — the root of the XAU-vs-FX gate miscalibration from V3 BUG-3.1).
15. `market_levels_view` consumer migration; `candles_1d` consumer cleanup; `ALL_ALLOWED` symbol mode for the runner.

## 4. V3 pending tasks — status roll-up

From `reports/BACKTEST_FAILURES_AND_BUGS_2026-07-10_V3.md` Part 6 + §7.3:

| V3 task | Status today |
|---|---|
| **P6-1** Volatility-gate thresholds for XAUUSD on orb_classic/watukushay_no1 (live strategies, 0 trades) | **STILL OPEN** — live engine still 4 signals/14,670 rejections in 7d |
| **P6-2** ATR5 corruption: sanity cap + recompute | **PARTIAL** — quality cols + `effective_value` coalesce in backtest runner done; ingest quarantine + historical recompute + runner sanity cap still open |
| **P6-3** XAUUSD lifecycle refresh 500–700h stale | **DONE 07-11** — `tz-refresh-lifecycle` pm2 cron (6h, ALL 2 5000) deployed and running |
| **P6-4** Live spread discrepancy (40–102p vs 2.7–3.1) | **DONE 07-11** — P0-2 root causes fixed + data repaired |
| **P6-5** Statement timeout on complex strategies | **DONE 07-11** — P0-3 (90d ALL a_plus = 2m35s) |
| **P6-6** XAUUSD missing from FX-only symbol lists | Open (intentional for some specs; needs decision, not code) |
| **§7.3-1** Family-aware setup (universal zone hard-block) | **STILL OPEN** — P1-6 |
| **§7.3-2** Backtester SQL fork → one compiler path | **STILL OPEN** — P2-12 |
| **§7.3-3** Coverage preflight → shared health check | **STILL OPEN** — P1-9 |
| **§7.3-4** Producer scheduler with SLAs + blocking gate | **PARTIAL** — lifecycle cron + risk-ATR freshness guardrail done (P0-4); full producer SLA scheduler remains P1 |
| **§7.3-5** features_zone explosion structural fix | **STILL OPEN** — P0-3 (quick) + P2-11 (structural) |
| **§7.3-6** Data-collection contract per feature/tf | **STILL OPEN** — P1-7 |
| **§7.3-7** ATR outliers quarantine + effective_value enforcement | **PARTIAL** — P1-10 |
| **§7.3-8** Spread source contract | **STILL OPEN** — P2-13 |
| **§7.3-9** Mandatory Direction Arbiter | **STILL OPEN** (direction_state exists, not mandatory) — P2-14 |
| **§7.3-10** Candidate audit table | **STILL OPEN** — P2-14 |

Also still deferred from earlier skeleton work (this session's context): SK-43 destructive DROP cleanup (needs `TM_ALLOW_DESTRUCTIVE=1` + backup), SK-33 residual persisted `input_hash`, SK-58 residual tuning, DST/winter gold-break caveat (21:00 UTC fixed vs 22:00 winter).

## 5. What is already done (don't redo)

- `BLOCKED_SYSTEM_QUALITY` preflight (missing dense features block instead of fake 0-trade results)
- `FEATURE_REGISTRY` (semantic type, join policy, freshness, lookback) + `sqlBuilder.ts`
- ATR quality columns + `effective_value` coalesce in backtest runner
- `candleSource.ts` market-calendar-aware coverage/gap counts; `candles_1d_utc` canonical daily
- `market_levels_view` (raw `market_levels` emptied); `features_direction_state` exists
- Inline trigger includes atr@15m / spread@1m / session@1m
- Ingest resilience (this week): server+EA spools, gated restarts, weekend EA clock fix, MT4 port

**Bottom line:** Do P0-1 (ORB join) and P0-3 (zone lookback) first — they are small, and together they make backtest numbers interpretable again. P0-2 is the only item with real-money exposure. Everything else can follow the plan order. No strategy tuning until P0-1, P0-3, and the family-aware setup profile (P1-6) are in.
