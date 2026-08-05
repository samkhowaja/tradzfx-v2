# Trusted-window governance

Trusted-window discovery stays read-only by default.

Calendar continuity has two enforced checks:

1. `packages/shared/src/utils/marketCalendar.ts` exposes `classifyCandleGap()`.
2. `market.classify_candle_gap()` is canonical for SQL discovery.
3. `pnpm calendar:parity` compares both implementations against a fixed matrix.
4. `scripts/discover-trusted-windows.js --write` refuses unless
   `--parity-confirmed` is supplied after parity passes.
5. `scripts/evaluate-trusted-window-detector.js` treats `spread = 0` as
   unresolved provenance evidence.

Safe sequence:

```text
pnpm calendar:parity
node scripts/discover-trusted-windows.js --symbols=XAUUSD,EURUSD,USDJPY --write --parity-confirmed
```

Candidate rows remain `status='candidate'`. Promotion requires separate manual
review. Any canonical row with `spread = 0` is treated as unresolved spread
evidence, not as an observed zero spread; detector evaluation blocks promotion
until policy explicitly classifies those rows. Do not activate detector v3/v4
or approve quarantine evidence as part of discovery. For `DXY`, synchronized
component jumps are reported as `synthetic_boundary_unresolved` unless the DXY
value is validated against the formula (see § DXY synthetic boundary).

## Frozen detector versions

Detector parameters live in `market.detector_config` as immutable, dated,
versioned rows. A frozen config is never updated in place — any parameter
change requires a new dated version.

- `candle-detector-v3-robust@20260804` — first frozen v3. Symmetric median/MAD
  on returns/ranges/spreads. Superseded: symmetric deviation misclassified
  tight (below-median) spreads as outliers on heavy-tailed metrics.
- `candle-detector-v4-calibrated@20260804` — calibrated successor. Returns:
  symmetric (MAD×8 + hard floor). Ranges: upper-only (MAD×8 + hard floor).
  Spreads: upper-only absolute cap in pips by asset class; zero =
  missing/unresolved, negative = impossible. Calibration evidence: recent
  XAUUSD window v3 flagged 198/1436/1863 ret/range/spread outliers; v4 flags
  0/2/0 on the same verified-clean data. **Superseded as certification
  authority 2026-08-04** — its range rule was applied as a blocker with a raw
  hardFloorRange=0.003 for all FX, which (a) was ~25× the XAUUSD rolling
  median relative range and flagged 657 normal candles in the
  2026-07-19→08-04 island, and (b) could flag range≈0 rows at mad=0 via
  floating-point compare. v4-treated range tails as corruption; see v5.2.
- `window-certifier-v5.1-range-warning@20260805` — **retired same-day before
  use**; superseded by v5.2 (DXY rule upgraded). Never certified production
  windows (its 9 candidate rows were deleted).
- `window-certifier-v5.2-dxy-formula@20260805` — **current blocking authority
  for certification.** Policy: *block corruption, not volatility.* Range
  outliers are WARNING-only (recorded in `gate_summary.rangeOutliers` +
  `volatilityRegime`, never block) because a rolling `center+mult·MAD` rule on
  a heavy right tail flags ~3% of all candles at any multiplier 8–25 — tail
  volatility is structural, not corruption. Ret outliers BLOCK unless every
  flagged timestamp has an approved KEEP quarantine decision (human-reviewed
  real event). Spread cap / zero-spread / unresolved-quarantine BLOCK.
  hardFloorRange is now RELATIVE `((h-l)/o)` and per-symbol (XAUUSD 0.0015,
  EURUSD 0.0005, USDJPY 0.0006, quiet-regime backstop only), with a 1e-12
  epsilon fixing the range≈0 floating-point bug.

Freeze scripts: `scripts/freeze-detector-v3-dated.js`,
`scripts/freeze-detector-v4-calibrated.js`,
`scripts/freeze-certifier-v5_2-dxy-formula.js`. All idempotent (canonicalized
config comparison, volatile `frozenAt` excluded); a rules mismatch on an
existing dated version exits 2 instead of mutating.

## DXY synthetic boundary — formula validation (#655 lesson)

The component-jump heuristic (all 6 components present, ≥2 jumped ≥0.1% same
minute) is necessary but NOT sufficient to distrust a DXY candle. The corrupt
2026-07-07 episode — DXY halved 101→51→52→101 while components merely shifted
— PASSED the heuristic and was initially KEEP'd as a "verified reset"
(quarantine #655, corrected to EXCLUDE). It was only caught by checking the
DXY value against the formula (deviation ≫ 0.5%).

v5.2 resolves a boundary candidate as follows:

- DXY canonical row PRESENT and formula-consistent (|close − formula| /
  formula ≤ 0.5%) → **resolved** (genuine synchronized repricing: session
  opens, news repricing all components at once). No block.
- DXY canonical row ABSENT at the boundary minute → **resolved** (nothing to
  distrust; gaps handled by island formation, corrupt rows already EXCLUDE'd
  from canonical by migration 186).
- DXY row PRESENT and deviates > 0.5% from formula → **UNRESOLVED**, blocks
  certification (`synthetic_boundary_unresolved`).

## Quarantine decision workflow (KEEP / EXCLUDE / REPLACED)

Two scripts, both safe by default:

- `scripts/propose-quarantine-decisions.js` — read-only. Joins the latest
  alternate-broker and no-alternate evidence reports to active quarantine rows
  and maps evidence to suggested decisions (REPLACE_CANDIDATE+evidence →
  REPLACED, calendar-explained/SYNTHETIC_BOUNDARY → KEEP, invalid → EXCLUDE).
  Writes `reports/quarantine-decision-proposals-<date>.json`. Never touches
  the DB.
- `scripts/apply-quarantine-decisions.js --proposals=<path>
  --decision=KEEP|EXCLUDE|REPLACED --reviewer=<name> [--apply]` — dry-run by
  default. Per row re-reads current state (skips missing/superseded/
  already-differently-decided), re-verifies replacement evidence for REPLACED,
  applies `decision + approved_at + approved_by + notes` in a single
  transaction (ROLLBACK on error). UNKNOWN is never batch-applied.

Decisions applied 2026-08-04 (governance phase): 35 KEEP + 3 EXCLUDE + 1
correction (#655 KEEP→EXCLUDE after formula-value check). Recent July–Aug
islands now have `unresolvedQ=0` for XAUUSD/EURUSD/USDJPY/DXY.

## Canonical EXCLUDE semantics (migration 186)

`market.candles_1m_canonical` drops any candle with an approved EXCLUDE
quarantine row (`superseded_at IS NULL`, `decision='EXCLUDE'`,
`approved_at/by NOT NULL`, broker matches raw or effective identity). UNKNOWN /
undecided rows are NOT filtered — they block certification instead
(fail-closed). Applied EXCLUDE rows therefore re-form islands around the
excluded hole (verified: DXY 2026-07-07 series now reads 21:03→21:06
continuous, corrupt 21:04/21:05 gone).

## Evidence reports (read-only)

- `scripts/report-detector-v3-validation.js` — v2 vs v3 flag overlap, current
  blockers, calendar-explained false positives, missed-corruption check
  (INVALID_OHLC/IMPOSSIBLE_SPREAD absent from v3 flags). Output under
  `reports/detector-v3-validation-<date>.{json,md}`.
- `scripts/report-alternate-broker-replacement.js` — per quarantine row with
  alternate-broker data: blocked vs alternate OHLC diff, spread sanity,
  calendar/gap status; suggests REPLACE/KEEP/EXCLUDE/UNKNOWN. No auto-approve.
- `scripts/report-no-alternate-bucketing.js` — rows without alternate data
  bucketed: EXCLUDE (invalid OHLC/impossible spread), KEEP (calendar-explained
  gap), SYNTHETIC_BOUNDARY (verified DXY component reset), UNKNOWN (unexplained
  jump).

## Certification

`scripts/certify-trusted-windows.js` discovers recent contiguous islands
(≥ `--min-rows`, default 1000) per priority symbol, evaluates them with the
frozen v5.2 certifier, and inserts only zero-blocker windows as
`status='candidate'` rows with governance metadata in `gate_summary`
(effectiveBroker, detectorVersion, certificationPolicy, quarantineStatus,
calendarPolicyVersion, spreadProvenance, syntheticPolicy, volatilityRegime,
warnings, rangeOutliers, retOutliers, keepResolvedRetOutliers,
featureCoverageStatus). Requires `--parity-confirmed`. Idempotent via the
candidate-identity unique index.

Certified candidates (awaiting manual promotion review):

- v4 (`candle-detector-v4-calibrated@20260804`): window_ids 5–12 — XAUUSD ×1,
  EURUSD ×3, USDJPY ×3, DXY ×1 (May/June + one XAUUSD 07-18→19).
- v5.2 (`window-certifier-v5.2-dxy-formula@20260805`): window_ids 46–56 —
  XAUUSD 07-19→08-04 (21425 rows, mixed regime), XAUUSD 07-18→19, EURUSD ×3
  (recent 07-18→08-04 24703 rows + two June/July), USDJPY ×3 (recent
  07-18→08-04 24683 rows high regime, ret outlier KEEP-resolved + two June),
  DXY ×3 (08-03→04, 07-17→31 19155 rows, 07-15→17).

Remaining blocked islands are blocked solely by unresolved stale v3-era
quarantine rows (older history) — those need evidence review via the reports
above before more windows can certify. All recent (July–Aug) islands for the
four priority symbols now certify under v5.2.

Backtests and setup generation must run only inside `status='trusted'`
windows; candidate windows are not yet eligible. Feature backfill (MAs, ATR,
pivots, structure — not zones/OB/FVG) happens last, after trusted promotion.

## Promotion (candidate → trusted)

`scripts/promote-trusted-windows.js` — manual, audited, dry-run by default:

```bash
node scripts/promote-trusted-windows.js                                    # list candidates
node scripts/promote-trusted-windows.js --symbol=XAUUSD --reviewer=<name> --apply
node scripts/promote-trusted-windows.js --ids=46,48,51,54,55 --reviewer=<name> --apply
node scripts/promote-trusted-windows.js --demote --ids=46 --reviewer=<name> --apply
```

- `--apply` requires `--reviewer=<name>` (audit trail → `promoted_by`,
  `promoted_at`; demote → `superseded_by`, `superseded_at`).
- Promotion stamps `canonical_version` (`canonical-m186-exclude-skip@<date>`)
  on the row for lineage.
- Single transaction; filters: `--ids`, `--symbol`, or `--all`.

## Backtest trusted-window gate

`scripts/backtest-pit-v2.js` enforces the gate **by default** (fail-closed):

- Every symbol's `[from,to]` interval must be fully covered by
  `status='trusted'` windows (timeframe `1m`) in `market.trusted_windows`;
  contiguous/adjacent windows chain (coverage cursor).
- On block: exit 1 with remediation instructions. Gate result +
  detector versions recorded in the immutable run metadata (`trustedGate`).
- Escape hatch `--trusted=off` for research only; logs a loud warning and
  marks the run metadata `trustedGate.mode='off'` — such runs are NOT
  gating evidence.