# Identity Provenance Extension Plan

Status: `DESIGN_ONLY`
Authority: `NON_AUTHORITATIVE`
DB writes: `0`

## Required schema

Add nullable columns to `public.candle_quarantine`:

- `raw_evidence_id bigint`
- `raw_content_sha256 text`

Add foreign key only after orphan audit proves every populated ID exists in `market.raw_candle_evidence(raw_evidence_id)`.

Add hash consistency validation only after linkage backfill completes. Existing unresolved rows must remain nullable and blocking.

## Linkage rule

Unique match requires exact equality on:

`symbol + broker + timeframe + event_time/candle_ts + raw_source_key/source_key`

Zero matches remain orphaned. Multiple matches remain ambiguous. Neither may be auto-selected.

Populate `raw_content_sha256` only from `market.raw_candle_evidence.content_sha256`. Never compute or guess a replacement hash during linkage repair.

## Immutability rule

After initial population, `raw_evidence_id` and `raw_content_sha256` cannot change. Supersession creates a new evidence contract; it does not rewrite linkage on an existing quarantine row.

Implementation options, requiring separate approval:

1. `BEFORE UPDATE` trigger rejecting changes to populated linkage fields.
2. Privilege restriction plus controlled stored procedure.

Do not enforce `NOT NULL` until all historical rows are resolved or explicitly quarantined under a documented exception.

## Migration gates

No migration may run until a read-only preflight reports:

- exact unique matches;
- ambiguous matches;
- orphan matches;
- hash availability;
- expected row count;
- candidate identity allowlist;
- negative-space count.

Migration must use one transaction, short lock timeout, row-count assertions, before-hash assertions, and rollback artifact. It must not modify raw candles, canonical candles, features, detector state, trusted windows, ATR state, or indexes.

## Audit upgrades

After schema exists, audit must report:

- null `raw_evidence_id`;
- null `raw_content_sha256`;
- missing referenced raw evidence;
- quarantine/evidence hash mismatch;
- ambiguous raw matches;
- canonical identities with multiple raw parents;
- unresolved active decision chains;
- detector conflicts not explicitly superseded.

`CLEAN_IDENTITY` requires complete linkage, matching hash, one admissible active chain, no unresolved detector conflict, and no excluded policy scope.

## Current decision

Schema mutation is not authorized by this plan. `IDENTITY-01` remains blocked until explicit approval follows a completed preflight and authorization packet.

## Legacy mapping diagnosis

Read-only mismatch diagnostics at edge `2026-08-15T07:53:27.144Z` found:

- active quarantine rows: `699`;
- raw evidence rows visible under same edge query: `0`;
- strict matches: `0`;
- relaxed identity matches: `0`;
- source-key-only matches: `0`;
- timestamp-tolerance matches: `0`;
- no relaxed match: `699`.

This does not prove raw evidence was never recorded. It proves current diagnostic query cannot establish a mapping. Raw evidence retention, timestamp scope, table contents, or historical identity semantics require separate investigation. No row may be linked by inference.
