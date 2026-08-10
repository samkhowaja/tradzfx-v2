# Audit Checkpoints

Dated, immutable decisions and evidence summaries for audit phases.

Naming: `<subject>-<decision>-YYYY-MM-DD.md`.

Each checkpoint records:

- status and authority;
- evidence and code/runner hashes;
- comparison scope and limitations;
- frozen gate state;
- prohibited actions and required next proof.

Do not edit an existing checkpoint after commit. Add a superseding dated checkpoint instead.

Audit machinery lives under `tools/authoritative-snapshot/`. Tool policy and read-only guarantees are documented in its `README.md`.
