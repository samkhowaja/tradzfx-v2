# No-Alternate Quarantine Bucketing — 2026-08-15

Read-only. Suggested dispositions only — no quarantine decisions changed.

## Summary

| Bucket | Count | Meaning |
|---|---|---|
| EXCLUDE | 0 | invalid OHLC or impossible spread — structurally corrupt |
| KEEP | 0 | calendar-explained gap |
| SYNTHETIC_BOUNDARY | 1 | DXY verified formula-derived component reset |
| UNKNOWN | 479 | unexplained large jump or insufficient evidence |

## By symbol

| Symbol | EXCLUDE | KEEP | SYNTHETIC_BOUNDARY | UNKNOWN |
|---|---|---|---|---|
| AUDUSD | 0 | 0 | 0 | 36 |
| DXY | 0 | 0 | 1 | 2 |
| EURUSD | 0 | 0 | 0 | 26 |
| GBPUSD | 0 | 0 | 0 | 43 |
| NZDUSD | 0 | 0 | 0 | 32 |
| USDCHF | 0 | 0 | 0 | 2 |
| USDJPY | 0 | 0 | 0 | 67 |
| USDSEK | 0 | 0 | 0 | 60 |
| XAUUSD | 0 | 0 | 0 | 211 |

## Notes

- Rows here have no alternate-broker candle at the same timestamp; replacement is not an option.
- EXCLUDE rows must never enter trusted windows regardless of broker policy.
- KEEP rows are expected feed closures (weekend/daily break) — evidence for unblocking after review.
- UNKNOWN rows stay quarantined until manually reviewed.