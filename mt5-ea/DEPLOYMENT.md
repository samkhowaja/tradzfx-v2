# tradzfx Manager EA Deployment (V2)

## Overview

A single **tradzfx Manager EA** runs on each MetaTrader terminal. It handles:

- Auto-registration with the server
- Heartbeat / status pings
- Pulling server config (symbols, mode, risk settings)
- Polling and executing trade signals
- Polling and executing remote commands (modify SL/TP, close, partial close)
- Syncing 1m candles for configured symbols
- Reporting fills and closes back to the server

## Files

- `mt5-ea/tradzfxManager_v5_0_1.mq5` — MetaTrader 5 manager
- `mt5-ea/tradzfxManager_MT4_v5_0_1.mq4` — MetaTrader 4 manager
- Compiled binaries will be named: `tradzfxManager_v5_0_1.ex5` / `tradzfxManager_MT4_v5_0_1.ex4`

## Server prerequisites

1. The V2 web app is running (default port `3003`; nginx exposes it on `3000`).
2. The V2 engine is running (port `3002`) so features/signals are produced.
3. All V2 migrations are applied:

   ```bash
   cd C:\tradzfx-v2
   pnpm db:migrate
   ```

4. The terminal registry table `mt5_terminals` exists (created by `infra/migrations/022_mt5_terminals.sql`).
   V2 does **not** use the legacy `mt5_terminal_keys` table.

## Endpoints the EA uses

| Purpose | Endpoint |
|---|---|
| Auto-register | `POST /api/ingest/mt5/register` |
| Heartbeat | `POST /api/ingest/heartbeat` |
| Fetch config | `GET /api/ingest/config` |
| Poll signals | `GET /api/mt5/signals` |
| Report fills | `POST /api/mt5/fills` |
| Report closes | `POST /api/mt5/closes` |
| Poll commands | `GET /api/mt5/commands` |
| Ack commands | `POST /api/mt5/command-results` |
| Sync candles | `POST /api/ingest` |

## MT5 deployment

1. Open MetaTrader 5.
2. **File → Open Data Folder** → `MQL5\Experts\`.
3. Copy `tradzfxManager_v5_0_1.mq5` into `MQL5\Experts\`.
4. Open MetaEditor, load `tradzfxManager_v5_0_1.mq5`, press **F7** to compile. Confirm **0 errors**.
5. Attach to any chart (the chart symbol does not matter; the manager trades all server-assigned symbols).
6. Set inputs:
   - `InpServerUrl`: `http://127.0.0.1:3000` (recommended, goes through nginx) or `http://127.0.0.1:80` (direct)
   - `InpApiKey`: leave blank for auto-registration (recommended)
   - `InpAutoRegister`: `true` (default)
   - `InpApiKeyFile`: `tz_api_key.txt` (default; rewritten per account so multiple terminals do not clobber each other)
   - `InpTerminalLabel` *(optional)*: friendly name for this terminal
   - `InpMagic`: keep default `202633` unless it conflicts with another EA
7. In **Tools → Options → Expert Advisors**, add the server URL to **Allow WebRequest for listed URL**.
8. Verify the smiley face appears and check the Experts tab for registration confirmation.

## MT4 deployment

1. Open MetaTrader 4.
2. **File → Open Data Folder** → `MQL4\Experts\`.
3. Copy `tradzfxManager_MT4_v5_0_1.mq4` into `MQL4\Experts\`.
4. Open MetaEditor, load `tradzfxManager_MT4_v5_0_1.mq4`, press **F7** to compile. Confirm **0 errors**.
5. Attach to any chart.
6. Set inputs:
   - `InpServerUrl`: `http://127.0.0.1:3000` (recommended) or `http://127.0.0.1:80`
   - `InpApiKey`: leave blank for auto-registration
   - `InpAutoRegister`: `true`
   - `InpApiKeyFile`: `tz_api_key.txt`
   - `InpTerminalLabel` *(optional)*
   - `InpMagic`: `202633`
7. In **Tools → Options → Expert Advisors**, add the server URL to **Allow WebRequest for listed URL**.
8. Verify the smiley face and Experts tab.

## Server-side symbol & mode management

The manager reads its symbol list and execution mode from `GET /api/ingest/config`. That endpoint is driven by environment variables:

- `MT5_SYMBOLS` — comma-separated symbols (default: majors + XAUUSD)
- `NINJA_LIVE_MODE` — set to `live` for live execution; anything else is paper
- `MT5_BACKFILL_DAYS` — how many days of history the EA backfills on first sync

You can also override symbols per terminal by setting `InpSymbols` in the EA inputs.

## Verification

```sql
-- Check registered terminals
SELECT platform, account_number, broker_server, label, balance, last_seen_at
FROM mt5_terminals
ORDER BY last_seen_at DESC;

-- Check recent orders / signals
SELECT symbol, side, status, trade_mode, entry_price, stop_loss, take_profit, lot_size, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 20;

-- Check pending commands
SELECT * FROM position_commands WHERE status = 'pending' ORDER BY created_at DESC;
```

## Troubleshooting

- **401 errors**: the EA is not sending the correct API key. Ensure auto-registration succeeded (`mt5_terminals` has a row) or set `InpApiKey` explicitly to the value returned by `/api/ingest/mt5/register`.
- **WebRequest errors**: the URL is not in **Tools → Options → Expert Advisors → Allow WebRequest for listed URL**.
- **No signals**: verify the engine is running on port `3002`, features are fresh, and the strategy spec is `active: true` / `mode: live`.
- **Symbol not found on broker**: the server returns the raw symbol (e.g. `EURUSD`). The EA should map it to the broker-specific name if needed; for most brokers the raw name works.

## Rollback

Detach the manager EA to stop trading. Pending orders already in the `orders` table will expire based on their `expires_at` timestamp unless the EA is re-attached and fills them.
