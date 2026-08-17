# Candle Blocker / Detector Audit

- Authority: NON_AUTHORITATIVE
- Canonical edge: 2026-08-04T07:54:00Z
- Transaction: REPEATABLE READ READ ONLY
- Database writes: 0
- Source state changes: 0
- Artifact writes: 2

## Batch 1

Active blocker rows: 543
Distinct candle identities: 311

### By symbol

```json
{
  "AUDUSD": 38,
  "DXY": 3,
  "EURUSD": 41,
  "GBPUSD": 61,
  "NZDUSD": 41,
  "USDCHF": 19,
  "USDJPY": 67,
  "USDSEK": 67,
  "XAUUSD": 206
}
```

### By flag occurrence

```json
{
  "LARGE_JUMP_RELATIVE": 308,
  "LARGE_JUMP_ROBUST": 229,
  "UNEXPECTED_GAP": 12
}
```

### By normalized decision

```json
{
  "EXCLUDE": 8,
  "UNRESOLVED": 535
}
```

## Batch 2 — V3_CANDIDATE_VALIDATION

| Classification | Count |
|---|---:|
| OVERLAP | 31 |
| V2_ONLY | 415 |
| V3_ONLY | 305 |

Detector comparison is behavioral only. No approvals, canonical changes, feature backfill, or gate transitions occurred.

## Gate status

```json
{
  "permission": "INACTIVE",
  "technical_eligibility": "BLOCKED_UNKNOWN",
  "shadow_run": "NO_SHADOW_RUN_YET",
  "writes": 0,
  "authority": "NON_AUTHORITATIVE"
}
```
