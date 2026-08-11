# Trusted-window outlier investigation — 2026-08-04

## Result

No candidate promotion.

## DXY candidate

Window `2026-04-23T04:45:00Z` to `2026-04-25T15:23:00Z` contains a synthetic-feed discontinuity at `2026-04-23T21:00:00Z`:

- `20:59` close: `98.78588819522552`
- `21:00` open: `98.64635094000461`
- Approximate close-to-open change: `-0.141%`

This is not a missing-row gap. Component pairs also move at the same timestamp, so this is consistent with a synthetic basket boundary/reset rather than a malformed OHLC row. Existing calendar classifier treats the timestamp as tradable for synthetic DXY, so continuity classification does not catch it. The candidate remains blocked. Future policy must model synthetic basket boundaries or split windows at the reset boundary.

## EURUSD candidate

Representative bars have valid OHLC geometry. One spread anomaly exists:

- `2026-02-03T16:16:00Z`: spread `0`, surrounding values `1.2`–`1.5` pips.

The bar range is elevated but plausible. No `candle_quality` suspect flag exists. Keep blocked until spread-zero policy and detector handling are explicitly decided.

## Governance

- Detector remains `draft`.
- Candidate rows remain `candidate`.
- No quarantine rows changed.
- No raw/canonical candle rows changed.
- No trusted-window promotion performed.
