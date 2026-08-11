# LINEAGE evidence state machine

Status policy for certification artifacts.

## Report schema

```json
{
  "schemaVersion": 1,
  "phase": "LINEAGE-01",
  "generatedAt": "2026-08-07T02:40:27Z",
  "readOnly": true,
  "scope": {
    "symbol": "XAUUSD",
    "timeframe": "1m",
    "start": "2026-07-19T22:05:00Z",
    "endExclusive": "2026-08-06T18:54:00Z"
  },
  "coverage": {
    "required": 24825,
    "proven": 0,
    "ambiguous": 0,
    "absent": 24825
  },
  "artifacts": [],
  "coverageResult": "SOURCE-ARTIFACT-NOT-PROVABLE",
  "writes": {
    "migrationApplied": false,
    "lineageRowsInserted": 0,
    "candidateCreated": false,
    "trustedRegistered": false,
    "atrDerived": false
  }
}
```

## Valid coverage results

- `PROVEN`: every required row has artifact, parser, ingestion run, raw fingerprint, stored raw row, and canonical selection evidence.
- `AMBIGUOUS`: evidence exists but cannot uniquely or deterministically prove all required links.
- `ABSENT`: no evidence exists for required rows.
- `SOURCE-ARTIFACT-NOT-PROVABLE`: candidate artifacts exist, but none qualifies as source of truth.

## State transitions

1. `SOURCE-ARTIFACT-NOT-PROVABLE`
2. `ARTIFACT-PROVEN`
3. `INGESTION-RUN-PROVEN`
4. `RAW-ROW-LINEAGE-PROVEN`
5. `CANONICAL-SELECTION-PROVEN`
6. `CALENDAR-PROVEN`
7. `ATR-CANDIDATE-ELIGIBLE`

Transition allowed only when prior state passes.

## Certification gate

Candidate can be created only when:

- `coverage.proven == coverage.required`
- `coverage.ambiguous == 0`
- `coverage.absent == 0`
- parser identity frozen
- parser configuration hash recorded
- timezone rules frozen
- symbol mapping frozen
- deterministic row order frozen
- active canonical blockers = 0
- calendar violations = 0

## Blocking rule

Artifact checksum alone is insufficient. The same artifact must replay under frozen parser and policy to identical ordered rows and fingerprints.
