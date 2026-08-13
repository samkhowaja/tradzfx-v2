# v4 LARGE_JUMP Adjudication Policy — 2026-08-13

Status: **proposed for human sign-off**. Read-only evidence complete; no row decided yet.
Scope: the **641 active-UNKNOWN** `LARGE_JUMP_*` quarantine rows (642 minus the 1
DXY synthetic-boundary KEEP proposal). This is the human/policy stage that §5 proved
necessary — no automated tier resolves them.

## 0. Why this policy exists

§5 (`propose-quarantine-decisions.js`) returned **1 auto-proposal / 641 none**. Every
automated bucket is empty for this set:

- 0 structurally corrupt (no `INVALID_OHLC`, no `IMPOSSIBLE_SPREAD`)
- 0 calendar-explained gaps (no gap-only rows classify non-UNEXPECTED)
- 0 broker-replaceable (502 no-alternate; 138 alternate all close-diverge or spread-blocked)
- 1 DXY synchronized component reset (KEEP, already-approved conflict)

The remaining 641 are **genuine unexplained LARGE_JUMP anomalies**. The fail-closed
contract correctly refuses to auto-decide them. This document defines the **human
policy** that does — once, consistently, per symbol class — so backfill + parity unblock
on adjudicated intervals without weakening canonical rules.

## 1. Evidence per row (the review grid)

`scripts/report-adjudication-grid.js` (read-only) enriches each of the 641 with:

- `jumpPips` — |Δclose| in pips (pip size per digit convention)
- `jumpPct` — |Δclose|/prevClose %
- `jumpAtr` — |Δclose| / ATR₁ₘ(14) over trailing 30 1m bars (the normalizer)
- `rangePips` — (high−low) of the quarantined bar in pips
- `session` — asia / london / ny / offhours (UTC)
- flags, severity, detector_version, broker identity

Output: `reports/adjudication-grid-v4-2026-08-13.json/.md`. **`jumpAtr` is the primary
adjudication metric** — it normalizes a jump against the pair's own recent volatility,
so a "large" move in a quiet tape scores high and the same absolute move in a volatile
tape scores low. Grid coverage: **634/641** rows have a full metric set; **9** lack one
(2 DXY rows have no canonical candle to measure, 7 at the window edge lacked a prior bar
for ATR) — those 9 default to UNKNOWN_EVENT pending manual look.

## 2. Decision outcomes

Each row lands in exactly one:

| Outcome | DB `decision` | Meaning | Blocks interval? |
|---|---|---|---|
| `KEEP_EXTREME_MOVE` | `KEEP` | Plausible real event move. Corroborated. | No — candle enters canonical |
| `EXCLUDE_CORRUPTION_SPIKE` | `EXCLUDE` | Implausible spike, no corroboration, feed glitch | Yes — excluded from canonical |
| `UNKNOWN_EVENT` | `UNKNOWN` (stays) | Insufficient evidence either way | Yes — permanent blocker for that window |

## 3. Per-symbol-class rules (v4 MAD-grounded)

**Observed `jumpAtr` distribution** (`adjudication-grid-v4-2026-08-13.json`, 634 rows with metrics, 9 no-metric):

| Symbol | n | min | p50 | p90 | max |
|---|---|---|---|---|---|
| XAUUSD | 210 | 0 | 15.7 | 21.2 | **29.7** |
| USDJPY | 67 | 2.2 | 5.7 | 21.4 | 26.5 |
| USDSEK | 85 | 2.6 | 8.2 | 18.5 | 22.3 |
| GBPUSD | 74 | 2.9 | 12.9 | 24.8 | 26.0 |
| EURUSD | 64 | 2.6 | 8.0 | 22.2 | 23.4 |
| AUDUSD | 51 | 3.4 | 8.8 | 21.0 | 22.6 |
| NZDUSD | 47 | 3.6 | 10.5 | 20.6 | 22.5 |
| USDCHF | 27 | 2.8 | 8.3 | 21.0 | 22.8 |

**Decisive finding: the distribution is continuous and bounded — there are NO outliers.**
Every symbol tops out at **22–30× ATR₁ₘ**; no row reaches the 40–60×+ "corruption spike"
regime. Medians sit at 6–16×. This means the quarantined set is **not a mix of a few wild
bad ticks plus noise** — it is a coherent band of large-but-plausible moves (event/trend
minutes) that the symmetric MAD detector flagged because they exceed its threshold, not
because they are malformed. The adjudication is therefore **not "find the corrupt spikes"**
— there are none by magnitude. It is **"confirm these are genuine event moves and KEEP
them, or hold the uncorroborated ones."**

### Rules (uniform across classes — the distribution justifies one band)

- `jumpAtr` ≤ 3 → **KEEP** (within normal 1m vol; detector over-fired). Small minority.
- 3 < `jumpAtr` ≤ 30 (≈ all 634) → **KEEP if corroborated** (cross-symbol/DXY consistency
  at the same ts, or a documented event window); else **UNKNOWN_EVENT**. Magnitude alone
  does NOT disqualify — the max (29.7) is within plausible crisis range.
- `jumpAtr` > 30 → **EXCLUDE** as corruption spike. **Zero rows currently qualify.**

The class-specific threshold table is retained only as corroboration *prior* (XAUUSD/DXY
carry the queue and get the closest review), not as different EXCLUDE cutoffs — the data
shows one continuous band across all symbols.

## 4. Corroboration ladder (cheap → expensive)

For the 3–30× ATR judgment zone, in order:
1. **Cross-symbol** — did DXY / a correlated pair move consistently at the same ts? (cheap, DB)
2. **Session/calendar** — known event window (NFP first Fri, CPI, FOMC, CB decisions)?
3. **Cross-broker** — where an alternate exists, does it show the move? (§4: only 138 do, 114 diverge)
4. **External** — public chart/data for that minute. (expensive; reserve for tie-breaks)

A row is **KEEP** only if it clears ≥1 cheap corroboration or lands in a documented
event window. No corroboration + no event → **UNKNOWN_EVENT** (do NOT guess KEEP).

## 5. Execution protocol (auditable, human-driven)

1. **Freeze** the grid + detector output for this round (no threshold changes mid-round).
2. Review per symbol class, sample across the `jumpAtr` spectrum to sanity-check the
   thresholds in §3 against real bars before applying.
3. Produce a **hand-curated decision file** `reports/adjudication-decisions-v4-2026-08-13.json`:
   `[{quarantineId, decision, rationale, corroboration}]` — NOT the auto-proposal file.
4. Apply via `apply-quarantine-decisions.js` pointed at that file, in a transaction,
   only after explicit authorization.
5. Re-run the INVARIANT query; target `active_unknown` down to the small residual
   UNKNOWN_EVENT set, `approved` up by the KEEP+EXCLUDE count.

## 6. Hard holds (unchanged during adjudication)

- No `--apply` / no decision writes without explicit authorization.
- No gate flips. No migration 193. ATR lineage held. Ingestion closed. features_zone untouched.
- UNKNOWN_EVENT rows stay blocking — adjudication is not obligated to zero them.

## 7. Corroboration rubric (grounded in `report-corroboration.js`, 2026-08-13)

Cheap corroboration computed read-only: same-minute cross-symbol co-movement, DXY sign
check, event-minute clustering. Result over 634 rows: **395 corroborated / 239 isolated /
223 event clusters.**

| Symbol | n | corroborated | isolated | DXY confirm | DXY contradict |
|---|---|---|---|---|---|
| EURUSD | 64 | 63 | 1 | 56 | 2 |
| USDJPY | 68 | 62 | 6 | 60 | 7 |
| GBPUSD | 75 | 62 | 13 | 54 | 16 |
| USDCHF | 28 | 23 | 5 | 14 | 13 |
| AUDUSD | 52 | 30 | 22 | 20 | 9 |
| NZDUSD | 48 | 29 | 19 | 20 | 17 |
| USDSEK | 87 | 46 | 41 | 35 | 24 |
| XAUUSD | 212 | 80 | 132 | 76 | 89 |

### 7.1 The split that matters

- **Majors are nearly all corroborated.** EURUSD 63/64, USDJPY 62/68, GBPUSD 62/75.
  When EURUSD spikes, DXY moves opposite and GBPUSD/AUDUSD move with it — classic
  USD-complex event signature. These are strong KEEP candidates.
- **XAUUSD flips it: 132/212 isolated, and 89 DXY-contradict vs 76 confirm.** Gold's
  large 1m moves are frequently *idiosyncratic* — safe-haven flows, geopolitical shocks,
  thin-liquidity metals repricing — NOT USD-driven. XAUUSD needs a different evidentiary
  bar than FX majors.

### 7.2 Per-class KEEP rubric (what counts as "enough evidence")

| Class | KEEP if | Stay UNKNOWN_EVENT if |
|---|---|---|
| **FX majors** (EUR/GBP/JPY/CHF/AUD/NZD/CAD) | `coMoveCount ≥ 1` OR `dxySign=confirm`. Co-movement IS the corroboration — an isolated major jump with zero peers is the anomaly. | `coMoveCount=0` AND `dxySign≠confirm` AND no known event. |
| **USDSEK** | Lower co-movement baseline (thin Nordic tape). KEEP if `dxySign=confirm` OR a documented Scandi/Riksbank event, even with `coMoveCount=0`. | isolated AND DXY-contradict AND no event. |
| **XAUUSD** | Do NOT require FX co-movement. KEEP if (a) lands in a multi-symbol event cluster, OR (b) documented macro/geopolitical event window, OR (c) DXY-confirm. Idiosyncratic gold moves are expected. | isolated AND no event AND DXY-contradict. |
| **DXY** | Only non-boundary rows adjudicated. KEEP iff ≥2 components jumped same-direction (formula check). | otherwise. |

### 7.3 Practical review scope

- **~395 corroborated rows** (majors + DXY-confirmed XAUUSD) → batch-review by event
  cluster (223 clusters); most resolve to KEEP on the co-movement signature alone.
  Sample-check ~15 clusters against external charts to validate the rubric, then the
  rest follow.
- **239 isolated rows** are the genuine human queue. Of these, **132 XAUUSD** are the
  bulk and mostly need an external/event check (gold idiosyncrasy means co-movement is
  the wrong tool). The ~107 isolated FX/SEK rows are the harder anomalies — a major that
  jumped with no peer confirmation is exactly what quarantine exists to hold.

### 7.4 What the rubric forbids

- No KEEP on magnitude alone. No KEEP on "looks plausible." Corroboration or a cited
  event is mandatory.
- DXY-contradict is not auto-EXCLUDE (gold legitimately diverges); it only blocks the
  cheap corroboration path and pushes the row to the human/external rung.
- No auto-apply. Decisions recorded in the hand-curated file, applied once, authorized.
