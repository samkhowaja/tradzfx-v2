# DXY Derived-Factor Evidence Checklist — 2026-08-10

Status: **CHECKLIST ONLY — NOT RATIFICATION**  
Authority: **NON_AUTHORITATIVE**  
Database writes: **0**

This checklist defines evidence required before any proposal to change DXY derived-factor technical eligibility or permission. Checking items does not approve DXY, change gates, or alter data.

## Frozen state

```text
DXY classification       = NON_AUTHORITATIVE
residual decision        = KEEP_BLOCKED_UNKNOWN
permission               = INACTIVE
technical eligibility    = BLOCKED_UNKNOWN
DB writes                = 0
gates                    = UNCHANGED
audit phase              = OPEN
```

## A. Policy binding

- [ ] Policy version pinned: `dxy-geometric-v1`.
- [ ] Policy commit recorded.
- [ ] Formula constant, exponents, pair orientations, and fixed leg order recorded.
- [ ] Numeric tolerance recorded.
- [ ] Requested timeframe and bar interval recorded.
- [ ] Generator version and source commit recorded.
- [ ] Evidence artifact hashes recorded.

## B. Per-anchor six-leg evidence

For every requested DXY anchor and timeframe:

- [ ] `EURUSD` canonical row exists.
- [ ] `USDJPY` canonical row exists.
- [ ] `GBPUSD` canonical row exists.
- [ ] `USDCAD` canonical row exists.
- [ ] `USDSEK` canonical row exists.
- [ ] `USDCHF` canonical row exists.
- [ ] Each row ID or immutable row hash is recorded.
- [ ] Each row has canonical broker/source decision.
- [ ] Raw-feed substitution is absent.
- [ ] Mixed canonical/raw composition is absent.
- [ ] Quarantine decision is clean or explicitly approved.
- [ ] Detector version and flags are recorded.
- [ ] OHLC is finite, positive where required, and geometrically valid.
- [ ] Spread and volume evidence is recorded.
- [ ] Component jump result is recorded.

## C. Time and calendar proof

- [ ] All six bars use UTC-normalized timestamps.
- [ ] All six bars represent same closed interval `[t - Δ, t)`.
- [ ] No timestamp disagreement exceeds one bar width.
- [ ] Calendar class recorded: `OPEN`, `WEEKEND`, `HOLIDAY`, or `SESSION_BREAK`.
- [ ] Expected closure is distinguished from unexpected active-session gap.
- [ ] Partial component closure is resolved.
- [ ] Calendar disagreement does not pass silently.

## D. Formula and provenance proof

- [ ] Component prices are recorded in fixed leg order.
- [ ] Formula output is recomputed independently.
- [ ] Derived OHLC construction method is recorded.
- [ ] Formula output is finite and positive.
- [ ] Stored comparison exists, or formula-only use is explicitly approved by ratified policy.
- [ ] Residual is computed when stored value exists.
- [ ] Residual is compared against pinned tolerance.
- [ ] Provenance hash covers ordered leg hashes and formula parameters.
- [ ] Output hash recomputes byte-for-byte.

## E. Residual-row decision evidence

For each locked residual row:

- [ ] Residual row ID and detector flags recorded.
- [ ] First failing check identified using fixed check order.
- [ ] All checks recorded, including checks after first failure.
- [ ] Recommendation is exactly one of `APPROVED_DERIVED`, `EXCLUDE_DERIVED`, `KEEP_BLOCKED_UNKNOWN`.
- [ ] `APPROVED_DERIVED` has no unresolved blocker.
- [ ] `EXCLUDE_DERIVED` has proven corruption, impossible OHLC, or proven misalignment.
- [ ] Incomplete evidence remains `KEEP_BLOCKED_UNKNOWN`.
- [ ] Recommendation does not mutate stored decision.

## F. Gate review

Technical eligibility may be proposed as `ELIGIBLE` only when all required anchors pass Sections A–E and no unresolved residual remains.

Permission may be proposed as `ACTIVE` only after:

- [ ] technical eligibility is `ELIGIBLE`;
- [ ] policy is explicitly ratified;
- [ ] independent review is complete;
- [ ] workflow scope excludes canonical-candle claims;
- [ ] derived-factor fallback behavior is explicit and fail-closed;
- [ ] approval binds policy, code, evidence hashes, and time window.

## G. Forbidden actions before ratification

- [ ] No DXY canonical promotion.
- [ ] No DB writes.
- [ ] No migration.
- [ ] No backfill or feature rebuild.
- [ ] No replay or shadow execution.
- [ ] No DXY-driven signal or order.
- [ ] No silent interpolation, forward-fill, or raw fallback.

## Required final artifact

A ratification package must include this completed checklist, immutable evidence JSON, a decision checkpoint, reviewer identity, approval timestamp, approved scope, and explicit gate transition. Until that package exists, DXY remains `NON_AUTHORITATIVE` and `KEEP_BLOCKED_UNKNOWN`.
