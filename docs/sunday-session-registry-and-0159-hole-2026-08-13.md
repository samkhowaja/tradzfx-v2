# Sunday metals session registry + 2026-07-19T01:59Z hole

Status: codified 2026-08-13. Commit `5031f17` (registry), `c6b3662` (calendar-aware HTF anchors).
Governance gates unchanged: permission `INACTIVE`, technical eligibility `BLOCKED_UNKNOWN`. No gate flips.

## 1. Sunday registry (Option C)

Problem: the 1xTrade XAUUSD feed streams on **some** Sundays from ~00:00 UTC. Survey
(`temp/_sunday_full.cjs`, 2026-05-24 → 2026-08-09, raw `public.candles_1m`):

| Sunday | Raw bars | Pattern |
|---|---|---|
| 2026-07-12, 07-26, 08-02, 08-09 | ~1370 | full day from 00:00 UTC |
| 8 other Sundays | ~115–119 | reopen ~22:0x UTC only |
| 2026-07-19 | 119 early + hole | 00:00–01:58, then absent until 22:05 |

No static rule is truthful. Blanket-open manufactures false gaps on non-streaming Sundays;
blanket-close labels real streamed bars as canonical leaks.

Resolution: `SUNDAY_SESSION_BY_SYMBOL_DATE` in `packages/shared/src/utils/marketCalendar.ts`.
Each entry is keyed `symbol → UTC date → session window(s) + evidence string` citing the raw
survey. `isTradableInstant` consults it **before** the weekend check, so
`expectedTradableBars` / `tradableBarStarts` / `gapInfo` / `expectedHtfSourceSlots` /
preflight `expectedAnchors` all inherit the override.

Semantics:

- Base calendar stays strict FX 24/5. FX symbols never consult the registry.
- Unregistered Sunday + symbol = closed (extra bars = anomaly, fail-closed).
- Registered session = open only inside the recorded window(s).
- A hole **inside** a registered session (e.g. 07-19 01:59) is a genuine missing bar and
  fails closed. This is intended.
- Every divergence between "expected closure" and "broker streamed anyway" is an explicit,
  dated, auditable registry entry — not a calendar assumption.

Tests: `marketCalendar.test.ts` 45 tests (13-case Sunday it.each, EURUSD isolation,
no-symbol base, expectedTradableBars deltas). `@tm/shared` 199/199, clean tsc.

## 2. The 2026-07-19T01:59Z hole

Evidence (read-only surveys `temp/_hole*_20260719.cjs`, `_session_missing.cjs`):

- Registered session for 07-19: `[00:00, 02:00)`.
- Raw `public.candles_1m`: present through 01:58, absent 01:59, nothing until 22:05.
- Canonical `market.candles_1m_canonical`: identical absence (resumes 22:05).
- Missing bars inside registered session, via `generate_series` diff: exactly **one** bar,
  `2026-07-19T01:59:00Z`. The 02:00–22:04 stretch is outside the session → not expected.
- No `market.candle_requests` (CopyRates) row covers this window → not broker-proven under
  the three-evidence-class standard.
- One stale quarantine row (id 590, 22:05, `UNKNOWN`) already superseded 2026-08-03.

Governance impact (`reports/preflight-post-sundayreg.json`):

| TF | expected | present | firstMissing | closureFailures |
|---|---|---|---|---|
| 1m | 4381 | 4352 | 2026-07-19T01:59:00Z | 0 |
| 15m | 293 | 292 | anchor 01:45 diag 14/15 | 1 |
| 1h | 74 | 73 | anchor 01:00 diag 59/60 | 1 |

The 1m `expected−present=29` decomposes as 28 daily break-edge bars (Mon–Wed 20:5x→22:05,
counted expected by `tradableBarStarts` at 1m but excluded from canonical by break-edge
eligibility) + 1 real hole (01:59). Anchor-level diagnoses are the governance signal; the
1m aggregate delta is a counting-semantics artifact, not 29 holes.

Classification: **structural broker hole, codified evidence-pending.** Registered in
`STRUCTURAL_BROKER_HOLES` (marketCalendar.ts) with evidence classes 1+2 confirmed (live-feed
absence + historical absence, raw survey 2026-08-13) and class 3 (on-demand terminal
CopyRates) `PENDING` — ingestion closed, no `candle_requests` row covers the window. The
registry consumer (`inStructuralBrokerHole`) currently has no gate consumers, so the entry is
policy-level documentation only: fail-closed unchanged, preflight stays FAIL, technical
eligibility stays BLOCKED until class 3 lands and certification promotes it to
expected-incomplete. No gate relaxation performed.

## 3. August BLOCKED inventory (read-only, `market.candle_eligibility`)

XAUUSD August 2026: **316 BLOCKED** rows, two clusters:

| Cluster | Window | n | Fingerprint | Nature |
|---|---|---|---|---|
| A | 2026-08-03T23:06Z → 08-04T04:20Z (contiguous) | 315 | `0:blocked` | Synthetic blocked-evidence fingerprint, validator `candle-eligibility-v1`, policy 4. Matches known ingestion-outage window. No real OHLC evidence behind fingerprint. |
| B | 2026-08-02T22:05Z | 1 | `f147b29d…` | Singleton at post-Sunday-break resume bar. Real fingerprint — needs individual adjudication, NOT batch. |

Context rows: 08-01 through 08-03T23:05 are `CLEAN` policy 4 (fingerprint
`e1a606cc…`); from 08-04T05:00Z onward rows are `PERSISTED` (policy null — newer writer
path, not validator-evaluated).

Historical (out of current scope but same table): large `no effective broker policy`
population (319k, all symbols, policy null) from the pre-policy era; EURUSD Feb–Mar 2026
near-full-day BLOCKED runs; XAUUSD Mar–Jul `policy null` BLOCKED (11,583 + 4,412 + 2,742).

## 4. §5 step 3 certification — preconditions (plan only, no execution)

Before `--write --parity-confirmed` / `--apply --reviewer=salman` may run:

1. **01:59 hole provenance** — codified in `STRUCTURAL_BROKER_HOLES` (classes 1+2 done);
   obtain class 3 (on-demand terminal CopyRates request artifact) when a controlled
   backfill/provenance path reopens, then flip `verified` from PENDING to the artifact
   reference. Only then does the hole qualify for expected-incomplete (non-blocking)
   treatment at certification.
2. **August cluster A (315)** — adjudicate: either re-validate with real evidence
   (requires ingestion/backfill, currently closed) or batch-quarantine with outage
   evidence cited. Singleton B adjudicated individually.
3. **Detector v3 freeze** — median/MAD robust stats locked; validator version pinned in
   report sidecars.
4. **Parity proof set** the certification flags must demonstrate:
   - canonical ≡ raw on clean windows (no diffs outside approved holes),
   - DXY guard consistency across the window,
   - no anomalies outside the known blocker list (01:59, Aug A+B, 07-08 trustedWindow gap).
5. **Trusted-window gap** 2026-07-08T03:33Z → 07-18T01:34Z (`BLOCKED_UNKNOWN`) — resolved
   only by step 3 itself; certification promotes warmup windows, it does not backfill.

Gate rule unchanged: both gates green required; authorization cannot override technical
failure. Current state: `INACTIVE` / `BLOCKED_UNKNOWN` / shadow-parity scope only.

## 5. Artifacts

- Report: `reports/preflight-post-sundayreg.json` (UTF-16 redirect capture; JSON envelope
  between first `{` and last `}`; log lines frame it).
- Tag sidecar: `reports/preflight-post-sundayreg.tag.json` — commit `5031f17`, registry
  version, validator version, window, per-tf verdicts.
- Survey scripts: `temp/_sunday_full.cjs`, `_hole_20260719.cjs`, `_hole2_20260719.cjs`,
  `_session_missing.cjs`, `_midweek_gaps.cjs`, `_aug_blocked*.cjs` (untracked diagnostics).
