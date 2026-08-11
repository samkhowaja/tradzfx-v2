# LINEAGE-00 — XAUUSD 15m fail-closed lineage plan

Status: FAIL-CLOSED / PRODUCER-LINEAGE-NOT-REPRESENTABLE
Created: 2026-08-06

## Non-negotiable rules

- No migration 187.
- No inferred or synthetic lineage.
- No feature producer runs as candle provenance.
- No candidate creation.
- No trusted registration or promotion.
- No ATR derivation or downstream use.
- Later clean downloads create prospective evidence only.

## Required migrations

### LINEAGE-01 — source artifacts

Create `market.candle_source_artifacts`.

Fields:

- `artifact_id`
- `artifact_hash`
- `artifact_kind`
- `broker`
- `symbol`
- `timeframe`
- `range_start`
- `range_end_exclusive`
- `created_at`
- `metadata`

Constraints:

- immutable
- append-only
- unique artifact hash

### LINEAGE-02 — ingestion runs

Create `market.candle_ingestion_runs`.

Fields:

- `run_id`
- `artifact_id`
- `importer_identity`
- `importer_version`
- `configuration_hash`
- `started_at`
- `completed_at`
- `status`
- `row_count`
- `error_count`
- `manifest_hash`

Constraints:

- immutable
- no reused run IDs
- failed runs cannot produce canonical evidence

### LINEAGE-03 — raw row lineage

Create `market.candle_raw_lineage`.

Fields:

- `raw_lineage_id`
- `artifact_id`
- `run_id`
- `source_row_number`
- `source_record_key`
- `symbol`
- `broker`
- `timeframe`
- `ts`
- `payload_hash`
- `canonical_identity`
- `created_at`

Constraints:

- one immutable source row per identity
- duplicate identity rejected
- payload fingerprint from source, not reconstructed database values

### LINEAGE-04 — canonical selection lineage

Create `market.canonical_candle_lineage`.

Fields:

- `canonical_lineage_id`
- `raw_lineage_id`
- `symbol`
- `timeframe`
- `ts`
- `selected_broker`
- `selection_policy_version`
- `quarantine_evidence_version`
- `selection_reason`
- `selected_at`
- `superseded_by`

Constraints:

- append-only supersession
- unresolved evidence blocks trust
- canonical identity must match raw payload hash

### LINEAGE-05 — calendar policy

Create `market.market_calendar_policies`.

Fields:

- `policy_version`
- `policy_hash`
- `symbol`
- `rules`
- `created_at`

XAUUSD policy must encode:

- session timezone
- DST
- weekends
- Friday close
- Sunday reopen
- daily break
- holidays
- exceptional closures

## Certification gate

A 15m candidate can exist only when:

- zero unproven required children
- zero active canonical blockers
- zero calendar violations
- zero duplicate anchors
- exact source-run and artifact binding
- exact edge alignment
- complete child digest reproducible

## Current result

No real source artifact exists in workspace evidence discovery. Therefore implementation remains blocked at evidence discovery. Schema alone cannot certify historical rows.
