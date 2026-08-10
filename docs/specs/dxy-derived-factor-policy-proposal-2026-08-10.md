# DXY Derived-Factor Policy Proposal v1 — 2026-08-10

Status: **PROPOSAL ONLY — PENDING EXPLICIT POLICY APPROVAL**  
Authority: **NON_AUTHORITATIVE**  
Database writes: **0**

This proposal classifies DXY as a derived indicator built from canonical FX legs, not as an authoritative member of the canonical candle universe. It changes no database rows, migrations, gates, features, backfills, replays, shadow runs, or orders.

## 1. Classification and scope

- DXY is a derived factor computed from canonical FX component candles.
- DXY has no independent broker identity, raw-feed authority, or canonical candle lineage.
- A missing DXY value does not classify its FX components as invalid.
- DXY-dependent workflows remain fail-closed unless they explicitly opt into this approved derived-factor policy.
- DXY must not satisfy requirements for canonical candle completeness, broker continuity, or primary market-data evidence.

## 2. Formula and versioning

Formula version: `dxy-geometric-v1`.

$$
DXY_t = 50.14348112
\times EURUSD_t^{-0.576}
\times USDJPY_t^{0.136}
\times GBPUSD_t^{-0.119}
\times USDCAD_t^{0.091}
\times USDSEK_t^{0.042}
\times USDCHF_t^{0.036}
$$

The following are immutable policy inputs for version `dxy-geometric-v1`:

- constant: `50.14348112`;
- symbols and pair orientations: `EURUSD`, `USDJPY`, `GBPUSD`, `USDCAD`, `USDSEK`, `USDCHF`;
- exponents: `-0.576`, `0.136`, `-0.119`, `0.091`, `0.042`, `0.036`;
- UTC timestamp axis;
- requested timeframe and bar-width semantics.

Any formula, constant, component, orientation, or exponent change requires a new policy version and fresh evidence.

## 3. Canonical FX-leg requirements

Every usable DXY observation requires all six component bars to satisfy every condition:

1. component comes from canonical per-symbol series;
2. broker arbitration is resolved;
3. source and provenance are recorded;
4. quarantine and detector blockers are absent or explicitly approved;
5. OHLC values are finite and geometrically valid;
6. component timestamp and timeframe match requested DXY anchor;
7. component price values are positive and suitable for logarithmic/geometric computation;
8. component calendar state permits a bar at that anchor.

Raw-feed substitution, mixed canonical/raw composition, silent forward-fill, and interpolation are prohibited.

## 4. Timestamp alignment and calendar behavior

- UTC is canonical.
- Component bars represent the same closed interval `[t - Δ, t)`.
- All six timestamps must equal anchor `t` after canonical timestamp normalization.
- Alignment disagreement greater than one bar width produces `UNKNOWN`.
- Weekend and scheduled FX closures produce `UNDEFINED`, not corruption.
- If all six components are closed, no DXY observation is required.
- Partial closure, unexpected active-session gaps, or calendar disagreement produces `UNKNOWN`.
- A missing DXY observation at a valid component anchor is an absent derived factor, not evidence that any component candle is corrupt.

## 5. Derived OHLC and provenance

- Close: apply formula to six component closes.
- Open: apply formula to six component opens.
- High/low: use a versioned path-constrained construction from component extremes or approved intrabar path evidence.
- Do not label independently unavailable DXY OHLC as canonical market OHLC.
- Persist or emit provenance containing:
  - policy version;
  - formula constant and exponents;
  - component symbols, timestamps, row IDs or immutable content hashes;
  - canonical broker/source decisions;
  - detector and quarantine statuses;
  - calendar classification;
  - formula output and construction method;
  - generator version and code hash.

Derived output hash must bind formula version, ordered component inputs, anchor, timeframe, and construction method.

## 6. Missing-leg and invalid-evidence behavior

| Condition | Result |
|---|---|
| All six canonical legs resolved | Candidate derived value |
| Any leg missing, unresolved, quarantined, or misaligned | `UNKNOWN`; dependent use blocked |
| All legs closed under expected calendar | `UNDEFINED`; no blocker against FX lineage |
| Invalid component OHLC | `UNKNOWN` pending proof; `EXCLUDE` only after corruption proof |
| Proven component corruption with no trusted replacement | DXY `EXCLUDE` for affected interval |
| Formula or construction failure | `UNKNOWN` |
| Unapproved fallback input | `UNKNOWN` |

No fallback may silently convert `UNKNOWN` into a usable DXY value.

## 7. Formula tolerance and quality gates

Formula tolerance must be selected and versioned before production use. Proposed initial policy range: `0.01%` to `0.05%` relative close deviation. Exact tolerance requires explicit approval and evidence.

For stored or generated derived value `D` and formula value `F`:

$$
\delta = \frac{|D-F|}{F}
$$

- `δ <= ε`: formula check passes, subject to all other checks.
- `δ > ε`: derived observation fails formula check and becomes `UNKNOWN` pending review.
- `EXCLUDE` requires proven bad input, impossible construction, or proven misalignment.
- Missing stored DXY row means no residual comparison exists; do not infer `KEEP` or `EXCLUDE` from component presence alone.

Component jump boundaries, spread checks, calendar checks, and detector decisions remain independent gates. DXY cannot override a component blocker.

## 8. Fallback eligibility

Fallback is not eligible by default.

A DXY-derived fallback may be used only when a future workflow explicitly declares all of the following:

- it consumes a derived factor, not canonical candles;
- policy version is pinned;
- all six canonical legs pass at the requested anchor;
- provenance is retained;
- no component has unresolved blocking evidence;
- fallback behavior is declared in workflow configuration;
- missing DXY is handled as `UNKNOWN` or `UNDEFINED`, never silently filled;
- workflow approval explicitly permits derived-factor fallback.

Fallback is never eligible for canonical blocker equivalence, broker identity proof, canonical candle completeness, or lineage-sensitive evidence.

## 9. Decision policy

- `KEEP_DERIVED`: all six legs, alignment, calendar, formula, OHLC, jump, provenance, and detector checks pass under pinned policy version. This means usable as derived factor only, not canonical candle authority.
- `EXCLUDE_DERIVED`: proven corruption or construction failure affects derived output and no trusted replacement exists. This does not invalidate clean FX legs.
- `UNKNOWN_BLOCKED`: any required evidence is incomplete, conflicting, unresolved, or unapproved. This is default.
- `UNDEFINED`: all components are expected closed under calendar policy. This is absence by schedule, not corruption.

## 10. Current residual application

The two distinct residual anchors are:

```text
2026-07-07T21:04:00.000Z
2026-07-07T21:05:00.000Z
```

Current evidence shows six component rows at each anchor but no stored canonical DXY row. Formula residual cannot be evaluated. Under this proposal, both anchors remain `UNKNOWN_BLOCKED`; no fallback is authorized.

```text
DXY classification       = DERIVED INDICATOR CANDIDATE
canonical status         = NON_AUTHORITATIVE
residual decision        = KEEP_BLOCKED_UNKNOWN
DB writes                = 0
gates                    = UNCHANGED
audit phase              = OPEN
```

Approval of this proposal requires an explicit policy decision and a separately versioned implementation plan. Approval alone does not authorize database changes or gate changes.
