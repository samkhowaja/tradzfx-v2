# Apex Scalp — derivation & design doc

**Source:** https://www.youtube.com/watch?v=hzC8caHg-Yg — "This 5 Minute Scalping Strategy Is Boring, But It Beats Most Trading Strategies" (17:36), archived 2026-07-22 at `data/video-strategy-hzC8caHg-Yg/` (video.mp4, video.en.srt, README).

**Spec:** `packages/strategies/src/specs/apex_scalp.yaml` (family) + `apex_scalp_orb_v1.yaml` (ORB variant) + `apex_scalp_ob_v1.yaml` (order-block variant). Progressive `steps[]` architecture.

---

## 1. The video's system → engine mapping

The video is a 3-step checklist, strictly ordered (direction first, entry last — "you can't start off with the entry and move our way back"):

| Video rule | Engine implementation |
|---|---|
| **Step 1 — Direction:** trend = HH/HL (bullish) or LH/LL (bearish) structure; range = between key levels with no continuation | `trend_bias` step: `features_bias@15m`, `direction != 'neutral'` (bias computes structure + regime internally) |
| **Trend strength gauge:** EMA 9 & 21 — above both = bullish, below both = bearish, between = range/avoid | Subsumed by the bias feature's factor model (HTF alignment + structure + regime). A literal `fast>slow` MA step was tested and rejected — it adds no filter beyond bias (watukushay tautology lesson, §3.4.2 of the audit). |
| **Step 2 — Setup (a): NY opening range** — first 5m candle of the NY session marks high/low; a 5m CLOSE beyond the range = continuation | `opening_range` step: `features_opening_range@5m`, `session: ny`, `range_minutes <= 30`, TTL 240m, **`autoAlignDirection: false` (required — the table has no `direction` column; the migration guide's Rule-3 table wrongly claims it has one)**. `signalSource: orb` computes entry at the range edge and SL at `orb_midpoint`. |
| **Step 2 — Setup (b): order block retest** | `order_block` step: `features_order_block@5m`, `is_fresh = true`, TTL 240m, direction aligned via chain. `signalSource: zone` with limit entry at OB edge. |
| **Step 2 — Setup (c): previous day high/low retest** (trend: break & hold; range: rejection bounce) | **GATED — not seeded.** `features_session_hl@1d` is stale (rows from March) and its view selects duplicate column names. Repair first (producer + view), then add `apex_scalp_pdh_v1`. |
| **Step 3 — Entry: 1m continuation trigger** | `structure_break` entry: `features_structure@1m`, `event_type IN ('bos','choch','mss') AND direction = features_bias.direction`, `structureFreshnessMinutes: 30`. |
| **Discipline:** 1–2 A+ setups/day, boring, less-is-more | The whole point of progressive steps + freshness TTLs: the checklist must all align within bounded windows or there is no trade. |

## 2. Design decisions (and the evidence behind them)

1. **Progressive steps, not flat.** The video's explicit ordering is exactly the progressive model: each step is anchored to the previous step's row (bias bar → setup within TTL → fresh 1m trigger). This was the user's stated reason for the architecture migration.
2. **Limit entries at the level edge** (`entryConfig.type: limit`). Evidence: `reports/PRO_LTF_MULTI_PAIR_MATRIX_2026-07-22.md` — identical signals, market entries carried median drift of 4.9 pips on a 10-pip stop on GBPUSD (netR −17.8/−24.2/−19.3 across market variants) while limit entries were +5.0/+3.0 with zero drift at identical MFE. Limit fills are modeled honestly: touch-at-edge or unfilled (12% unfilled measured).
3. **`timeoutBars: 0`** — no artificial cap; trades resolve at SL/TP or window end (user directive 2026-07-22: "lets not use timeouts at all… if it runs for days let it run").
4. **SL at `orb_midpoint` for the ORB variant** (the video's structure stop; validated by orb_classic), fixed 10-pip SL for the OB variant (matrix-validated geometry for EURUSD-class majors; TP `sl * 2.0`, minRR 2).
5. **Break-even NOT included.** BE@+1R was tested and rejected on every pair (−0.36 … −12.91 netR; post-+1R pullbacks are structural to the pattern). If management is wanted later, it's BE@1.5–2R or a trail as a *new* variant, not a tune of this one.
6. **Entry direction is chained, not re-stated:** `direction = features_bias.direction` resolves to the root bias alias in the progressive compiler (verified in compiled SQL).

## 3. Validation status

- [x] Specs written in canonical YAML (`packages/strategies/src/specs/`)
- [x] Seeded surgically (family + variants) — **deliberately `is_active=false` at seed time** so the single-variant live observation (`pro_ltf_scalp_eurusd_v1`) is undisturbed
- [x] Compile smoke: all variants compile PIT + live, zero validateSpec errors
- [x] 15d backtest on EURUSD for `apex_scalp_orb_v1` and `apex_scalp_ob_v1` (see §4 in this doc once run)
- [ ] 60–90d walk-forward (after the all-symbol backfill completes)
- [ ] Activation decision (user-owned; flip `is_active=true` to observe live)

## 4. Backtest results (15d EURUSD, post-cleanup harness, `timeoutBars: 0`, limit entries)

Run 2026-07-22 after geometry fixes (`autoAlignDirection:false` on `opening_range` + `order_block`, `ob_kind` chain alignment, `minSlDistancePips: 10` floor on the midpoint stop):

| variant | signals | executed | W/L | netR | notes |
|---|---|---|---|---|---|
| `apex_scalp_orb_v1` (ORB) | 9 | 5 (4 setup-blocked) | 1/4 | −2.00 | avgW 2.0R, avgL −1.0R — mechanics valid (0 invalid geometry); NY-open ORB on EURUSD is low-volume this window; 5 trades, no statistical weight |
| `apex_scalp_ob_v1` (OB retest) | 59 | 5 (36 blocked, 18 deduped) | 2/1 (+2 window-end) | **+3.00** | WR 66.7% decisive, avgW 2.0R — the stronger of the two setups here |

Implementation notes for the next reader:
- **All 9 initial ORB signals were rejected by the minStop guard** (`orb_midpoint` on 3–7 pip ranges → 1.8–2.5 pip stops < the 3-pip floor) — the guard worked as designed; fixed by `minSlDistancePips: 10`, which floors the midpoint stop at 10 pips (LEAST/GREATEST side-aware clamp in `riskCompiler.ts`).
- **`features_opening_range` has no `direction` column** and **`features_order_block` uses `ob_kind` not `direction`** — the migration guide's Rule-3 table is wrong for both; `autoAlignDirection: false` is mandatory on these steps (else runtime `column pit_*.direction does not exist`), with direction aligned via `ob_kind = features_bias.direction` for OB.
- Compiler/validator fixes made along the way: orb/fvg signal selects now read `spec.setup ?? []` + `spec.steps ?? []`; `validate.ts` condition list now includes `steps[]` (progressive + orb/fvg signalSource no longer crashes).

## 5. Known gaps / follow-ups

- **PDH/PDL variant** requires `features_session_hl` repair (stale rows since March + malformed view with duplicated column names). Tracked as a data-repair item.
- The video's EMA-9/21 literal filter is intentionally not a step (subsumed by bias; redundant steps only add failure modes).
- USDSEK and XAUUSD excluded from `filters.symbols` (spread/instrument class, consistent with the multi-pair matrix findings; USDCHF retained here but flagged from the matrix as a weak environment for this pattern).
