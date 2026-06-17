# TradeMentor Manager EA Deployment

## What changed
The old fragmented setup (separate sync + execution EAs) is replaced by a single **TradeMentor Manager EA** per terminal.

- `mt5-ea/TradeMentorManager.mq5` — MT5 manager
- `mt5-ea/TradeMentorManager_MT4.mq4` — MT4 manager
- Server-side runtime config lives in `mt5_terminal_keys.config.manager`

## What the manager does
- Heartbeat every 30s (updates terminal metadata, platform, balance)
- Polls server config every 2 minutes (symbols, mode, risk settings)
- Polls trade signals and executes them (server-controls paper/live mode)
- Polls remote commands (modify SL, close, partial close)
- Syncs 1m candles for configured symbols
- Reports manager status snapshot every 2 minutes

## Prerequisites
1. Migrations `068`, `069`, `070`, `071` applied.
2. App is running on the expected port (legacy `3001`, V2 `3002`).
3. Terminal key exists in `mt5_terminal_keys` and is active.
4. `mt5_terminal_keys.config.manager` has been seeded (migration 071 does this).

## MT5 deployment

1. Open MetaTrader 5.
2. **File → Open Data Folder** → `MQL5\Experts\`.
3. Copy `TradeMentorManager.mq5` to `MQL5\Experts\`.
4. Open MetaEditor, load `TradeMentorManager.mq5`, press **F7** to compile.
   - The EA is a single flattened file; no external includes are required.
5. Confirm **0 errors**.
6. Attach to **any chart** (the symbol of the chart does not matter; manager trades all server-assigned symbols).
7. Set inputs:
   - `InpServerUrl`: `http://127.0.0.1:3001` (legacy) or `http://127.0.0.1:3002` (V2)
   - `InpApiKey`: leave blank for auto-registration (recommended)
   - `InpAutoRegister`: `true` (default)
   - `InpApiKeyFile`: `tm_api_key.txt` (default; the EA rewrites this to `tm_api_key_mt5_<account>.txt` so multiple terminals do not clobber each other)
   - `InpTerminalLabel` *(optional)*: friendly name for this terminal in the server UI
   - `InpMagic`: keep default `202633` unless conflicting with another EA
8. In **Tools → Options → Expert Advisors**, add the server URL to **Allow WebRequest for listed URL**.
9. Verify smiley face and check Experts tab.

## MT4 deployment

1. Open MetaTrader 4.
2. **File → Open Data Folder** → `MQL4\Experts\`.
3. Copy `TradeMentorManager_MT4.mq4` to `MQL4\Experts\`.
4. Open MetaEditor, load `TradeMentorManager_MT4.mq4`, press **F7** to compile.
   - The EA is a single flattened file; no external includes are required.
5. Confirm **0 errors**.
6. Attach to any chart.
7. Set inputs:
   - `InpServerUrl`: `http://127.0.0.1` (port 80 via nginx) or `http://127.0.0.1:3001`
   - `InpApiKey`: leave blank for auto-registration (recommended)
   - `InpAutoRegister`: `true` (default)
   - `InpApiKeyFile`: `tm_api_key.txt` (default; the EA rewrites this to `tm_api_key_mt4_<account>.txt` so multiple terminals do not clobber each other)
   - `InpTerminalLabel` *(optional)*: friendly name for this terminal in the server UI
   - `InpMagic`: keep default `202633`
8. In **Tools → Options → Expert Advisors**, add the server URL to **Allow WebRequest for listed URL**.
9. Verify smiley face and check Experts tab.

## Server-side symbol & mode management

Update a terminal's config via the existing config endpoint (admin/UI):

```bash
PATCH /api/ingest/mt5/config
{
  "keyId": "<terminal-key-id>",
  "config": {
    "manager": {
      "enabled": true,
      "mode": "paper",
      "symbols": ["EURUSD", "GBPUSD", "USDJPY"],
      "sync": { "enabled": true, "intervalSec": 60, "backfillDays": 90, "batchSize": 2000 },
      "execution": { "enabled": true, "pollSec": 3, "maxSpreadPips": 3.0, "maxSlippagePoints": 20, "defaultLots": 0.01 },
      "commands": { "enabled": true, "pollSec": 10 }
    }
  }
}
```

Changes are picked up by the EA within 2 minutes (next config poll).

## Verification

```sql
-- Check terminal liveness
SELECT label, platform, last_seen_at, config->'managerState' AS manager_state
FROM mt5_terminal_keys
WHERE is_active = true;

-- Check broker symbol mappings
SELECT * FROM broker_symbol_maps;

-- Check signal deliveries
SELECT * FROM signal_deliveries ORDER BY created_at DESC LIMIT 10;
```

## Rollback
- Detach the manager EA and re-attach the previous execution/sync EAs.
- The legacy EAs remain in `mt5-ea/` during the migration period.
