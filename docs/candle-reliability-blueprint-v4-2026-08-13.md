# Candle Data Reliability Blueprint — re-targeted to v4-calibrated (2026-08-13)

**PLAN ONLY. Nothing here executes without the authorization switch (§9).**
Re-targets the original blueprint from detector v3 → **v4-calibrated**. v3-robust is
known-flawed (symmetric median/MAD on heavy-tailed range/spread → ~9% false-positive on
a verified-clean XAUUSD window; evidence `reports/detector-v3-validation-2026-08-04.json`)
and is historical evidence only. The real milestone is **not** "freeze the detector" in
the abstract — it is **freezing the decision policy around the active UNKNOWN queue**,
which is what unlocks clean canonical history without reopening the corruption problem.

## 0. Current state (read-only verified 2026-08-13)

Active (unsuperseded) `candle_quarantine` by detector/decision:

| detector_version | decision | active |
|---|---|---|
| candle-detector-v2-calendar | UNKNOWN | **356** |
| candle-detector-v2-calendar | KEEP | 7 |
| candle-detector-v2-calendar | EXCLUDE | 4 |
| candle-detector-v3-robust | UNKNOWN | **286** |
| candle-detector-v3-robust | KEEP | 28 |
| candle-detector-v3-robust | EXCLUDE | 2 |
| manual-break-edge-policy-v1 | KEEP | 5 |
| manual-spreadzero-review@20260805 | KEEP | 11 |
| candle-detector-v1 | (all superseded) | 0 |

**Burn-down backlog = 642 active UNKNOWN** (356 v2-calendar + 286 v3-robust).
v3-robust UNKNOWN flags: 275 `LARGE_JUMP_ROBUST`, 8 `LARGE_JUMP_ROBUST+UNEXPECTED_GAP`,
3 `UNEXPECTED_GAP`. `trusted_windows` already has v4-calibrated + v5.x trusted rows —
v4 is the de-facto baseline; this blueprint formalizes it.

## 1. Hard holds (unchanged)

- Ingestion closed: no restart/repair/spool drain/backfill.
- DB read-only except explicitly authorized write batches.
- No schema cleanup, no raw-candle mutation (`candles_1m` immutable), no `features_zone` edits.
- No gate flips, no migration 193, XAUUSD 15m ATR lineage stays fail-closed.
- Keep all fail-closed behavior in place throughout.

## 2. Freeze detector v4-calibrated (read-only formalization)

- Active detector baseline = `candle-detector-v4-calibrated`.
  - ret: symmetric `|r-median| > max(hardFloorReturn, madMult×MAD)`
  - range: one-sided upper only
  - spread: absolute pip cap (data-quality, not trading gate); zero=missing, negative=impossible
- v3-robust rows → historical/superseded evidence; never re-run as active.
- No new freeze script needed — v4 is already the operating baseline; record the
  baseline + output hash as the frozen reference. Do NOT re-freeze v3.

**Exit:** v4 documented as the single active detector; v3 quarantined to evidence-only.

## 3. Rebuild blocker report from active UNKNOWNs (read-only)

Recompute current backlog (do NOT trust legacy `372/85/287`). Partition the 642 into
explicit review queues by (detector, flag, symbol, broker, asset class):

- FX majors / JPY+SEK / XAUUSD / DXY synthetic — reviewed separately.
- Flag buckets: LARGE_JUMP_ROBUST, UNEXPECTED_GAP, INVALID_OHLC, IMPOSSIBLE_SPREAD,
  synthetic-DXY.
- Output: `reports/blocker-queue-v4-<date>.json` — every active blocker in exactly one
  queue with traceable evidence.

**Exit:** 642 active UNKNOWNs each assigned to one explicit review queue.

## 4. Alternate-broker adjudication (read-only)

- `node scripts/report-alternate-broker-replacement.js` → per-row suggestion
  REPLACE_CANDIDATE / KEEP_CANDIDATE / EXCLUDE_CANDIDATE / UNKNOWN. No writes, no auto-approve.
- Compare: timestamp/session alignment, OHLC validity, return/range consistency,
  spread validity, nearby continuity, cross-broker agreement.

**Exit:** every blocker with an alternate-broker candidate has a documented suggestion.

## 5. Governed decisions (approval-gated writes)

- `node scripts/propose-quarantine-decisions.js` (read-only) → joins §4 report +
  no-alternate bucketing → `reports/quarantine-decision-proposals-<date>.json`.
- Apply per decision class, human-approved:
  - `node scripts/apply-quarantine-decisions.js --proposals=<file> --decision=KEEP --reviewer=<name> --apply`
  - repeat per `--decision` (EXCLUDE, REPLACED). REPLACED re-checked for linked
    replacement evidence at apply time. Only undecided rows touched; never overwrites
    a prior human decision; never touches raw/canonical candles.
- Decision semantics (blueprint §4): KEEP=eligible, UNKNOWN=stays blocked,
  EXCLUDE=absent, REPLACED=blocked until valid superseding evidence exists.

**Exit:** backlog burned to zero active UNKNOWN, or each residual deliberately retained
as UNKNOWN with a recorded reason — never silently defaulted.

## 6. Certify trusted windows (candidates → promote)

- Candidates: `node scripts/certify-trusted-windows.js --symbols=<S> --write --parity-confirmed`
  (requires `pnpm calendar:parity` passed=true; creates candidates only).
- Promote: `node scripts/promote-trusted-windows.js --ids=<id> --reviewer=<name> --apply`
  (dry-run default; immutable artifact via `immutable-run-store.js`).
- Certification artifact per §5 of original blueprint: symbol/tf, start/end,
  broker-policy version, detector version+params, evidence counts by decision, hashes.
- **First concrete instance = the XAUUSD 07-08→07-18 gap batch**
  (`docs/certify-gap-batch-spec-2026-08-13.md`) — already evidence-green.

**Exit:** each required interval has a reproducible PASS artifact, not merely zero alerts.

## 7. Backfill features in dependency order (only certified intervals)

- `node scripts/backfill-historical-features.js <SYM> <tfs> --features=<f> --start= --end=`
- Leaf features first (ATR), then dependent; HTF high→low for context.
- Every output lineage-stamped via `runner.ts` (canonical/broker-policy/detector/
  validator versions, input_end_ts, generated_at).
- **First concrete instance = the XAUUSD 15m ATR repair batch**
  (`docs/atr-recompute-stamp-batch-spec-2026-08-13.md`) — ordered after §6 promotion
  because the backfill is trusted-gated.
- Stop immediately if canonical certification changes or lineage can't be represented.

**Exit:** required features complete, lineage-backed, derived only from certified candles.

## 8. Parity harness (LAST — least built, do not let it gate §3–§7)

- `governance-preflight.ts` is partial (gates only). Full live-vs-backtest
  timestamp-by-timestamp comparison runs **after** canonical repair + certification.
- Target window: `watukushay_no1` XAUUSD 2026-07-19→2026-07-23, shadow mode, zero orders.
- Compare candle availability, feature values, setup eligibility, signal direction,
  entry/exit, rejection reasons; record earliest divergence per mismatch.
- Abort on any unresolved quarantine interval or missing lineage.

**Exit:** parity deterministic, or every divergence classified with evidence.

## 9. Authorization switch (hard gate)

Each write-bearing step (§5 apply, §6 certify/promote, §7 backfill) executes ONLY when:
- [ ] Explicit user authorization naming the step.
- [ ] `pnpm calendar:parity` passed=true (fresh, same session) for cert/backfill.
- [ ] Ingestion still closed.
- [ ] Reviewer identity confirmed.
- [ ] Hard holds (§1) reconfirmed.
Read-only steps (§3, §4, §5-propose, §8 dry-run) may run without the switch.

## 10. Both gates before launch

Launch requires BOTH green: (1) technical eligibility (certified candles + complete
lineage + deterministic parity + no unresolved required intervals) AND (2) permission,
activated through the separate governed process. Authorization never overrides technical
failure. Permission remains INACTIVE and independent of technical eligibility.

## 11. §3+§4 evidence run (2026-08-13, read-only, zero writes)

**§3 backlog rebuild** (`reports/quarantine-unknown-backlog-v4-2026-08-13.json`):
- Total active UNKNOWN = **642** (356 v2-calendar + 286 v3-robust) — confirmed.
- v2-calendar flags: 350 `LARGE_JUMP_RELATIVE`, 3 `UNEXPECTED_GAP`, 3 both.
- v3-robust flags: 275 `LARGE_JUMP_ROBUST`, 8 jump+gap, 3 gap-only.
- Per-symbol (v2/v3): XAUUSD 104/109, USDJPY 50/19, USDSEK 47/41, EURUSD 43/21,
  GBPUSD 40/36, AUDUSD 29/24, NZDUSD 26/23, USDCHF 17/12, USDCAD 0/1.
- **Dominant flag across both detectors = LARGE_JUMP.** UNEXPECTED_GAP-only is rare (6).

**§4 alternate-broker replacement** (`reports/alternate-broker-replacement-2026-08-13.json/.md`):
- 642 active rows: **502 have NO alternate-broker candle** (no replacement evidence);
  **138 have an alternate** (1x Trade Ltd. vs OANDA Corporation).
- All 138 classified **UNKNOWN** — none clear REPLACE or KEEP. Evidence dims on the 138:
  - `blockedInvalidOHLC:0`, `altInvalidOHLC:0` → neither side structurally impossible
    → **no REPLACE_CANDIDATE** (REPLACE requires the blocked candle to be INVALID_OHLC).
  - `calendarExplainedOnly:0` → none calendar-explained → **no KEEP_CANDIDATE**.
  - `bothSpreadSane:0` → spread never "sane" on both sides (zero/unresolved-spread blocker).
  - close agree ≤0.3%: 24; close diverge >0.3%: 114 → brokers materially disagree on most.

**Consequence for §5:** the alternate-broker path **cannot clear any of the 642**. The
burn-down is therefore a **LARGE_JUMP adjudication**, decided on structural validity +
calendar + v4 median/MAD re-classification — NOT on broker replacement. Practical split:
- 24 close-agree rows (both valid, spreads the only blocker) → strongest **KEEP**
  candidates after v4 MAD says the jump is genuine-but-real.
- 114 close-diverge rows (both valid, brokers disagree) → need independent evidence
  (DXY/component or HTF cross-check); stay UNKNOWN until resolved.
- 502 no-alternate rows → KEEP (real move) / EXCLUDE (corruption) / UNKNOWN by v4 MAD
  + calendar; no replacement evidence exists.

This validates the blueprint's core claim: detector freeze is not the milestone —
**the LARGE_JUMP decision policy over the 642 is.** §5 `propose-quarantine-decisions.js`
is the next read-only step (joins this §4 report + no-alternate bucketing into a proposal
file for human review; zero writes until `--apply` is explicitly authorized).

