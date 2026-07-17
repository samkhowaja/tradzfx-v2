# Ingest Resilience Runbook

How MT5 1m bars survive DB/web/nginx outages, and how to operate the pieces.

## Why this exists (Jul 6–7, 2026)

An out-of-repo admin action terminated PostgreSQL connections during a web
restart (`pool terminated by administrator command` → `ECONNREFUSED`). Bar
ingestion dropped for ~39h and recovery was manual. Root cause was not the EA
and not nginx — it was the DB going away while nothing queued bars anywhere.
The repair (MT5 CSV re-import) proved the fallback path; this runbook is the
permanent fix.

## The three layers

```
MT5 EA ──POST /api/ingest/mt5/bars──▶ nginx ──▶ tz-ingestion :3004 ──▶ PostgreSQL
  │                                            │
  ├─ hop-1 spool:                              ├─ hop-2 spool:
  │  Common\Files\tradzfx\spool\*.jsonl        │  logs/ingest-spool/*.jsonl
  │  (server unreachable)                      │  (DB unreachable)
  └─ cursor-retry from MT5 history             └─ drain loop every 15s
     (existing behavior)
```

1. **Server spool** (`scripts/ingestion-server.js` + `scripts/ingest-spool.js`).
   On a transient DB error the batch is appended to
   `logs/ingest-spool/ingest-YYYY-MM-DD.jsonl` and the EA gets
   `200 {ok:true, spooled:true}` so it advances. A drain loop replays FIFO
   every 15s once the DB answers; files are deleted when fully replayed.
   Validation errors are HTTP 400 and never spooled; drain-time 400s and
   unparseable lines go to `logs/ingest-spool/corrupt.jsonl` so one poison
   line cannot wedge the queue. Total spool is capped at 250 MB (oldest files
   dropped, logged at `error` level). Env knobs: `INGEST_SPOOL_DIR`,
   `INGEST_SPOOL_MAX_BYTES`, `INGEST_DRAIN_INTERVAL_MS`.
2. **EA spool** (`mt5-ea/tradzfxManager_v5_0_1.mq5`, inputs `InpSpoolEnabled`,
   `InpSpoolMaxMB=50`). On send failure (non-400) the batch is appended to
   `Common\Files\tradzfx\spool\<SYMBOL>.jsonl` (the same Common Files area the
   CSV exporter uses; survives terminal restarts). Replay happens after the
   next successful push and on a throttled timer sweep when the server is
   reachable. Each appended batch spans `[oldest-unsent, now]`, so the newest
   batch is always a superset — dropping the oldest half under the size cap
   loses no unique bars.
3. **Safe restarts + self-heal** (`ops/restart-web-v2.ps1`, `deploy.ps1`,
   `ops/monitor-v2-health.ps1`). Restarts gate on PostgreSQL being reachable
   and `tz-ingestion` being DB-connected *before* the web app is touched, then
   poll `/api/health` for `database.connected` (see the weekend note below).
   The monitor recycles `tz-ingestion` + `tz-web-v2` when PG is up but an app
   pool is wedged (10-minute cooldown). **Repo scripts never restart
   Postgres** — it is a native Windows service managed out-of-repo.

Idempotency: `candles_1m` has `PRIMARY KEY (symbol, broker, ts)` with
`ON CONFLICT DO UPDATE`, and timestamps are rounded to the minute, so any
replay (EA spool, server spool, cursor-retry) is safe to run any number of
times.

## Operating the spools

Check the server spool:

```bash
curl -s http://127.0.0.1:3004/health        # {db, spoolFiles, spoolBytes}
ls -la logs/ingest-spool/                    # one file per UTC day
```

A nonzero `spoolFiles` with `db:true` means a drain is in progress or a batch
is stuck (check `logs/pm2-ingestion-*.log` for `spool drain pass`). To force a
drain, just wait for the next 15s tick or `pm2 restart tz-ingestion` (it drains
on startup). Do **not** hand-edit active spool files; quarantined lines live in
`corrupt.jsonl` and can be deleted after inspection.

The EA spool lives in the terminal's `Common\Files\tradzfx\spool\` folder
(`Terminal\Common\Files\tradzfx\spool\`). The EA logs
`Server unreachable; spooled a bar batch ...` and
`Spool replay for <SYM>: N batch(es) acked, spool clear`.

## After a long outage + drain

Drained bars land in `candles_1m` but the higher-timeframe continuous
aggregates and features only cover what the live pipeline saw. For any outage
longer than a few minutes, after the spools are empty:

```bash
# 1. Verify coverage is back (calendar-aware scan; the XAUUSD daily break
#    21:00-22:00 UTC is the only expected gap -> gaps should be 0. The 1xTrade
#    feed streams metals through US holidays, so a gap on a holiday IS data
#    loss to investigate, not an expected miss).
node scripts/check-candle-coverage.js XAUUSD 30   # <symbol> [days] [tf1,tf2,...]

# 2. Refresh the continuous aggregates for the affected window (TimescaleDB),
#    e.g. via scripts/refresh-caggs.js or the ops runbook query.

# 3. Recompute historical features for the affected window:
export ZONE_BACKFILL_SKIP_OUTCOMES=1
node scripts/backfill-historical-features.js XAUUSD 1d,4h,1h,5m
```

(Steps 2–3 are exactly what the Jul 6–7 repair did; see the notes in
`logs/`/`reports/` from 2026-07-07.)

## Restarting the web app (the safe way)

```powershell
powershell -ExecutionPolicy Bypass -File ops/restart-web-v2.ps1
```

Gates: PG reachable → `tz-ingestion` DB-connected → build → restart only
`tz-web-v2` → poll `/api/health` for `database.connected`. **Note:** the gate
checks `database.connected`, not `status=='ok'` — `/api/health` returns
`degraded` whenever candles are >15m old, which is *expected* on weekends
(market closed; the feed does stream US holidays). nginx needs no reload;
restart MT5/MT4 terminals last (`ops/restart_mt5.ps1`).

## Deploying the EA spool (quiet hours)

1. The compiled binary is `mt5-ea/tradzfxManager_v5_0_1.ex5` (built via
   `MetaEditor64.exe /compile`; previous build kept as
   `mt5-ea/tradzfxManager_v5_0_1.ex5.pre-spool.bak` for instant rollback).
2. Copy the `.ex5` over the one in the live terminal's `MQL5\Experts\` folder
   and reload the EA on its chart (or restart the terminal via
   `ops/restart_mt5.ps1`). Leave inputs at defaults (`InpSpoolEnabled=true`).
3. Acceptance test (markets closed window):
   ```bash
   pm2 stop tz-ingestion            # EA posts start failing -> spool files grow
   # watch Common\Files\tradzfx\spool\*.jsonl appear
   pm2 start tz-ingestion           # EA replays; spool clears
   ```
   Then confirm row counts in `candles_1m` for the window match MT5 history
   and the calendar-aware coverage scan is unchanged.
4. Rollback: copy `tradzfxManager_v5_0_1.ex5.pre-spool.bak` back over the
   `.ex5` and reload.

The MT4 manager (`tradzfxManager_MT4_v5_0_1.mq4`) does not have the spool yet;
the helpers are MQL4-compatible (`FILE_COMMON`, `FileFindFirst` out-param in
MQL5 only) and can be ported the same way.

### Verified 2026-07-11 (live terminal, markets closed)

- Phase 1 (`pm2 stop tz-ingestion` + MT5 restart): the EA's failed backfill
  posts produced `Common\Files\tradzfx\spool\{AUDUSD,EURUSD,GBPUSD}.jsonl`
  (~49 KB, one batch each).
- Phase 2 (`pm2 start tz-ingestion` + MT5 restart): the spool drained fully
  during the next successful backfill (`Spool replay ... acked` path; server
  logged the replayed `ingested bars`). No duplicate rows are possible
  (`PRIMARY KEY (symbol, broker, ts)`).
- Side effect: the triggered backfills filled ~250 bars that live ingest had
  missed on Fri 2026-07-10 evening (see the note below) — idempotent UPSERTs,
  data-quality positive.

## Weekend EA "stall" — FIXED 2026-07-11 (root cause: frozen server clock)

While deploying the spool we found an unrelated, pre-existing issue: the MT5
manager EA appeared to go **silent after its startup backfill when the market
is closed** (no heartbeats, no signal polls; a healthy weekday EA emits ~115
heartbeats and ~515 bar posts per hour).

**Root cause (confirmed with an instrumented build):** the EA never stalled —
`OnTimer` kept firing every 3s, but every periodic gate
(`now - g_lastHeartbeat >= 30s`, etc.) was scheduled off `TimeCurrent()`.
By MQL5 design `TimeCurrent()` returns the time of the **last received quote**,
so when the market closes it freezes (observed pinned at Fri 23:58:00 server
time). With `now` frozen, every `now - last >= interval` check stayed false
after firing once at startup, so heartbeats, polls, incremental candle sync,
status reports and the spool sweep all went inert for the whole weekend. The
terminal, the timer and the EA were healthy the entire time.

**Fix (deployed 2026-07-11, compiled 0/0, verified live on the closed
market):** scheduling gates now run off the wall clock `TimeLocal()` —
`OnTimer`, `SyncAllSymbols` per-symbol gate, and the server-reachability
watchdog (`TMHttpGet/Post` + `OnInit` setters of
`g_lastSuccessfulServerContact`). All *market-time* logic stays on
`TimeCurrent()`: bar windows (`SyncSymbol`, `PushBarsWithJob`), order
expiration, `g_serverOffsetSec`, signal `addedAt`. `PollConfig` also now logs
if `EventSetTimer` ever fails (the leading false hypothesis while debugging).

Verified after restart on Sat 2026-07-11: heartbeats every ~30s wall-clock
(11:29:12, 11:29:46, 11:30:19, 11:30:49), signal polls every 3s, commands
every 10s, incremental `POST /api/ingest` reposting the last Friday bars
every 60s/symbol (`accepted:6`, idempotent), zero ingestion errors. Previously
this window showed 0 requests for 38+ minutes.

Side benefits: heartbeat-based liveness alerting now works 7 days a week (no
market-hours special-casing needed), the reachability watchdog is live on
weekends, and config/backfill requests are picked up over the weekend. On a
Sunday open the EA is already warm, so the first ticks flow immediately.

**MT4 port (same day):** the spool and the `TimeLocal()` scheduling fix were
ported verbatim to `mt5-ea/tradzfxManager_MT4_v5_0_1.mq4` (MQL4 file APIs take
the same `FileFindFirst(filter, &name, FILE_COMMON)` out-param form as MQL5 —
confirmed against docs.mql4.com), compiled 0/0 with the MT4 MetaEditor
(`metaeditor.exe /compile:... /log:...`), and deployed to terminal
50CA3DFB... (rollback: `tradzfxManager_MT4_v5_0_1.ex4.pre-spool.bak`). The MT4
instance runs `InpMode=verify`, so its candle sync + spool stay dormant until
it is promoted to `primary`; the clock fix is active and it had been silent
since Fri 16:58 before the restart — heartbeats are now continuous. Note: the
legacy `TradeMentorManager_MT4_v5_0_1` on the EURUSD,H4 chart fails to load
("cannot open file ... .ex4") because its binary was deleted out-of-band; the
repo has no source for it and the running `tradzfxManager_MT4_v5_0_1` covers
the MT4 role, so it is harmless orphaned chart state.
