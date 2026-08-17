# Week 1 Live Shadow Readiness

**Decision date:** 2026-08-14  
**Target start:** next Sunday market open, Sydney (~Sunday 5pm ET / Monday 3:30am IST)  
**Mode:** strict shadow only

## Scope

Only these symbols may enter Week 1 shadow evaluation after passing every gate:

- `XAUUSD`: `1m`
- FX majors: `EURUSD`, `GBPUSD`, `USDJPY`, `USDCHF`, `USDCAD`, `AUDUSD`, `NZDUSD`
- DXY: input only; never tradeable

Timeframes beyond `XAUUSD 1m` require explicit approval and a completed gate row below. Scope does not expand automatically from ingestion symbol lists or active strategy lists.

## Hard safety policy

- Shadow mode may generate signals, jobs, traces, and logs.
- Shadow mode creates zero live or demo orders.
- `scripts/dry-run-live.ts` uses `evaluationOnly: true` and a non-persisting order callback.
- DXY never forms Week 1 go/no-go for strategies classified `not_required` or `optional`.
- DXY remains non-required for all active specs: `required=0`, `optional=1` (`xauusd_v1`), `not_required=59`.
- Raw candles remain immutable. No quarantine decision, backfill, migration, or fan-out apply occurs under this readiness review.

## Eligibility gates

A symbol/timeframe is eligible only when every row is `GREEN`.

| Symbol | TF | Canonical | Quarantine | PIT/live parity | Features | Shadow status | Evidence |
|---|---|---|---|---|---|---|---|
| XAUUSD | 1m | PENDING | BLOCKED | PENDING | PENDING | NOT READY | v5.3 dry-run found 1 certified island; no trusted-window candidate; recent islands blocked |
| EURUSD | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | v3 audit: 40 findings; 2 v3-only |
| GBPUSD | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | v3 audit: 32 findings; 2 v3-only |
| USDJPY | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | Confirm exact TFs first |
| USDCHF | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | Confirm exact TFs first |
| USDCAD | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | Confirm exact TFs first |
| AUDUSD | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | Confirm exact TFs first |
| NZDUSD | key traded TFs | PENDING | PENDING | PENDING | PENDING | NOT READY | Confirm exact TFs first |

`PENDING` is fail-closed. It is not approval.

## Gate definitions

### Canonical candle gate

Canonical series must exist, use broker-aware policy, carry detector v3 evidence, and have no unresolved blocking `UNKNOWN` anomaly in intended live window (default 90 days). Non-trade-window anomalies need written policy acceptance.

### Quarantine evidence gate

Required flags: `INVALID_OHLC`, `IMPOSSIBLE_SPREAD`, `LARGE_JUMP`, `UNEXPECTED_GAP`. Every detector result must record `candle-detector-v3-robust` and parameters. Any unresolved blocking anomaly during live operation suppresses that symbol.

### PIT/live parity gate

PIT and live paths must use canonical candles, with equal candle counts, equal OHLC values, and equal anomaly decisions for identical intervals. No parity claim without dated output.

### Feature gate

Live features must read canonical candles only. No backfill crosses unresolved canonical intervals. Cache lineage must identify canonical data and detector v3.

## Operational failure policy

Any failed gate suppresses symbol signals. DB outage, ingestion outage, spool replay, stale data, canonical ambiguity, or unresolved blocking anomaly causes suppression; no fallback to raw/untrusted candles.

Friday after NY close is final review. Any symbol not `GREEN` then is excluded from Week 1 shadow. Do not relax policy to meet Sunday start.

## Evidence ledger

| Check | Command/report | Run time | Result | Owner/action |
|---|---|---|---|---|
| Active DXY classification | `node scripts/audit-dxy-strategy-classification.cjs` | 2026-08-14 | GREEN | Locked |
| Strategy governance tests | `pnpm --filter @tm/strategies test -- src/dxyDependencyGovernance.test.ts src/dxyDependency.test.ts` | 2026-08-14 | GREEN | Locked |
| DXY guard tests | `pnpm --filter @tm/trade-pipeline test -- src/dxyGuard.test.ts` | 2026-08-14 | GREEN | Locked |
| Detector v2/v3 comparison | `node scripts/detect-candle-anomalies.js --symbol=<SYMBOL> --days=90 --compare` | 2026-08-14 | AMBER | XAUUSD 76/1; EURUSD 40/2; GBPUSD 32/2 v3 findings/v3-only |
| Canonical/quarantine window audit | Read-only DB audit | PENDING | NOT READY | Run per symbol/TF |
| XAUUSD trusted-window certification | `node scripts/certify-trusted-windows.js --symbols=XAUUSD --windows=3 --min-rows=1000 --max-windows-per-symbol=10` | 2026-08-14 | AMBER/BLOCKED | 1 certified island (`2026-07-18T01:34Z`–`2026-07-19T01:58Z`, 1,465 rows); latest 10-island scan blocked by robust outliers and/or unresolved quarantine |
| XAUUSD trusted-window discovery | `node scripts/discover-trusted-windows.js --symbols=XAUUSD --timeframe=1m --days=90` | 2026-08-14 | BLOCKED | No candidates |
| PIT/live parity | `scripts/check-candle-parity-jul30.cjs` or current equivalent | PENDING | NOT READY | Run dated checks |
| Live-like shadow dry run | `scripts/dry-run-live.ts` | PENDING | NOT READY | Run with zero-order policy |
| Startup/health drill | `ops/restart-web-v2.ps1` + health checks | PENDING | NOT READY | Execute operational drill |

## Go/no-go

Current state: **NO-GO**. Governance is green, but symbol/TF candle, quarantine, parity, feature, and operational gates lack current dated evidence. Shadow start moves one week if any final gate remains unresolved.
