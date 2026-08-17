# Week 1 Live Shadow Runbook

## Safety

- Shadow only. Zero live/demo orders.
- Do not use `--write`, `--apply`, migration, backfill, or quarantine decision commands during readiness checks.
- Any unresolved canonical blocker suppresses symbol signals.
- Never use raw candles as fallback.

## Startup order

1. Verify PostgreSQL reachable.
2. Start/verify PM2 `tz-ingestion` on port `3004`.
3. Start/verify web service.
4. Poll `/api/health` and confirm `database.connected=true`.
5. Confirm ingestion `/health` reports DB connected and spool state understood.
6. Confirm shadow workers only; verify order creation disabled by environment/policy.
7. Manually inspect first health response and first signal/suppression logs.

Use repository restart scripts. Do not restart or terminate PostgreSQL through repository scripts.

## Live suppression

Suppress symbol when any condition occurs:

- canonical candle missing or ambiguous;
- detector/quarantine blocker unresolved;
- `UNKNOWN` anomaly in live window;
- stale data clock;
- DB or ingestion outage;
- spool replay failure;
- feature lineage not canonical/detector-v3;
- parity check failure.

Record symbol, timeframe, event time, reason, detector version, and operator action. Resume only after read-only verification and explicit operator approval.

## Investigation commands

Read scripts before execution. Confirm environment points at intended database.

- Detector audit: `node scripts/detect-candle-anomalies.js --symbol=<SYMBOL> --days=<DAYS> --details --compare`
- Detector tests: `node --test scripts/detect-candle-anomalies.test.js`
- Candle parity: `node scripts/check-candle-parity-jul30.cjs`
- Dry-run signal: `pnpm tsx scripts/dry-run-live.ts <SYMBOL> <STRATEGY_ID>`
- Service restart: `ops/restart-web-v2.ps1`

`detect-candle-anomalies.js` defaults to read-only. Never add `--write` during readiness.

## Failure handling

### PostgreSQL unavailable

Stop shadow evaluation. Keep ingestion spool enabled. Restore PostgreSQL, verify `tz-ingestion` DB health, then verify data-clock and canonical state before resuming.

### Ingestion unavailable

Stop symbol evaluation. Check port `3004`, PM2 process, `/health`, and spool files. Drain only under approved operational procedure. Re-run canonical and parity checks after recovery.

### Canonical anomaly

Do not repair during live session. Suppress affected symbol. Preserve raw evidence. Escalate for reviewed `KEEP`, `EXCLUDE`, or `REPLACED` decision.

### Signal engine error

Keep zero-order policy active. Capture strategy, symbol, TF, event time, error, and trace. Do not retry with untrusted data.

## End-of-day review

Record:

- service health and restart events;
- data-clock lag;
- spool files/bytes and replay errors;
- suppressed symbols and reasons;
- unresolved anomalies;
- signal count and strategy policy;
- confirmation that order count remains zero.
