# market_levels_legacy_20260802 provenance

## Artifact
- Dump: `market_levels_legacy_20260802_20260805T182754Z.dump`
- SHA-256: `8B5E1579EBD379AAA074D331B7C7ADEF90A9BFD4D8348EE75AD4535107351CD6`
- Restore list: `market_levels_legacy_20260802_restore_list.txt`
- DDL evidence: `ddl-market_levels_legacy_20260802.json`

## Verification
- The SHA-256 hash of the dump matches the stored sidecar hash.
- The stale sidecar artifact was removed after verification.
- No DROP TABLE was executed.

## Provenance
- Produced by the legacy Level Engine, covering the Feb→Jul 2026 data window.
- Superseded by migrations 086, 094, 095, and 173.
- The table has no `engine_ver` column; per-row provenance is derived from `source_id` and `source_json` only.
- This table predates the canonical candle policy, so rows may reflect candles that were later quarantined or re-canonicalized.

## Operational rule
- This dump is for forensic recovery only.
- It must not be re-attached to live systems.
- If needed, the legacy state can be rebuilt by re-running the legacy engine over `candles_1m`.

## Retention
- Retention review date: 2026-11-05.
- Deletion of the dump itself requires separate approval.
