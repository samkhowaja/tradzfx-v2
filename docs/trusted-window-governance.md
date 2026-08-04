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
until policy explicitly classifies those rows. Do not activate detector v3 or
approve quarantine evidence as part of discovery. For `DXY`, synchronized
component jumps are reported as `synthetic_boundary_unresolved`; formula
agreement does not make such boundaries trusted because they may represent a
component-feed reset.

## Frozen detector versions

Detector parameters live in `market.detector_config` as immutable, dated,
versioned rows. A frozen config is never updated in place — any parameter
change requires a new dated version.

- `candle-detector-v3-robust@20260804` — first frozen v3. Symmetric median/MAD
  on returns/ranges/spreads. Superseded: symmetric deviation misclassified
  tight (below-median) spreads as outliers on heavy-tailed metrics.
- `candle-detector-v4-calibrated@20260804` — calibrated successor, blocking
  authority for certification. Returns: symmetric (MAD×8 + hard floor).
  Ranges: upper-only (MAD×8 + hard floor). Spreads: upper-only absolute cap in
  pips by asset class; zero = missing/unresolved, negative = impossible.
  Calibration evidence: recent XAUUSD window v3 flagged 198/1436/1863
  ret/range/spread outliers; v4 flags 0/2/0 on the same verified-clean data.

Freeze scripts: `scripts/freeze-detector-v3-dated.js`,
`scripts/freeze-detector-v4-calibrated.js`. Both idempotent (canonicalized
config comparison, volatile `frozenAt` excluded); a rules mismatch on an
existing dated version exits 2 instead of mutating.

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
frozen v4 detector, and inserts only zero-blocker windows as
`status='candidate'` rows with governance metadata in `gate_summary`
(effectiveBroker, detectorVersion, quarantineStatus, calendarPolicyVersion,
spreadProvenance, syntheticPolicy, featureCoverageStatus). Requires
`--parity-confirmed`. Idempotent via the candidate-identity unique index.

Certified 2026-08-04 (candidates, awaiting manual promotion review):
XAUUSD ×1, EURUSD ×3, USDJPY ×3, DXY ×1 (window_ids 5–12). Most remaining
islands are blocked solely by unresolved stale v3-era quarantine rows — those
need evidence review via the reports above before more windows can certify.

Backtests and setup generation must run only inside `status='trusted'`
windows; candidate windows are not yet eligible. Feature backfill (MAs, ATR,
pivots, structure — not zones/OB/FVG) happens last, after trusted promotion.