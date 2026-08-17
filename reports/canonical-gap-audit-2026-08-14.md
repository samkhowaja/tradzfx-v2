# Canonical Gap Audit — 2026-08-14

Read-only. Scope: ALL. Active quarantine rows: 699 (superseded history: 697).

## Summary

| Class | Count | Meaning |
|---|---|---|
| Intentional EXCLUDE holes | 8 | deliberate canonical scars (approved corruption) |
| UNKNOWN blocking | 545 | unresolved; cert-gate blocks (fail-closed), view keeps them by design |
| Anomalies | 0 | hole_missing / blocked_approved — MUST be 0 |

## Per-symbol

| Symbol | EXCLUDE holes | UNKNOWN blocking | KEEP flowing | Anomalies |
|---|---|---|---|---|
| AUDUSD | 0 | 40 | 12 | 3 |
| DXY | 3 | 0 | 2 | 4 |
| EURUSD | 0 | 43 | 21 | 3 |
| GBPUSD | 0 | 62 | 24 | 3 |
| NZDUSD | 2 | 41 | 6 | 4 |
| USDCAD | 0 | 1 | 0 | 3 |
| USDCHF | 0 | 21 | 8 | 4 |
| USDJPY | 0 | 68 | 2 | 3 |
| USDSEK | 0 | 73 | 14 | 2 |
| XAUUSD | 3 | 196 | 15 | 13 |

## Intentional holes (EXCLUDE)

- DXY 2026-07-07T21:04:00.000Z (id 654, candle-detector-v2-calendar, by salman)
- DXY 2026-07-07T21:04:00.000Z (id 1086, candle-detector-v3-robust, by salman)
- DXY 2026-07-07T21:05:00.000Z (id 655, candle-detector-v2-calendar, by salman)
- NZDUSD 2026-06-17T21:06:00.000Z (id 769, candle-detector-v2-calendar, by salman-row-review)
- NZDUSD 2026-06-17T21:06:00.000Z (id 1168, candle-detector-v3-robust, by salman-row-review)
- XAUUSD 2026-07-13T14:16:00.000Z (id 1032, candle-detector-v2-calendar, by salman)
- XAUUSD 2026-07-14T12:30:00.000Z (id 1033, candle-detector-v2-calendar, by salman)
- XAUUSD 2026-07-14T12:30:00.000Z (id 1371, candle-detector-v3-robust, by salman)
