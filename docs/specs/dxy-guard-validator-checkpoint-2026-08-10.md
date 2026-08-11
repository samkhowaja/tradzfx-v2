# DXY Guard Validator Checkpoint — 2026-08-10

## Scope

This checkpoint records design-only validation for DXY non-authoritative dependency handling.

## Artifacts

- `tools/authoritative-snapshot/dxy-guard-self-check-v1.cjs`
- `tools/authoritative-snapshot/dxy-guard-manifest-validator-v1.cjs`
- `docs/specs/dxy-non-authoritative-guard-spec-2026-08-10.md`

## Validator contract

- Resolve aliases before identity checks.
- Walk transitive `dependsOn` dependencies.
- Reject execution-bearing DXY-dependent manifests with:
  `DXY_NON_AUTHORITATIVE_BLOCKED`.
- Allow DXY-dependent audit manifests only when:
  - `audit_only = true`;
  - execution is disabled;
  - provenance is required;
  - execution is explicitly prohibited.
- Allow clean manifests.

## Safety status

```text
DB_WRITES             = 0
MIGRATIONS            = NONE
RUNTIME_ENFORCEMENT   = DISABLED
GATES                 = UNCHANGED
REPLAY                = NOT_PERFORMED
SHADOW_RUN            = NOT_PERFORMED
ORDERS                = NONE
DXY_STATUS            = NON_AUTHORITATIVE
```

Validator is dry-run only. No production caller is wired.
