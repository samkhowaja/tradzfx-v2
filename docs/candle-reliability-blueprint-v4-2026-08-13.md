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
