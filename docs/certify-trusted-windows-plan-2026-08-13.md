# §5 step 3 plan — certify-trusted-windows for the XAUUSD 1m gap (2026-08-13)

**PLAN ONLY. Not executed.** Ingestion closed; DB read-only except authorized write
batches; this step performs governed writes (`--write`, `--apply`) and therefore needs
explicit authorization before running. Prepared so the certification can run
deterministically the moment authorization lands.

## Target

Close the standing preflight blocker:
`trustedWindow XAUUSD gap 2026-07-08T03:33Z → 2026-07-18T01:34Z` (the only window
between the earliest certified island and the 07-18T01:34Z→07-19T01:58Z island).

## Preconditions (all verified 2026-08-13, read-only)

1. **Detector frozen** — `window-certifier-v5.3-spreadzero-keep@20260805`
   (`docs/detector-v5-spec-2026-08-13.md`, commit `68e3c78`). ✅
2. **August anomalies adjudicated** — `docs/aug-blocked-adjudication-2026-08-13.md`
   (commit `068316b`); eligibility validator NULL-join bug fixed; 315+1 false-BLOCKED
   resolved to CLEAN-on-revalidation. ✅
3. **01:59 hole codified** — `STRUCTURAL_BROKER_HOLES` (commit `dfac03a`); class-3
   CopyRates PENDING, stays BLOCKING, but the hole is OUTSIDE this gap window
   (07-19T01:59 > 07-18T01:34) so it does not block THIS certification. ✅
4. **Sunday registry live** — `marketCalendar.ts` @ `dfac03a`; gap window 07-08→07-18
   contains no Sunday-session dates (registry starts 07-19), so calendar is the base
   FX 24/5 + XAUUSD daily break — matches the frozen v5.3 calendar authority. ✅

## Gap-window data health (read-only recon 2026-08-13)

| Check | Result |
|---|---|
| Raw 1m candles | 13,656 (07-08T03:33 → 07-17T20:49) |
| Eligibility | 13,654 CLEAN, 2 BLOCKED |
| 2 BLOCKED ts | 07-13T14:16Z (fp `c916c585…`), 07-14T12:30Z (fp `f147b29d…`) — both `error_message=null`; revalidate under fixed validator before certifying |
| Active quarantine | 8 rows: 5 KEEP approved (`manual-break-edge-policy-v1`, salman), 3 EXCLUDE (2 v2-calendar + 1 v3-robust = real corruption, excluded from canonical) |
| 15m candles | 914 |
| features_atr 15m | 2,631 rows / 877 distinct ts ≈ 3.0× — multi-`engine_ver` lineage retained; canonical read dedupes, but confirm parity spot-check uses the lineage-resolved value |
| Adjacent windows | 07-18T01:34→07-19T01:58 certified under v4/v5.2/v5.3 (window_id 5/47/65 trusted) + candidate 95 — gap is bounded by trusted data on the right |

## Execution plan (DO NOT RUN until authorized)

1. **Revalidate the 2 residual BLOCKED eligibility rows** under the fixed validator
   (part of the eligibility re-run; governed write). Expected: both flip CLEAN
   (structurally valid, policy healthy — same bug class as the August cluster).
2. **Parity proof set** (precondition 4 from the Sunday-registry doc):
   - Recompute ATR v1.2.0 from `candles_1m` for 10 random 15m timestamps in
     07-08→07-18, assert equality vs stored lineage-resolved `features_atr`.
   - Coverage rehearsal over 30d: 1m, 15m, 1h expected/present must match
     `reports/preflight-post-sundayreg.json` (expected −28 daily-break artifact; XAUUSD
     halts 21:00 UTC).
3. **Certify the window**:
   `node scripts/certify-trusted-windows.js --symbol=XAUUSD --timeframe=1m --from=2026-07-08T03:33:00Z --to=2026-07-18T01:34:00Z --write --parity-confirmed`
   → expect a new `trusted` row in `market.trusted_windows` stamped
   `window-certifier-v5.3-spreadzero-keep@20260805`, covering the gap.
4. **Apply with reviewer identity**:
   `--apply --reviewer=salman`
5. **Post-check**: preflight rerun over 07-19→07-23 must drop the trustedWindow
   blocker; remaining blockers = permission INACTIVE + eligibility BLOCKED_UNKNOWN
   (gate flips still held).

## Out of scope here (still held)

- Permission/technical gate flips, migration 193, XAUUSD 15m ATR lineage relaxation.
- 01:59 class-3 CopyRates (needs the terminal/ingestion path; frozen).
- The 356 v2-calendar + 286 v3-robust active UNKNOWN quarantine rows (audit trail;
  each needs adjudication or v5.3 re-evaluation before ITS window can certify — not
  required for THIS gap, which has zero UNKNOWN rows).
