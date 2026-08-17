# Canonical Blocker Classification Plan

**Status:** planning only; no decisions applied.

## Inventory

- Active canonical blockers: 372 pre-v3.
- Alternate broker evidence: 85.
- No alternate broker evidence: 287.

## Evidence order

1. Confirm raw row identity, effective broker, timestamp, and immutable source.
2. Confirm detector version, flags, severity, and detector parameters.
3. Check canonical membership and supersession state.
4. Check alternate broker replacement evidence when available.
5. Check market calendar, symbol break, spread units, and neighboring bars.
6. Record recommendation with evidence links and confidence.

## Candidate policies

### `REPLACED`

Only when alternate broker evidence exists, matches symbol/time/event, passes OHLC and spread checks, and replacement provenance is complete. Apply only after independent human review.

### `KEEP`

Only when extreme move or gap is market-confirmed, OHLC is valid, source is trusted, and no policy violation exists. Missing spread remains unresolved unless explicit approved policy permits it.

### `EXCLUDE`

Only for demonstrably corrupt or non-tradable rows where exclusion preserves fail-closed semantics and does not hide an unresolved interval. Document exact reason and affected windows.

### `UNKNOWN`

Default when evidence is insufficient, brokers disagree without provenance, or source quality cannot be established. `UNKNOWN` blocks trusted-window certification.

## Required report

- counts by flag, broker, detector version, decision, and supersession;
- 85 alternate-evidence rows with replacement eligibility;
- 287 no-alternate rows with KEEP/EXCLUDE/UNKNOWN recommendation;
- live/backtest windows affected;
- unresolved blocker count after hypothetical decisions;
- no mutation summary.

Recommendations remain read-only until explicit approval. Never batch-apply from detector output alone.
