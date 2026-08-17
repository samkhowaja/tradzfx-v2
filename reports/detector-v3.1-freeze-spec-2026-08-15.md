# Detector v3.1 Freeze Specification — 2026-08-15

Status: `V3_CANDIDATE_VALIDATION`; not certified; not activated.

## Scope

Required validation population: every active canonical instrument, effective broker identity, and timeframe. Mandatory classes: FX majors, JPY, USDSEK, XAUUSD, DXY synthetic.

## Detection rules

- Baseline: rolling median/MAD over prior 60 closed bars, grouped by `symbol + effective_broker + timeframe`.
- Return: symmetric deviation; threshold `max(symbol hard floor, k × MAD)`.
- Range: upper-only deviation; lower-than-baseline range never anomaly by itself.
- Spread: pips; negative = `IMPOSSIBLE_SPREAD`; zero = unresolved/missing; class cap is upper-only.
- Gaps: classify through `market.classify_candle_gap`; expected calendar gaps never become corruption approval.
- DXY: synthetic composition and component-boundary events remain blocked as `synthetic_boundary_unresolved` until provenance ruling.

## Candidate parameters

| Class | k | Return floor | Range floor | Spread cap pips |
|---|---:|---:|---:|---:|
| FX major | 8 | 0.005 | 0.003 | 30 |
| JPY | 8 | 0.005 | 0.003 | 30 |
| SEK exotic | 10 | 0.010 | 0.006 | 80 |
| XAUUSD | 8 | 0.010 | 0.003 | 50 |
| DXY synthetic | 8 | 0.020 | 0.010 | 50 |

Parameters are candidates until per-group, per-timeframe validation completes.

## Validation requirements

- Same repeatable-read snapshot for v2 and v3.1.
- Include USDSEK and all active symbols.
- Report agreement, v3-only, v2-only, disagreement samples, missed invalid OHLC/spread, and calendar explanations.
- Manual review required for every disagreement class; no count implies approval.
- Missing input, duplicate timestamp, non-monotonic input, or unresolved provenance fails closed.

## Activation policy

- v2 evidence becomes audit-only legacy evidence.
- v3.1 may become sole anomaly writer only after certification, immutable config hash, independent review, and explicit operator approval.
- No activation, quarantine write, canonical update, repair, or migration occurs from this artifact.
