# August XAUUSD BLOCKED adjudication — 2026-08-13

Shadow adjudication only. No `market.candle_eligibility` writes (certification gate
untouched). Root cause found + fixed in code; revalidation deferred to the
certification path (§5 step 3).

## Verdict

| Cluster | Rows | ts range | Adjudication |
|---|---|---|---|
| A | 315 | 2026-08-03T23:06Z → 2026-08-04T04:20Z | **FALSE BLOCKED** — eligibility-validator NULL-join bug; candles structurally valid, policy healthy, zero quarantine evidence |
| B | 1 | 2026-08-02T22:05Z | **FALSE BLOCKED** — approved KEEP quarantine row exists (salman, 2026-08-04, Sunday 22:05 open, weekend-gap explained); same validator bug validated it before the KEEP landed |

Both clusters flip to CLEAN on revalidation under the fixed validator. **0 of 316
represent genuine corruption.** No raw-candle or quarantine changes needed.

## Evidence

- All 316 raw candles present in `public.candles_1m`, OHLC finite/ordered
  (e.g. A-first 4052.62/4055.01/4052.62/4053.86, B 4075.45/4077.75/4071.58/4077.75),
  spreads 2.8–3.4 pips (normal XAUUSD range, well under the 50-pip cap).
- Policy resolution healthy: `policy_id=4` (`raw.symbol_broker_policy` XAUUSD,
  priority 1, effective_from NULL) for every row.
- Cluster A: **zero** quarantine rows at any of the 315 ts (checked via join +
  direct lookup at 23:06Z). `evidence_fingerprint='0:blocked'`, `error_message=null`
  → not structural, `evidence_count=0` → no quarantine evidence — yet BLOCKED.
- Singleton B: active KEEP row, `approved_by=salman`, notes "Sunday 22:05 open; gap
  across weekend/daily break calendar-explained; proposals file
  reports/quarantine-decision-proposals-2026-08-04-recent-islands.json". KEEP should
  clear the block; it didn't because the validator's `decision <> 'KEEP'` test also
  fired on the NULL-join artifact before the KEEP was recorded.

## Root cause (fixed)

`packages/shared/src/candles/candleEligibility.ts` (introduced `6a029ee`, 2026-08-03):

```sql
COALESCE(bool_or(q.superseded_at IS NULL AND
  (q.approved_at IS NULL OR q.decision <> 'KEEP')), false) blocked
```

With a LEFT JOIN and **zero** matching quarantine rows, the join produces one
all-NULL row; `q.superseded_at IS NULL` evaluates TRUE (NULL IS NULL), and
`q.approved_at IS NULL` is TRUE, so `bool_or(TRUE AND (TRUE OR …))` = TRUE →
`blocked=true` for **every candle with no quarantine rows**. Candles validated after
`6a029ee` deployed (2026-08-03) and before their quarantine rows existed were all
persisted BLOCKED. This also threw `BLOCKED_DATA:CANONICAL_CANDLES_BLOCKED` in
`featureWorker.ts:125`, which is what actually starved the feature pipeline during
08-03T23:06→08-04T04:20 and 08-04 06:29→07:31 (previously attributed to the
08-03T15:12Z DB maintenance).

Fix: `bool_or(q.id IS NOT NULL AND q.superseded_at IS NULL AND …)` + regression test
(`candleEligibility.test.ts`). Build clean, 200/200 tests.

## Why the trusted-window tail still certifies

The 315 false-BLOCKED rows sit inside 2026-08-03T23:06→08-04T04:20, which is INSIDE
the v5.3-certified trusted tail (XAUUSD 07-19T22:05→08-06T18:54). The window
certifier read raw candles + quarantine, not the buggy eligibility table, so the
certification stands. The eligibility rows are the only corrupt artifact.

## Remaining actions (certification path, NOT done here)

1. Re-run eligibility validation for the 316 ts after the fixed validator is live
   (the §2a re-run in `governance-decision-requirements-2026-08-12.md`); states flip
   BLOCKED→CLEAN. This is a governed write — part of §5 step 3, not this shadow pass.
2. Note for ingest: `apps/web/src/app/api/ingest/route.ts` inserts eligibility rows as
   PERSISTED; the worker claims+validates. After the fix, newly-ingested candles with
   no quarantine rows will correctly validate CLEAN.
