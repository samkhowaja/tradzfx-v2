# DXY Residual Audit — dxy-geometric-v1 — 2026-08-10

```text
mode            = READ_ONLY
formula         = dxy-geometric-v1
authority       = NON_AUTHORITATIVE
writes_allowed  = 0
tolerance       = 0.0005 (0.05%)
```

Evidence JSON: C:\Users\Salman\AppData\Local\Temp\tradzfx-frozen-audit\dxy-residual-audit-dxy-geometric-v1-2026-08-10.v1.json

## Residual 1 — 2026-07-07T21:04:00.000Z — ["LARGE_JUMP_RELATIVE"]

- legs: 6; formula output: 101.02332454071478; stored value: absent
- provenance hash: 21248862a578528413376ae001421f8257fbdc4b89cad14d12216e46d7b90cad
- classification: **UNKNOWN_BLOCKED**
- reason: LEG_MISSING_STORED_DXY; stored derived row absent, so residual comparison and calendar-qualified KEEP/EXCLUDE proof unavailable.
## Residual 2 — 2026-07-07T21:04:00.000Z — ["LARGE_JUMP_ROBUST"]

- legs: 6; formula output: 101.02332454071478; stored value: absent
- provenance hash: 21248862a578528413376ae001421f8257fbdc4b89cad14d12216e46d7b90cad
- classification: **UNKNOWN_BLOCKED**
- reason: LEG_MISSING_STORED_DXY; stored derived row absent, so residual comparison and calendar-qualified KEEP/EXCLUDE proof unavailable.
## Residual 3 — 2026-07-07T21:05:00.000Z — ["LARGE_JUMP_RELATIVE"]

- legs: 6; formula output: 101.0792191571708; stored value: absent
- provenance hash: 96a9b80cf741c6c3d11736c042ca0f7a9ef959bf0e0d93f1e39e63c33101a079
- classification: **UNKNOWN_BLOCKED**
- reason: LEG_MISSING_STORED_DXY; stored derived row absent, so residual comparison and calendar-qualified KEEP/EXCLUDE proof unavailable.

## Summary

total_residual_rows = 3
keep_derived_recommended = 0
exclude_derived_recommended = 0
unknown_blocked = 3
locked_rows_status = KEEP_BLOCKED_UNKNOWN (unchanged)
writes = 0
gates = UNCHANGED

No state changed. Locked rows remain KEEP_BLOCKED_UNKNOWN.
