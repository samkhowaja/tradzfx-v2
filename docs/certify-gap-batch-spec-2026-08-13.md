# Governed revalidation + certification batch spec — XAUUSD trustedWindow gap (2026-08-13)

**SPEC ONLY. Not executed.** Every step that writes requires the authorization
switch (§6). Production DB stays read-only until then. Derived from
`docs/certify-trusted-windows-plan-2026-08-13.md` + the actual CLIs (read 2026-08-13).

## 0. Scope

Close `trustedWindow XAUUSD 1m gap 2026-07-08T03:33Z → 2026-07-18T01:34Z` by
(a) revalidating the 2 residual false-BLOCKED eligibility rows under the fixed
validator, (b) proving parity, (c) certifying + promoting a trusted window.

## 1. Real CLI surface (verified against source, not assumed)

| Script | Writes | Key flags | Notes |
|---|---|---|---|
| `scripts/certify-trusted-windows.js` | `market.trusted_windows` **candidate** rows only | `--symbols=`, `--windows=`, `--min-rows=`, `--max-windows-per-symbol=`, `--write --parity-confirmed` | Auto-discovers recent islands; **no `--from/--to`**; refuses `--write` unless `pnpm calendar:parity` passed; idempotent via candidate-identity unique index; `FROZEN_VERSION=window-certifier-v5.3-spreadzero-keep@20260805`. Never sets `status='trusted'`. |
| `scripts/promote-trusted-windows.js` | `candidate → trusted` | `--ids=`/`--symbol=`/`--all`, `--reviewer=<name>`, `--apply`, `--demote` | Default = dry-run list. Promotion sets `status`, `promoted_at/by`, stamps `canonical_version`. Manual decision by design. |
| `pnpm calendar:parity` (`scripts/calendar-gap-parity.ts`) | none | — | Must return `passed=true` before any `--write`. |
| eligibility revalidation | `market.candle_eligibility` state | — | No dedicated CLI; revalidation happens when `featureWorker`/`validateCandleEligibility` re-claims PERSISTED/ERROR rows. Needs a governed re-claim for the 2 ts. |

## 2. Write-set (exactly what changes, nothing else)

1. `market.candle_eligibility` — 2 rows (`2026-07-13T14:16Z`, `2026-07-14T12:30Z`):
   `state BLOCKED → CLEAN`, `validator_version`, fresh `evidence_fingerprint`,
   `validation_completed_at`. No other rows touched.
2. `market.trusted_windows` — 1 new `candidate` row for the gap island, stamped
   `window-certifier-v5.3-spreadzero-keep@20260805` (idempotent re-run safe).
3. `market.trusted_windows` — that candidate promoted to `status='trusted'`
   (`promoted_by=salman`, `canonical_version` stamped).

No writes to `candles_1m` (immutable), `candle_quarantine`, `detector_config`,
`features_atr`, or any gate/permission table.

## 3. Ordered runbook

```
# 0. Authorization switch ON (§6) — else STOP.
# 1. Calendar parity gate (read-only; must pass before any write)
pnpm calendar:parity                       # require passed=true

# 2. Revalidate the 2 residual eligibility rows (governed write #1)
#    Reset to PERSISTED so the fixed validator re-claims them:
#    UPDATE market.candle_eligibility SET state='PERSISTED'
#      WHERE symbol='XAUUSD' AND broker='1x Trade Ltd.' AND timeframe='1m'
#        AND ts IN ('2026-07-13T14:16:00Z','2026-07-14T12:30:00Z');
#    Then let validateCandleEligibility re-claim → expect CLEAN.
#    Verify: both rows state='CLEAN', error_message IS NULL.

# 3. Parity proof set (read-only evidence, persisted to reports/)
#    a. ATR: recompute v1.2.0 from candles_1m for 10 random 15m ts in
#       07-08→07-18; assert == lineage-resolved features_atr value.
#    b. Coverage: 1m/15m/1h expected-vs-present over 30d matches
#       reports/preflight-post-sundayreg.json (−28 break-edge artifact).

# 4. Certify candidate (governed write #2)
node scripts/certify-trusted-windows.js --symbols=XAUUSD --windows=3 --write --parity-confirmed
#    Confirm a candidate row now spans the gap island (07-08T03:33→07-18T01:34).

# 5. Promote to trusted (governed write #3, manual)
node scripts/promote-trusted-windows.js --symbol=XAUUSD --reviewer=salman --apply
#    Prefer --ids=<new id> for surgical scope over --symbol.

# 6. Post-check (read-only)
npx tsx scripts/governance-preflight.ts --strategy=watukushay_no1 --symbol=XAUUSD \
  --timeframe=15m --from=2026-07-19T00:00:00Z --to=2026-07-23T00:00:00Z
#    Expect: trustedWindow blocker GONE. Remaining: permission INACTIVE,
#    eligibility BLOCKED_UNKNOWN (gate flips still held — separate decision).
```

## 4. Rollback

- Step 2: rows idempotent — re-running the fixed validator yields CLEAN again.
- Step 5 reverse: `node scripts/promote-trusted-windows.js --demote --ids=<id>
  --reviewer=salman --apply` (demotion keeps `promoted_*` as audit evidence).
- Step 4 candidate: `UPDATE market.trusted_windows SET superseded_at=now(),
  superseded_by='rollback' WHERE window_id=<id>` (candidate never gated anything).

## 5. Staging pilot (optional, before production)

No staging DB is configured in this workspace. Closest safe pilot:
- Run steps 1–3 (all read-only) against production now — zero risk.
- Wrap steps 2/4/5 in a single explicit transaction captured to
  `reports/` (immutable-run-store already used by promote script) so the batch is
  replayable/auditable. If a scratch DB is later stood up, replay the same batch
  there first via the `pg_restore --list` + restore-drill path in `AGENTS.md`.

## 6. Authorization switch (hard gate)

This batch executes ONLY when ALL are true:
- [ ] Explicit user authorization: "run the XAUUSD gap certification batch".
- [ ] `pnpm calendar:parity` returns `passed=true` (fresh, same session).
- [ ] Ingestion still closed (no live feature recompute racing the revalidation).
- [ ] Reviewer identity confirmed as `salman`.
- [ ] Hard holds reconfirmed: no gate flips, no migration 193, no ATR lineage relax
      (the `features_atr` 3× lineage density is noted; this batch does NOT touch it).

## 7. Out of scope (held)

- Permission/technical gate flips, migration 193, XAUUSD 15m ATR lineage relaxation.
- 01:59 class-3 CopyRates (terminal/ingestion path frozen).
- 356 v2-calendar + 286 v3-robust active UNKNOWN quarantine rows (audit trail;
  adjudicate per-window as needed — none in this gap).
- `features_atr` 15m 3× lineage density (2,631/877) — dedupe is a separate,
  ATR-lineage decision; untouched here.

## 8. Read-only evidence run (2026-08-13T14:47Z) — results

Executed the read-only portion only (§3 steps 1 + 3). **No DB writes** — no
`UPDATE`, no candidate insert, no promotion. Authorization switch untouched.

| Check | Result |
|---|---|
| `pnpm calendar:parity` | **passed=true, 0 mismatches** |
| Canonical 1m coverage (07-08T03:33Z→07-18T01:34Z) | **13,656 candles**, full 15/15 buckets |
| Residual eligibility rows (07-13T14:16Z, 07-14T12:30Z) | both `state=BLOCKED`, **structural_ok=true → revalidatable** |
| **ATR parity (v1.2.0 recompute vs `features_atr`)** | **0/10 samples match** |

Evidence file: `reports/gap-readonly-proof-2026-08-13.json` (gitignored).

### ⚠ ATR parity FAILURE — blocker raised

Recomputed v1.2.0 ATR from current `candles_15m` (and from 1m-derived buckets) does
**not** reproduce the stored `features_atr` values for any of 10 sampled ts in the gap:

- Example `2026-07-17T20:45Z` ATR(5): stored `4.084` vs recomputed `4.722` (cagg) /
  `4.470` (1m-derived). Verified the recompute script against an isolated raw query —
  identical, so not a script bug.
- Stored rows: `engine_ver=1.2.0`, `lineage_state='legacy_untrusted'`, **all lineage
  stamps NULL** (`canonical_version`, `eligibility_model_version`,
  `broker_policy_version`, `detector_version`, `validator_version`, `input_start_ts`,
  `input_end_ts`, `generated_at`).
- Window/broker scan: no candle window (any broker, ±40 bars) reproduces `4.084`;
  the value appears elsewhere in the series → **stored rows reflect a different candle
  history than present** (data drift since stamp), not window misalignment.
- `features_atr` for XAUUSD 15m were (re)generated 2026-08-06→08-10, yet still diverge.

**Implication:** §3 step 3a (ATR parity) currently **FAILS**. Per the authorization
switch this is independent of the trustedWindow gate (which reads `candles_1m` +
quarantine, not `features_atr`), so certification is *not* blocked by it — but the
**XAUUSD 15m ATR lineage relaxation hold is reinforced**: stored ATR is untrustworthy
for the gap until ATR is recomputed against current canonical candles and its lineage
stamps are populated. That ATR repair is **out of scope** for this batch (held item).

**Net:** trustedWindow certification may proceed (calendar parity + coverage green);
ATR lineage must remain fail-closed and needs its own recompute-and-stamp batch.

