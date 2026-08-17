# Launch Gate Specification — 2026-08-15

Status: `DRAFT_NON_AUTHORITATIVE`

## Required states

Permission stays `INACTIVE` unless every gate below passes.

- `technical_eligibility`: `READY` only after canonical candle, detector, ATR lineage, feature lineage, and parity checks pass.
- `authority`: `AUTHORITATIVE` only after immutable artifacts, hashes, independent review, and operator authorization pass.
- `shadow_run`: `SHADOW_ONLY` requires zero order-placement capability.
- Any `BLOCKED`, `UNKNOWN`, `UNRESOLVED`, missing evidence, or stale evidence fails closed.

## Gates

1. Canonical interval has zero unresolved active candle blockers.
2. Detector configuration is frozen, versioned, hash-bound, and independently validated. Candidate validation is insufficient.
3. Locked exceptions remain blocked until explicit policy evidence resolves them:
   - DXY `2026-07-07T21:04:00Z`;
   - DXY `2026-07-07T21:05:00Z`;
   - structural hole `2026-07-19T01:59:00Z`;
   - terminal `CopyRates` evidence requires provenance binding.
4. XAUUSD 15m ATR(14) has 225 passing child paths, 15 passing 15m aggregates, complete feature lineage, frozen hashes, and authoritative bindings.
5. Feature, setup, signal, and risk lineage use identical closed-bar cutoffs and canonical candle selection.
6. Live/backtest parity passes exact identity checks or documented bounded equivalence checks.
7. Strategy family and variant inventory is complete; each requested variant passes runtime readiness checks.
8. Operator authorization is separate from technical eligibility. Authorization cannot override technical failure.
9. Shadow mode enforces no order placement, no broker writes, and no mutable production state changes.
10. Rollback artifact, version, trigger, and operator are recorded before activation.

## Forbidden transitions

- `INACTIVE` to `ACTIVE` on manual override alone.
- `BLOCKED_UNKNOWN` to `READY` from detector counts, feature-row presence, or backtest results alone.
- `NON_AUTHORITATIVE` to `AUTHORITATIVE` without frozen evidence and independent review.

## Current decision

```json
{
  "permission": "INACTIVE",
  "technical_eligibility": "BLOCKED_UNKNOWN",
  "shadow_run": "NO_SHADOW_RUN_YET",
  "writes": 0,
  "authority": "NON_AUTHORITATIVE"
}
```
