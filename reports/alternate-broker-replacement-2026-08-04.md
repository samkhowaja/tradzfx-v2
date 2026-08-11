# Alternate-Broker Replacement Report — 2026-08-04

Read-only evidence. No quarantine decisions changed; suggestions require manual review.

## Summary

| Suggestion | Count |
|---|---|
| KEEP_CANDIDATE | 10 |
| UNKNOWN | 140 |
| (rows without alternate broker data) | 535 |

## REPLACE_CANDIDATE rows

| Symbol | Event time | Blocked broker | Alt broker | Close diff | Flags |
|---|---|---|---|---|---|

## Notes

- Close-diff tolerance: 0.3%.
- Zero spread = missing/unresolved (importer encodes unavailable as 0).
- EXCLUDE_CANDIDATE: both blocked and alternate candles invalid.
- KEEP_CANDIDATE: quarantine flags fully explained by calendar.
- UNKNOWN: feeds disagree materially or evidence insufficient — needs manual review.