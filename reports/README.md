# Versioned development audit reports

Every code or database change requires one report directory:

`reports/YYYY-MM-DD/<change-id>/`

Required files:

- `summary.md`
- `manifest.json`
- `commands.md`
- `db-before.json`
- `db-after.json`
- `validation.json`
- `blockers.json`
- `artifacts/`

Reports contain deterministic, minimal evidence. No credentials, `.env` files, database dumps, unrestricted candle exports, or personal data.

## Validation

Run:

`node scripts/validate-development-reports.cjs`

Validator checks report schema, required files, sensitive-file exclusions, and changed sensitive code coverage. `INCOMPLETE` and `BLOCKED` are valid outcomes; fabricated passes are not.

Reusable contract files:

- `reports/report-schema.json`
- `reports/blocker-taxonomy.json`
- `scripts/validate-report-contract.cjs`

Every generated report must include `framework_version` and SHA-256 `input_fingerprint`.

## Index

- `2026-08-07/reporting-framework/` — reporting framework and CI validation.
