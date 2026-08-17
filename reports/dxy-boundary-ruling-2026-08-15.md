# DXY Boundary Ruling — 2026-08-15

Known boundary exceptions:

- `2026-07-07T21:04:00Z`
- `2026-07-07T21:05:00Z`

Status: `BLOCKED_PROVENANCE_PENDING`.

Observed behavior is consistent with synchronized component-feed boundary movement. This does not prove synthetic correctness. Required before any ruling change:

1. immutable composition inputs;
2. provider/source identity;
3. regeneration procedure and version;
4. component timestamps and values;
5. deterministic recomputation hash;
6. independent review.

Until complete, retain `synthetic_boundary_unresolved`; no KEEP, EXCLUDE, or REPLACED decision.
