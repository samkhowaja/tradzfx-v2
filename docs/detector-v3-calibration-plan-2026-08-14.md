# Detector v3 Calibration Plan

**Status:** planning only. Detector version stays frozen: `candle-detector-v3-robust`.

## Objectives

- Compare v2 and v3 without changing quarantine state.
- Measure disagreement by symbol, broker, flag, session, and market regime.
- Separate true market moves from feed corruption.
- Preserve fail-closed behavior during calibration.

## Samples

- `XAUUSD` 1m: certified island plus March–July history.
- `EURUSD` 1m: same broad comparison window.
- Include effective broker identity and calendar-aware gaps.
- Do not include DXY in trade eligibility decisions.

## Frozen v3 rules to measure

- Rolling return baseline: median plus `8 * MAD`.
- Non-DXY relative-return hard floor: `0.005` in detector audit.
- DXY hard floor: `0.02`; DXY is metadata/input only.
- Calendar-aware `UNEXPECTED_GAP` detection.
- XAUUSD daily break at 21:00 UTC treated as non-tradable closure.
- Flags: `INVALID_OHLC`, `IMPOSSIBLE_SPREAD`, `LARGE_JUMP_ROBUST`, `UNEXPECTED_GAP`.

## Review buckets

- v2 and v3 agree: retain evidence; no decision implied.
- v3-only jump: inspect source, alternate broker, and market confirmation.
- v2-only jump: inspect whether v3 correctly removes false positive.
- Gap disagreement: verify calendar midpoint and symbol break policy.
- Spread disagreement: verify pips contract and missing-spread encoding.

## Outputs

For each symbol/broker/window:

- total rows and flagged rows;
- counts by detector version and flag;
- overlap, v3-only, v2-only;
- disagreement timestamps;
- market-session/calendar classification;
- alternate-broker availability;
- recommendation only: investigate, candidate KEEP, candidate EXCLUDE, or remain UNKNOWN.

Recommendations are not approvals. No quarantine writes occur in calibration.

## Acceptance

Calibration is complete only when every disagreement has evidence classification and no threshold change is needed. Any threshold change requires a separate review, new version, tests, and explicit governance approval.
