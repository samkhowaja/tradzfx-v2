# Detector freeze spec — 2026-08-13

Status: governance artifact, read-only. No gate flips, no migrations, no detector-code changes.
Authority: `market.detector_config` (migration 183) + `market.trusted_windows` (183/185).

## 0. Queue-item correction

Session directive said "detector v3 freeze." Ground truth (2026-08-13): **v3 is already
superseded.** The calibration lineage ran v3 → v4 → v5.1 → v5.2 → **v5.3** on 2026-08-04/05.
Freeze target = the ACTIVE row:

| detector_version | status | supersedes |
|---|---|---|
| candle-detector-v3-robust | draft | — |
| candle-detector-v3-robust@20260804 | draft | — |
| candle-detector-v4-calibrated@20260804 | draft | v3@20260804 |
| window-certifier-v5.1-range-warning@20260805 | retired | v4@20260804 |
| window-certifier-v5.2-dxy-formula@20260805 | draft | v5.1 |
| **window-certifier-v5.3-spreadzero-keep@20260805** | **active** (2026-08-05T05:56:50Z) | v5.2 |

Quarantine evidence reflects the same: v1 fully superseded (619 rows, 0 active);
v2-calendar audit-only (356 UNKNOWN active, audit trail); v3-robust audit-only
(286 UNKNOWN active); adjudicated KEEP/EXCLUDE rows survive under their versions +
`manual-break-edge-policy-v1` (5 KEEP) + `manual-spreadzero-review@20260805` (11 KEEP).

## 1. Frozen contract: window-certifier-v5.3-spreadzero-keep@20260805

Source of truth: `market.detector_config.config` (frozenAt 2026-08-05T05:56:50.419Z).
This section restates it as the dispute-resolution contract.

**Policy:** `block_corruption_not_volatility` + spread-zero KEEP-review exception.

**Baseline:** rolling median/MAD, `lookbackBars: 60`.

**Metric rules:**

| Metric | Side | Action | Formula |
|---|---|---|---|
| ret | symmetric | block unless KEEP-reviewed | `|rel_ret − rolling_median| > max(hardFloorRet, madMultiplier × MAD)` |
| range | upper only | **warning only** | `rel_range − rolling_median > max(hardFloorRange, madMultiplier × MAD) + 1e-12`, `relRange = (h−l)/o` |
| spread | — | block | absolute cap pips; zero = missing_unresolved_block |
| quarantine | — | block | undecided/UNKNOWN blocks; replaced requires evidence; EXCLUDEd dropped from canonical via migration 186 NOT EXISTS filter |
| DXY synthetic boundary | — | block unresolved only | formula validation: row present AND `|close − formula|/formula > 0.5%` → UNRESOLVED (blocks); formula-consistent → resolved; row absent → resolved. Component-jump heuristic (floor 0.001, ≥2 of 6 components) alone is insufficient — quarantine #655 lesson. |

KEEP resolution: approved KEEP quarantine row at flagged ts (`superseded_at IS NULL`,
`approved_at/by NOT NULL`).

**Thresholds (locked):**

| Symbol/class | hardFloorRet | madMultiplier | spreadCapPips | hardFloorRange |
|---|---|---|---|---|
| DXY | 0.02 | 8 | 50 | 0.001 |
| EURUSD | 0.005 | 8 | 30 | 0.0005 |
| USDJPY | 0.005 | 8 | 30 | 0.0006 |
| USDSEK | 0.01 | 10 | 80 | 0.0008 |
| XAUUSD | 0.01 | 8 | 50 | 0.0015 |
| default | 0.005 | 8 | 30 | 0.0005 |

Units: hardFloorRet relative; spreadCapPips pips (`pipMath.ts:getPipSize(digits)`);
hardFloorRange relative `(h−l)/o`.

**Calendar rules (v5.3, frozen then):** gap classes NONE / EXPECTED_WEEKEND /
EXPECTED_DAILY_BREAK / UNEXPECTED; FX week Sun 21:00 → Fri 21:00 UTC; XAUUSD daily break
21:00–22:00 UTC; gap threshold 2h; classification at gap midpoint. Authority
`marketCalendar.ts:classifyCandleGap` / `market.classify_candle_gap`.

**Calibration evidence (already on record):** certify-trusted-windows dry-runs 2026-08-04;
`_tmp_range_stats.cjs` (relative-range med/MAD per symbol, 2026-07-05→08-04);
`_tmp_mult_sweep.cjs` (rolling center + mult×MAD flags ~3% of candles at any multiplier
8..25 — tail is structural, not tunable away). v3 validation report
`reports/detector-v3-validation-2026-08-04.md`: missed-corruption = 0 on XAUUSD/EURUSD/
USDJPY/DXY; v2-only flags dominated by calendar-gap false positives (v3 dropped 24–33
noisy v2 flags per FX symbol while keeping all real corruption).

## 2. Post-freeze drift requiring reconciliation

The frozen config's calendar authority predates **two calendar changes** made under the
Sunday-registry work (commits `5031f17`, `dfac03a`):

1. **XAUUSD break-edge policy** — `BREAK_EDGE_POLICY_BY_SYMBOL.XAUUSD`
   (preBreakHalt 20:50, postBreakResume 22:05) narrows the effective tradable edge vs
   the frozen `[21:00,22:00)` break. Trusted windows certified under v5.3 end at
   20:5x/22:05 boundaries consistent with this (e.g. XAUUSD 07-18T01:34→07-19T01:58,
   07-19T22:05→08-06), so certified windows are unaffected; the drift is in the
   *spec text*, not the data.
2. **Date-keyed Sunday sessions** — `SUNDAY_SESSION_BY_SYMBOL_DATE` (07-12, 07-19,
   07-26, 08-02, 08-09) opens Sundays the frozen calendar treated as closed. Windows
   crossing those Sundays (XAUUSD tail 07-19T22:05→) were certified pre-registry.

Reconciliation path (no code change now): any **new** certification after 2026-08-13 must
state calendar authority = `marketCalendar.ts` @ `dfac03a` (registry-aware). Existing
trusted windows stay valid — registry only ADDS expected-open instants, never removes
certified ones, and the 01:59 hole is already codified as STRUCTURAL_BROKER_HOLE
(evidence-pending, blocking). When the next detector version is cut, fold the registry
into `gapCalendarRules` as an explicit class (EXPECTED_REGISTERED_SUNDAY_SESSION).

## 3. Trusted-window state (step 4 input)

`market.trusted_windows`: 100+ rows; v5.3-certified `trusted` windows exist for
EURUSD, GBPUSD, USDJPY, NZDUSD, USDCAD, USDCHF, AUDUSD, DXY, XAUUSD (tails to
2026-08-06T18:54Z). Candidates pending: early EURUSD/AUDUSD/NZDUSD/USDCAD/USDCHF weeks
+ v3-era stragglers (window_id 1, 2).

**XAUUSD 1m trusted coverage (v5.3):** two islands —
- 2026-07-18T01:34Z → 2026-07-19T01:58Z (pre-hole, ends exactly at the Sunday-session data edge)
- 2026-07-19T22:05Z → 2026-08-06T18:54Z (post-hole tail)

The islands are separated by the 07-19 hole (01:59 codified + 02:00–22:04 outside the
registered session). This IS the XAUUSD trusted window for the first parity audit.
Gap before 07-18T01:34Z = the standing BLOCKED_UNKNOWN trustedWindow blocker
(07-08T03:33Z→07-18T01:34Z), §5 step-3 scope.

## 4. Definition of frozen

`window-certifier-v5.3-spreadzero-keep@20260805` is the frozen detector contract:
- No silent threshold drift. `detector_config` rows are immutable (migration 183);
  any threshold/baseline/rule change REQUIRES a new `detector_version` row
  (draft → active transition audited) and a governance artifact.
- v2/v3/v4 evidence is audit-only, never blocking.
- UNKNOWN/undecided quarantine blocks. KEEP requires approved row with approver identity.
- Future disputes cite this spec + config row, not re-argued thresholds.

## 5. Open residuals (not blocking the freeze)

- 3 DXY synthetic rows (2026-07-07T21:04/21:05Z) kept UNKNOWN/blocking per
  `docs/checkpoints/residual-detector-differences-2026-08-10.md` (KEEP_BLOCKED_UNKNOWN).
- 356 v2-calendar + 286 v3-robust active UNKNOWN rows = audit trail; each needs either
  supersession by a v5.3 re-evaluation or explicit adjudication before its window can
  certify. The August cluster A (315, `0:blocked`) sits in eligibility, not quarantine —
  adjudication is queue item 2 under this frozen contract.
- v5.3 config self-labels `blockingAuthority: "v5.2"` and `schemaVersion: 5.2`
  (carried from the v5.2 row it superseded). Cosmetic; the ACTIVE row is v5.3.
  Fix in next version cut, not by editing the immutable row.
