# Governance Decision Requirements — watukushay_no1 / XAUUSD / 15m

**Date:** 2026-08-12
**Status:** READ-ONLY analysis. Zero DB writes proposed without explicit approval.
**Preflight target:** `watukushay_no1`, `XAUUSD`, `15m`, window `2026-07-19T00:00:00Z` → `2026-07-23T00:00:00Z`
**Current verdict:** `FAIL` — 6 blocking checks (canonical, trustedWindow, prehistory, warmup, featureLineage, parity).

All facts below verified against live DB (BEGIN READ ONLY / ROLLBACK) and current source at commit `e8b059f`.

---

## 0. New findings from this pass (2026-08-12)

Two defects surfaced while grounding this document. Both are **adapter-side**, separable from policy work:

1. **`checkTrustedPrehistory` timeframe mismatch** (`packages/shared/src/governance/preflightAdapters.ts:295`).
   The query filters `market.trusted_windows` with `timeframe = ctx.timeframe` (`'15m'`). All 68 rows in
   `market.trusted_windows` are `timeframe='1m'` — `trusted-gate.js:37` hardcodes `timeframe = '1m'` by design
   (trust is a 1m-canonical property). The preflight check can therefore **never pass for any non-1m strategy**.
   Fix: query `timeframe='1m'` (trust chain is a 1m property), keep HTF coverage to the canonical checks.

2. **`checkTrustedPrehistory` coverage semantics mismatch** (same function).
   The query requires ONE window with `window_start <= from AND window_end >= to`. The promotion pipeline
   (`scripts/lib/trusted-gate.js:44-66`) uses a **greedy coverage chain** across many windows. Even at 1m, no
   single XAUUSD window covers the required range, so the check fails even where the chain semantics would pass.
   Fix: port the greedy-chain evaluation from `trusted-gate.js` into the adapter (or call it directly).

**Real data gap independent of both defects:** the required window starts `2026-07-08T03:35:00Z` (warmup), but
the earliest XAUUSD trusted window starts `2026-07-18T01:34:00Z`. Warmup span `07-08 → 07-18` has **zero trusted
coverage**, plus a 20.1h intra-chain gap `2026-07-19T01:58Z → 2026-07-19T22:05Z` (Sunday pre-open; FX week opens
Sun 21:00 UTC, XAUUSD resumes 22:05 — calendar-expected, but still a coverage break the chain must be allowed to
span). So even after both adapter fixes, `trustedWindow`/`prehistory` stay red until warmup-range windows are
certified+promoted.

Also confirmed: `market.candle_quarantine_evidence` is **empty** (zero rows, all decisions). The 2 anomaly bars
(§2) have no adjudication rows at all — decision workflow starts from scratch.

---

## 1. Trusted window construction requirements

Mechanics (existing, verified):
- Candidates written by `scripts/certify-trusted-windows.js` — detector `window-certifier-v5.3-spreadzero-keep@20260805`
  (status `active` in `market.detector_config`). Writes require `--write --parity-confirmed` (calendar parity gate).
  Idempotent via candidate-identity unique index `(symbol,timeframe,window_start,window_end,detector_version)`.
- Promotion: `scripts/promote-trusted-windows.js --ids=... --reviewer=<name> --apply`. Dry-run default. Refuses
  candidates whose `gate_summary.blockers` is non-empty. Sets `status='trusted'`, `promoted_at/by`, stamps
  `canonical_version`.
- Consumption: `evaluateTrustedGate()` requires `status='trusted'`, `timeframe='1m'`, non-null
  `detector_version`, `canonical_version`, `gate_summary`; greedy chain per symbol; pins `windowIds` +
  `windowSetHash` into run metadata (promotion/demotion after the fact cannot change what a run meant).

Requirements a trusted window set MUST satisfy for this strategy:

| Requirement | Value for this candidate | Source |
|---|---|---|
| Coverage span | `2026-07-08T03:35:00Z` → `2026-07-23T00:00:00Z` (warmup-expanded) | preflight `expandedWindow()` |
| Timeframe of trust rows | `1m` (chain semantics, not single window) | `trusted-gate.js` |
| Calendar gaps allowed | Weekend (Fri 21:00→Sun 21:00 UTC) + XAUUSD daily halt (21:00→22:05 UTC) must NOT count as coverage breaks | `market-calendar-v1` |
| Detector | `window-certifier-v5.3-spreadzero-keep@20260805` (active, frozen) | `market.detector_config` |
| Canonical version | `canonical-m186-exclude-skip@*` stamped at promotion | promote script |
| Blockers | `gate_summary.blockers` empty at promotion time | promote preflight |
| Reviewer | Named human via `--reviewer` (audit trail) | promote script |

**Gap to close:** certify+promote XAUUSD 1m windows covering `2026-07-08 → 2026-07-18` (warmup) and the
`2026-07-19T01:58→22:05Z` span (or extend chain logic to treat calendar-expected breaks as transparent).
Blocked on: DB writes (`--write --parity-confirmed`), promotion decision.

---

## 2. Reviewer workflow — the 7 BLOCKED eligibility rows

Evidence table: `market.candle_quarantine_evidence` (currently empty). Columns: `symbol, broker, candle_ts,
timeframe, source_key, anomaly_flags, severity, detector_version, decision, approval_identity, approval_ts,
disposition, policy_version, evidence_sha256, supersedes_quarantine_evidence_id, recorded_at`. Append-only with
supersede chain — corrections insert a new row referencing `supersedes_quarantine_evidence_id`, never update.

### 2a. Anomaly bars (2) — need individual adjudication

| candle_ts (UTC) | Observation | Detector context |
|---|---|---|
| 2026-07-13 14:16 | low spike: `l=4009.47` vs ~4034 regime | ret/range outlier vs rolling median+MAD (lookback 60) |
| 2026-07-14 12:30 | spread spike: `spread=43.9` pips vs ~3 baseline | XAUUSD spread cap 50 pips (v5.3) — under cap but regime outlier |

Decision options per bar:
- **KEEP** — price action judged real (e.g. verified against second feed). Bar enters canonical set.
  Required evidence: external corroboration reference in `anomaly_flags`/`evidence_sha256`, `approval_identity`.
- **EXCLUDE** — judged corruption. Migration-186 canonical filter drops it; consumers never see it.
- **REPLACED** — corrected value available; requires replacement evidence (`replacedRequiresEvidence: true` in v5.3 rules).
- **UNKNOWN** — unresolved; canonical stays BLOCKED at that ts (fail-closed).

Workflow per bar:
1. Pull raw row from `candles_1m` + surrounding ±30 min context; check broker feed notes / second source.
2. Insert decision row into `market.candle_quarantine_evidence` with `decision`, `approval_identity`,
   `policy_version='window-certifier-v5.3-spreadzero-keep@20260805'`, `evidence_sha256` over the review packet.
3. Re-run eligibility producer for affected ts so `market.candle_eligibility` state flips from `BLOCKED`.
4. Re-run preflight; `canonical` check `ineligible` must drop by the KEEP'd/EXCLUDE'd count.

Note: 2026-07-13 bar is **outside** the preflight window (`07-19→07-23`) but inside eligibility history —
adjudicate anyway since it pollutes any warmup range reaching back past 07-13.

### 2b. Break-edge bars (5) — need a policy class decision, not per-bar review

Bars: `2026-07-19 22:00–22:04 UTC`, XAUUSD daily halt window (21:00→22:05 UTC per
`BREAK_EDGE_POLICY_BY_SYMBOL`), marked BLOCKED under `policy_id=4`, fingerprint `f147b29d`,
validator `candle-eligibility-v1`, batch `2026-08-03T23:05:42Z`.

These bars exist in `candles_1m` (broker streamed them) but fall inside the certification-only halt window.
Options:

- **Option A — permanent exclusion (status quo):** keep BLOCKED; treat halt-window bars as non-canonical forever.
  Consequence: any window containing a daily halt edge can never be `canonical`-clean unless eligibility policy
  learns to skip them. Requires the canonical check to treat `policy_id=4` break-edge rows as transparent
  (calendar-expected), i.e. a **policy code change**, not data change.
- **Option B — accept session break policy:** bulk-adjudicate the 5 bars (and the recurring daily class) as
  KEEP under a new `disposition='session_break_accepted'`, with `policy_version` bumped. Justification: bars are
  real broker prints at market resume; the 22:00–22:04 span is inside `postBreakResumeMinUTC=22:05` only by 5
  minutes — the halt edge is a certification convenience, not corruption evidence.

Recommendation: **Option A with code transparency** — the bars carry no trading signal value (zero-volume resume
prints), but hardcoding per-policy exemptions into the canonical check needs a migration + spec change. If
trading strategies never trade the resume minute, exclusion is the honest model. This is a policy call.

---

## 3. Evidence required to flip permission/eligibility states

### Technical eligibility `BLOCKED_UNKNOWN → READY` (preflight verdict `PROMOTION_ELIGIBLE_READONLY`)

Per-check requirements (from `preflightAdapters.ts` / `preflightEvaluator.ts`):

| Check | Flip requirement |
|---|---|
| canonical | `market.candle_eligibility` ineligible count = 0 across required window AND all tf coverage reports PASS (needs §2a + §2b resolution) |
| trustedWindow | Adapter fixes (§0) + certified/promoted 1m chain covering warmup-expanded range (§1) |
| prehistory | Same as trustedWindow (shares check) |
| warmup | `warmup.status != PRESENT_NON_CANONICAL` — rows exist (142,502 at 1m) but are non-canonical until canonical+trusted gates pass; flips automatically after §1+§2 |
| featureLineage | Every dependency feature `status='PASS'`: producer run covering window (`feature_producer_runs` with `runsCoveringWindow=true`) + `market.candle_producer_lineage` rows > 0 in range |
| parity | Execute parity workflow (§4) and record verdict |

### Strategy permission `INACTIVE → ACTIVE` (promotion to live)

Beyond preflight green:
1. Preflight envelope recorded in `reports/preflight-history.jsonl` with verdict `PROMOTION_ELIGIBLE_READONLY`.
2. Parity evidence attached (§4 acceptance met).
3. `node scripts/promote-top3-live.js` edit + run (writes) — per AGENTS.md, after `pnpm db:seed:check` if spec changed.
4. Reviewer sign-off recorded (who activated, when, on which envelope hash).

---

## 4. Parity gate acceptance criteria (proposal — needs ratification)

Scope: live-vs-backtest replay on `2026-07-19 → 2026-07-23`, `watukushay_no1`, XAUUSD 15m, canonical candles,
trusted features only.

Proposed acceptance (tighten/loosen is a policy decision):

| Metric | Proposed threshold | Rationale |
|---|---|---|
| Signal set equality | 100% — same `(ts, direction)` signals live vs backtest | deterministic pipeline claim |
| Entry price divergence | ≤ 1 pip (0.1 XAUUSD) per matched signal | feed/rounding tolerance |
| SL/TP divergence | ≤ 1 pip | same |
| Feature value divergence (ATR 15m/1h, bias 1h) | exact equality on shared anchors | features are PIT-computed from same canonical rows |
| Trade outcome (R) divergence | 0 — same exits | intrabar policy must match (`close` vs live stop-run) |
| Timestamp authority | all comparisons on canonical `ts`, UTC | no wall-clock leakage |

Execution notes:
- Use `--mode=deterministic` (`close` intrabar) for the backtest leg so resolution is reproducible.
- Live leg reads `setup_evaluations`/`signals` over the same window (already PASS under `setupLineage`).
- Output: parity report JSON + verdict row recorded wherever promotion tooling expects it (currently parity has
  "separate parity workflow" source in the adapter — needs a persistence location decision).

---

## 5. Sequenced path to green (all steps gated)

Ordered; each step lists its gate. No step executed under current read-only constraint.

1. **Fix adapter trusted-window check** (code; timeframe='1m' + chain semantics) — code change, no DB write. Can be done now if authorized.
2. **Adjudicate 2 anomaly bars** — policy decision + DB write (§2a workflow).
3. **Decide break-edge policy** (Option A/B) — policy decision; Option A also needs code/migration.
4. **Certify + promote warmup-range trusted windows** (`2026-07-08 → 2026-07-18` XAUUSD 1m) — DB writes via `certify-trusted-windows.js --write --parity-confirmed` then `promote-trusted-windows.js --reviewer`.
5. **Backfill producer runs** for `features_atr@15m`, `features_session@1m`, `features_spread@1m` over the window — DB writes + job execution; investigate why these three lack runs (other 4 features PASS with `producerStatus='done'`).
6. **Run parity gate** per §4 — execution + policy ratification of thresholds.
7. **Re-run preflight** — expect `PROMOTION_ELIGIBLE_READONLY`; archive envelope.

After step 7, promotion to live is a separate explicit act (§3, permission flip).

---

## Appendix A — verified live state snapshots (2026-08-12)

- `market.trusted_windows`: 68 rows, all `timeframe='1m'`; XAUUSD: 8 trusted + 1 candidate.
  Trusted chain: `2026-07-18T01:34Z → 2026-07-19T01:58Z` then `2026-07-19T22:05Z → 2026-08-06T18:54Z`
  (20.1h break at Sunday reopen, calendar-expected).
- `market.candle_quarantine_evidence`: 0 rows.
- `market.detector_config` active: `window-certifier-v5.3-spreadzero-keep@20260805`.
- Feature lineage: PASS for `features_atr@1h` (v1.2.0), `features_bias@1h` (v3.0.0), `features_indicator@1h` (v1.1.0),
  `features_moving_average@1h` (v2.0.0). BLOCKED_UNKNOWN for `features_atr@15m`, `features_session@1m`,
  `features_spread@1m` (rows present, `producerVersion=null`, `runsCoveringWindow=false`).
- `feature_producer_runs` column note: table has no `feature_name` column (naming differs — check actual schema
  before writing the backfill in step 5).
