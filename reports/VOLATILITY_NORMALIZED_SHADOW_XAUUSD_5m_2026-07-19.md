# Normalized Volatility Shadow Report — XAUUSD 5m

**Generated:** 2026-07-19T18:41:09.321Z
**ATR period:** 5

## Scope and caveat

Current control uses latest mutable `market_volatility_profile.p95`. Shadow uses causal same-session rank computed with rows at or before each anchor. This report measures decision disagreement, not economic performance. Mutable control profile is not historical PIT evidence.

Both current profile computation and shadow rank use `effective_value`. Separate attribution confirms most disagreement comes from static profile versus causal rolling normalization, not ATR winsorization.

## Summary

| Rows | Valid shadow | Missing profile | Control pass | Shadow pass | Disagreement | Control pass / shadow block | Control block / shadow pass |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 21240 | 21240 | 0 | 18866 (88.82%) | 20083 (94.55%) | 1491 (7.02%) | 137 | 1354 |

## Session detail

| Session | Rows | Valid | p95 pips | Control pass | Shadow pass | Disagreement | Control pass / shadow block | Control block / shadow pass | Shadow samples | Profile samples |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ASIA | 6509 | 6509 | 96.09 | 6245 | 6165 | 112 (1.72%) | 96 | 16 | 809–1000 | 3484 |
| LONDON | 4608 | 4608 | 75.25 | 3387 | 4361 | 974 (21.14%) | 0 | 974 | 600–1000 | 2477 |
| NY | 4015 | 4015 | 80.98 | 3428 | 3741 | 313 (7.80%) | 0 | 313 | 540–1000 | 2390 |
| OFF_HOURS | 2561 | 2561 | 76.27 | 2429 | 2448 | 31 (1.21%) | 6 | 25 | 299–1000 | 828 |
| OVERLAP | 3547 | 3547 | 130.46 | 3377 | 3368 | 61 (1.72%) | 35 | 26 | 474–1000 | 2014 |

## Profile provenance

| Session | Profile sample start | Profile sample end | Updated | Shadow start | Shadow end |
|---|---|---|---|---|---|
| ASIA | 2026-05-12T00:00:00.000Z | 2026-07-10T06:45:00.000Z | 2026-07-10T12:09:21.159Z | 2026-04-20T01:55:00.000Z | 2026-07-17T06:55:00.000Z |
| LONDON | 2026-05-12T07:00:00.000Z | 2026-07-10T11:31:00.000Z | 2026-07-10T12:09:21.159Z | 2026-04-20T07:00:00.000Z | 2026-07-17T11:55:00.000Z |
| NY | 2026-05-11T16:00:00.000Z | 2026-07-09T20:50:00.000Z | 2026-07-10T12:09:21.160Z | 2026-04-20T16:00:00.000Z | 2026-07-17T20:45:00.000Z |
| OFF_HOURS | 2026-05-11T22:00:00.000Z | 2026-07-09T23:55:00.000Z | 2026-07-10T12:09:21.160Z | 2026-04-20T21:00:00.000Z | 2026-07-16T23:55:00.000Z |
| OVERLAP | 2026-05-11T12:10:00.000Z | 2026-07-09T15:55:00.000Z | 2026-07-10T12:09:21.160Z | 2026-04-20T12:00:00.000Z | 2026-07-17T14:35:00.000Z |

## Promotion status

**NOT READY.** Required next evidence: trade-anchor join, frozen policy, walk-forward/OOS economics, loss-cohort review, and multi-symbol coverage. No live consumer switch authorized.
