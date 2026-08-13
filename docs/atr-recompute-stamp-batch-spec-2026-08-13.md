# ATR recompute-and-stamp batch spec — XAUUSD 15m gap repair (2026-08-13)

**SPEC ONLY. Not executed.** Separate from the trustedWindow batch. Triggered by the
ATR parity failure found in `docs/certify-gap-batch-spec-2026-08-13.md` §8:
stored XAUUSD 15m `features_atr` v1.2.0 rows are `legacy_untrusted`, all lineage
stamps NULL, and do **not** reproduce from current canonical candles (data drift).

## 0. Root cause (evidence-backed)

- Stored `features_atr` rows for the gap were (re)generated 2026-08-06→08-10 yet
  diverge from both the `candles_15m` cagg and 1m-derived buckets → the ATR was
  stamped against a candle history that has since changed (cagg rebuild / 1m repair),
  OR stamped by a path that bypassed `DAGRunner.insertRows` (lineage stamps all NULL).
- `runner.ts` (persist) auto-stamps `lineage_state='trusted_current'`,
  `canonical_version`, `eligibility_model_version`, `broker_policy_version`,
  `detector_version`, `validator_version`, `input_end_ts`, `generated_at`. NULLs mean
  these rows never went through that path (or predate it) → untraceable.

## 1. Real tooling (verified against source)

| Tool | Does | Limit for this repair |
|---|---|---|
| `scripts/recompute-feature-recent.js` | scoped recompute, anchors to **data-clock `MAX(ts)`**, trailing window only | **No `--start/--end`** → cannot reach the historical gap. Wrong tool here. |
| `scripts/backfill-historical-features.js` | DAGRunner recompute over `[--start,--end]`, `--features=` subset, auto-stamps lineage via `runner.ts` | **Correct tool.** Gated by `evaluateTrustedGate` (trusted-window coverage) unless `--trusted=off`. |
| `apps/engine` DAGRunner persist | stamps all lineage fields | invoked by backfill above |

ATR (`features_atr`) is a **leaf** feature (no DAG deps) → `skipCache` recompute is
safe (no upstream-closure rewrite, no HTF starvation). SK-66 guard does not block leaf.

## 2. Dependency loop (must sequence)

`backfill-historical-features.js` gates on `evaluateTrustedGate` — the very trusted
window the **other** batch certifies. So order is fixed:

1. **First**: trustedWindow batch (certify+promote the 07-08→07-18 gap) →
   `evaluateTrustedGate` passes for the gap.
2. **Then**: this ATR batch can backfill the gap *with* the trusted gate ON
   (no `--trusted=off` escape), keeping the gate fail-closed.

If ATR must be repaired before the trusted window exists, use `--trusted=off`
explicitly and record it as a governed exception (research escape) — not preferred.

## 3. Write-set (exactly what changes)

- `features_atr` rows for `symbol='XAUUSD'`, `tf='15m'`, `ts ∈ [07-08T03:33Z, 07-18T01:34Z)`:
  - `value` / `effective_value` recomputed from current canonical `candles_15m`,
  - `lineage_state` → `trusted_current`,
  - lineage stamps populated (canonical/eligibility/broker_policy/detector/validator
    versions, `input_end_ts`, `generated_at`),
  - `engine_ver` stays `1.2.0` (formula unchanged — this is a *re-stamp*, not a bump).
- No writes to candles, quarantine, detector_config, gates, or other features.
- Old divergent rows are overwritten by the same PK (`symbol,tf,ts,period`) — the
  3× lineage density (2,631/877) is NOT deduped here (separate decision).

## 4. Ordered runbook

```
# 0. Authorization switch ON (§6). Prereq: trustedWindow batch DONE (gate passes).
# 1. Dry proof (read-only): current parity state for the gap -> expect 0/10 (known bad).
node temp\_gap_proof.cjs        # regenerates reports/gap-readonly-proof-*.json

# 2. Recompute-and-stamp via DAGRunner, trusted gate ON (governed write)
node scripts/backfill-historical-features.js XAUUSD 15m \
  --features=features_atr --start=2026-07-08T03:33:00Z --end=2026-07-18T01:34:00Z
#    (lookbackBars default 500 gives ATR full warmup context; leaf -> skipCache safe)

# 3. Post-verify (read-only): re-run parity -> MUST be 10/10 match, lineage_state
#    = 'trusted_current', all lineage stamps non-NULL.
node temp\_gap_proof.cjs        # expect atr_all_match=true

# 4. Assert lineage stamps populated (read-only):
#    SELECT COUNT(*) FROM features_atr
#     WHERE symbol='XAUUSD' AND tf='15m' AND ts>=gap AND ts<gap_end
#       AND (lineage_state<>'trusted_current' OR canonical_version IS NULL
#            OR detector_version IS NULL OR generated_at IS NULL);
#    -> expect 0
```

## 5. Rollback / abort

- Abort if step 2 leaves any row still `legacy_untrusted` or parity <10/10 → do NOT
  proceed; recompute is idempotent, re-run after fixing the cause.
- Rows are overwritten by PK, so a bad recompute is corrected by re-running with the
  fixed inputs; no tombstone needed.
- ATR stays **fail-closed** (lineage gate `BLOCKED_UNKNOWN`) until step 3 = 10/10.

## 6. Authorization switch (hard gate)

Executes ONLY when ALL true:
- [ ] Explicit user authorization: "run the XAUUSD 15m ATR repair batch".
- [ ] trustedWindow batch already promoted (gate passes) OR explicit `--trusted=off`
      exception recorded.
- [ ] Ingestion still closed (no live feature recompute racing).
- [ ] `features_atr` confirmed leaf (no DAG deps) at run time.
- [ ] Post-verify step 3 returns **10/10** before lifting the ATR lineage hold.

## 7. Out of scope (held)

- 3× lineage density dedupe (2,631/877) — separate decision.
- Other symbols/tfs ATR recompute (audit on demand with the same proof script).
- The trustedWindow certification itself (separate batch, §2 ordering).
- Permission/technical gate flips, migration 193.
