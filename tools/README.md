# Governed tooling

Operational scripts move here only after reference audit and separate review. No file movement happens during inventory.

## Rules

- Every approved operational script must appear in `script-registry.json`.
- `UNKNOWN` scripts remain in place and are not deleted.
- Mutation-capable tools require explicit scope, dry-run or confirmation, environment requirements, and deterministic exit codes.
- Production database tools must use role-specific connection variables; no embedded credentials.
- Certification, raw-source, migration, ingestion, and fail-closed validation tools remain protected.

## Current phase

Read-only inventory and reference audit. Quarantine manifest is evidence only. No files moved or deleted.
