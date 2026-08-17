# Candle Provenance Ingestion Contract

Date: 2026-08-16
Status: design contract; implementation pending

## Scope

Forward-only provenance for new MT5 1m ingestion rows. No historical inference, identity repair, canonical supersession, or trading authorization.

## Canonical bar hash

Database authority: `market.raw_candle_hash(symbol, broker, timeframe, candle_ts, o, h, l, c, v, spread, digits)`.

Hash algorithm string: `sha256-v1-utc-canonical-number`.

Serialization is owned by PostgreSQL. It uses length-prefixed UTF-8 fields, UTC timestamp formatted as `YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"`, canonical finite numeric text, and nullable-field framing. `source_key` and `ingestion_run_id` are excluded from content hash so identical source bars have stable content identity across ingestion runs.

## Run evidence

`market.candle_ingestion_run_evidence` requires a successful finalized row in `market.candle_ingestion_runs`, matching symbol, broker, timeframe, and batch bounds. Streaming MT5 ingestion uses a deterministic payload artifact SHA-256 and configured source instance ID. No synthetic authority snapshot is permitted.

## Authority

Raw evidence inserts use `market.resolve_candle_authority(symbol, broker, candle_ts)`. The database trigger rejects caller-selected authority that differs from resolved authority or is not broker-allowed and quarantine-admissible.

## Write gate

`ENABLE_CANDLE_PROVENANCE=true` makes provenance mandatory. A batch is not considered successful unless run evidence, raw evidence, eligibility, and producer lineage all succeed. Feature-disabled mode is diagnostic only and must not authorize identity or trading.

## Failure policy

Any provenance failure causes batch failure/spooling. Existing candle rows are non-authoritative until linked evidence passes preflight. No legacy rows are backfilled by this contract.
