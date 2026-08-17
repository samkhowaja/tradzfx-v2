# Detector v3 Validation Report — 2026-08-15

Frozen version: `candle-detector-v3-robust@20260815` (read-only analysis)

| Symbol | v2 flags | v3 flags | both | v3-only | v2-only | FP: calendar gaps | FP: DXY boundary | missed corruption |
|---|---|---|---|---|---|---|---|---|
| XAUUSD | 109 | 113 | 107 | 6 | 2 | 2 | 0 | 0 |
| EURUSD | 43 | 24 | 19 | 4 | 24 | 3 | 0 | 0 |
| USDJPY | 51 | 22 | 18 | 4 | 33 | 3 | 0 | 0 |
| DXY | 5 | 4 | 4 | 0 | 1 | 0 | 0 | 0 |

## v3 flag breakdown

- **XAUUSD**: {"LARGE_JUMP_ROBUST":110,"UNEXPECTED_GAP":7}
- **EURUSD**: {"LARGE_JUMP_ROBUST":22,"UNEXPECTED_GAP":3}
- **USDJPY**: {"LARGE_JUMP_ROBUST":21,"UNEXPECTED_GAP":3}
- **DXY**: {"LARGE_JUMP_ROBUST":2,"UNEXPECTED_GAP":2}

## Notes

- v2 evidence is audit-only; v3 is blocking authority.
- DXY synthetic-boundary timestamps are formula-derived feed resets (verified), blocked as `synthetic_boundary_unresolved` pending review, not corruption.
- "Missed corruption" = canonical rows with INVALID_OHLC/IMPOSSIBLE_SPREAD absent from v3 flags; nonzero here means detector gap.
- No quarantine decisions changed; no raw/canonical candles touched.