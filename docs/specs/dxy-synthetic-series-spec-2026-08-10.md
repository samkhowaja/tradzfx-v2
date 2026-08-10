# DXY Synthetic-Series Specification v1 — 2026-08-10

Status: **SPECIFICATION ONLY**  
Authority: **NON_AUTHORITATIVE**  
DB writes: **0**

This specification defines DXY synthetic-series construction and admissibility. It changes no database rows, quarantine decisions, gates, migrations, features, replays, shadow runs, or orders.

## 1. Formula and component weights

DXY is a fixed-weight geometric composite of six currency pairs:

- `EURUSD`
- `USDJPY`
- `GBPUSD`
- `USDCAD`
- `USDSEK`
- `USDCHF`

Let $E_t$, $J_t$, $G_t$, $C_t$, $S_t$, and $H_t$ denote component prices at timestamp $t$.

$$
\mathrm{DXY}_t = K E_t^{-0.576} J_t^{0.136} G_t^{-0.119} C_t^{0.091} S_t^{0.042} H_t^{0.036}
$$

`K` is fixed by the selected reference-basket normalization. Runtime, broker, candle, and symbol-specific weight changes are non-canonical.

## 2. Timestamp synchronization

- UTC is canonical time axis.
- All six components require closed bars at same anchor timestamp and timeframe.
- Component bars represent $[t - \Delta, t)$.
- Missing, unresolved, quarantined, or misaligned component bars make DXY `UNKNOWN`.
- Alignment disagreement greater than one bar width makes DXY `UNKNOWN`.

## 3. Broker and source policy

- Components use canonical FX candles after broker arbitration and quarantine policy.
- Raw-feed substitution and mixed raw/canonical composition are prohibited.
- Missing or unresolved canonical component evidence blocks DXY.
- Canonical broker mapping remains:
  - `MT5` → `1x Trade Ltd.`
  - `MT4` → `OANDA Corporation`

## 4. Calendar rules

- UTC FX calendar governs DXY.
- Weekend closures are expected and are not anomalies.
- If all components are closed, DXY is undefined; no candle is required.
- Unexpected active-session component gaps make DXY `UNKNOWN`.
- Component closure/trading disagreement makes affected DXY bars `UNKNOWN`.

## 5. OHLC construction

- Close: apply formula to component closes.
- Open: apply formula to component opens.
- High/low: path-constrained extrema from component extremes or available intrabar path evidence.
- Basic constraints must hold:
  - $L_t \le \min(O_t, C_t)$
  - $H_t \ge \max(O_t, C_t)$
- Invalid component OHLC or impossible spread makes DXY `UNKNOWN` pending evidence.
- Constraint violation makes DXY `EXCLUDE` when corruption is proven; otherwise `UNKNOWN`.

## 6. Formula deviation

For stored synthetic close $D_t$ and formula close $F_t$:

$$
\delta_t = \frac{|D_t - F_t|}{F_t}
$$

- Proposed canonical tolerance: $\varepsilon = 0.01\%$–$0.05\%$, selected and versioned before use.
- Within tolerance: eligible for `KEEP` only after all other evidence passes.
- Clearly beyond tolerance with proven bad input: `EXCLUDE`.
- Incomplete or conflicting component evidence: `UNKNOWN`.
- Formula deviations cannot be ignored.

## 7. Component-jump boundary

For each component $X$:

$$
r_{X,t} = \frac{C_{X,t}}{C_{X,t-1}} - 1
$$

- Use versioned, symbol/timeframe-specific jump boundaries.
- Unresolved component `LARGE_JUMP` makes DXY `UNKNOWN`.
- Confirmed component corruption without trusted replacement makes DXY `EXCLUDE`.
- Approved genuine component extreme permits DXY `KEEP` only when aggregate behavior is consistent.
- DXY cannot override a component corruption decision.

## 8. Zero-volume interpretation

DXY is not directly traded in this model. Zero or undefined volume does not independently indicate corruption. Volume checks apply to component FX series. Price, formula, calendar, and component-integrity evidence govern DXY admissibility.

## 9. Decision criteria

### `KEEP`

All six components must be canonical and resolved; timestamp/calendar alignment must pass; formula and OHLC construction must pass; deviations must be within tolerance; and component jumps must be approved or absent.

### `EXCLUDE`

Use only when known component corruption, impossible OHLC, formula construction failure, or proven synthetic misalignment exists and no trusted replacement is available. Excluded DXY bars are missing to backtests and features.

### `UNKNOWN`

Default when evidence is incomplete: unresolved component, quarantine blocker, calendar/time mismatch, formula deviation under review, pending jump review, or suspected construction anomaly. `UNKNOWN` blocks dependent canonical use.

## 10. Required evidence

Before any residual moves from `KEEP_BLOCKED_UNKNOWN` to `KEEP` or `EXCLUDE`, capture:

1. Canonical evidence for all six FX components, including decisions, flags, detector versions, and approvals.
2. Calendar and UTC alignment evidence.
3. Formula inputs, computed OHLC, stored OHLC, and deviation.
4. Component returns, jump flags, and aggregate DXY return.
5. Decision trail with approver, timestamp, and links to component evidence.

Current residual state remains:

```text
DXY residuals         = 3
DECISION              = KEEP_BLOCKED_UNKNOWN
AUTHORITY             = NON_AUTHORITATIVE
DB_WRITES             = 0
PERMISSION            = INACTIVE
TECHNICAL_ELIGIBILITY = BLOCKED_UNKNOWN
EXECUTION             = NO_SHADOW_RUN_YET
REPLAY                = NOT_PERFORMED
MIGRATION_193         = UNAPPLIED
ORDERS                = NONE
```
