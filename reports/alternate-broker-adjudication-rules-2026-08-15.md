# Alternate-Broker Adjudication Rules — 2026-08-15

Status: `DRAFT_NON_AUTHORITATIVE`

## Evidence requirements

Alternate candle may support a ruling only when symbol, timestamp, effective broker identity, source key, and immutable raw provenance are bound. Compare open, high, low, close, spread, timestamp continuity, and calendar class.

## Candidate classifications

- `REPLACED`: alternate feed has complete provenance, valid OHLC, sane spread, concordant prices within documented tolerance, and original row is demonstrably defective. Requires later explicit migration and supersession chain.
- `EXCLUDE`: all available feeds fail structural OHLC or spread validity, or no valid source exists and policy forbids reconstruction.
- `KEEP`: extreme move remains structurally valid, source-backed, calendar-consistent, and no detector evidence proves corruption.
- `UNKNOWN`: provenance, concordance, calendar, or external sanity evidence incomplete. Remains blocked.

## Required checks

- OHLC geometry: `high >= max(open, close)`, `low <= min(open, close)`, `high >= low`.
- Spread: nonnegative; zero means unresolved, not safe.
- Price concordance: close, high, and low differences must each meet symbol-class tolerance; one close check is insufficient.
- Volatility: compare neighboring returns and range using rolling median/MAD for same symbol, broker, timeframe.
- Calendar: classify gap using market calendar and effective broker identity.
- External sanity: required for material disagreement; evidence must be immutable and source-bound.

No classification from this document changes database state.
