# Structural Hole Ruling — 2026-08-15

Timestamp: `2026-07-19T01:59:00Z`

Status: `PERMANENT_STRUCTURAL_HOLE_CANDIDATE`; non-canonical; non-repairable under current evidence.

Policy:

- Do not reconstruct, synthesize, or approve candle at this timestamp.
- Preserve blocker and raw absence evidence.
- Intervals crossing this timestamp fail closed unless consumer explicitly declares hard-boundary semantics.
- Parity and backtests must split windows at boundary; no continuity inference across hole.
- Any future resolution requires immutable broker provenance, not terminal-only `CopyRates` output.

No database state changed.
