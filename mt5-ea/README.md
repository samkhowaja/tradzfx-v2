# tradzfxSync EA — Installation Guide

> **⚠️ Legacy V1 docs.** The current V2 stack uses a single **tradzfx Manager EA** per terminal.  
> See [`DEPLOYMENT.md`](./DEPLOYMENT.md) for the up-to-date MT5/MT4 manager deployment steps.  
> The files below are kept for reference during the migration period.

> **Version 3.0** — Pushes M1 candles from MetaTrader 5 to tradzfx-v2 server  
> Server: `http://127.0.0.1:3000` (if MT5 is on the same VPS) or `http://3.95.97.7:3000` (if remote)

---

## Prerequisites

| # | Requirement | Notes |
|---|-------------|-------|
| 1 | **MetaTrader 5** installed | Any broker, demo or live account |
| 2 | **tradzfx-v2 server** running | `http://127.0.0.1:3000` (same machine) or `http://3.95.97.7:3000` (remote) |
| 3 | **PostgreSQL** running on VPS | With `mt5_terminal_keys` table bootstrapped |

---

## Step 1 — Add the `config` column (one-time, on VPS)

SSH/RDP into the VPS and run this SQL against the `tradzfx_v2` database:

```sql
ALTER TABLE mt5_terminal_keys
  ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
```

Using `psql`:
```
psql -U tm_app -d tradzfx_v2 -c "ALTER TABLE mt5_terminal_keys ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;"
```

Or via Node on the VPS:
```
cd C:\tradzfx-v2
node -e "const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query(\"ALTER TABLE mt5_terminal_keys ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb\").then(()=>{console.log('Done');p.end()}).catch(e=>{console.error(e.message);p.end()})"
```

---

## Step 2 — Generate an API Key

On the VPS, run this SQL to create a terminal key:

```sql
INSERT INTO mt5_terminal_keys (api_key, label)
VALUES ('tm_mt5_' || encode(gen_random_bytes(16), 'hex'), 'My MT5 Terminal')
RETURNING api_key;
```

**Copy the returned `api_key` value** — you'll need it in Step 6. It looks like:  
`tm_mt5_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6`

Alternatively, use the API (from the VPS or localhost):
```
curl -X POST http://localhost:3000/api/ingest/mt5/keys \
  -H "Content-Type: application/json" \
  -d "{\"label\": \"My MT5 Terminal\"}"
```

---

## Step 3 — Copy EA File to MT5

1. Open MetaTrader 5
2. Go to **File → Open Data Folder**
3. Navigate into `MQL5\Experts\`
4. Copy `tradzfxSync_v4_22.mq5` from this folder into that `Experts` directory

**Path example:**  
`C:\Users\<you>\AppData\Roaming\MetaQuotes\Terminal\<ID>\MQL5\Experts\tradzfxSync_v4_22.mq5`

---

## Step 4 — Compile the EA

1. In MT5, press **F4** (or click **MetaEditor** icon in the toolbar)
2. In MetaEditor, open `tradzfxSync_v4_22.mq5` from the Experts folder
3. Press **F7** (or click **Compile**)
4. Verify: **0 errors** in the output panel. Warnings are OK.
5. Close MetaEditor and return to MT5

---

## Step 5 — Allow WebRequest

This is **critical** — MT5 blocks HTTP requests by default.

1. In MT5: **Tools → Options → Expert Advisors**
2. Check ✅ **Allow WebRequest for listed URL**
3. Click **Add** and type:  
   ```
   http://127.0.0.1:3000
   ```
   If MT5 is on a **different machine**, use the public IP instead:
   ```
   http://3.95.97.7:3000
   ```
5. Click **OK**

![WebRequest Settings](https://i.imgur.com/placeholder.png)

---

## Step 6 — Attach EA to a Chart

1. In MT5, open **any chart** (e.g. EURUSD M1)
2. In the **Navigator** panel (Ctrl+N), expand **Expert Advisors**
3. Find **tradzfxSync** and **drag it onto the chart**
4. The EA settings dialog appears — configure these inputs:

| Input | Value | Notes |
|-------|-------|-------|
| **InpApiKey** | `tm_mt5_your_key_here` | The key from Step 2 |
| **InpServerUrl** | `http://127.0.0.1:3000` | Use `127.0.0.1` if MT5 is on the VPS (faster, safer) |
| **InpSymbols** | *(leave empty)* | Uses server config, or set to `EURUSD,GBPUSD,USDJPY` |
| **InpBackfillDays** | `90` | How many days of history to push initially |
| **InpBatchSize** | `2000` | Bars per HTTP request |
| **InpSyncIntervalSec** | `60` | Seconds between syncs |

5. Click the **Common** tab:
   - ✅ **Allow Algo Trading** must be checked
   - ✅ **Allow DLL imports** (optional, not required)
6. Click **OK**

---

## Step 7 — Verify It's Working

### On the MT5 chart:
- You should see a **comment overlay** on the chart showing:
  ```
  tradzfxSync v3.0
  Server: http://3.95.97.7:3000
  Config: 90d backfill, 60s interval
  Total bars pushed: 12345
  
  EURUSD: Synced to 2025-01-15 14:30
  ```
- The smiley face 😊 in the top-right corner should be visible (EA is active)

### In the Experts tab:
- Press **Ctrl+E** (or click the **Experts** tab at the bottom)
- You should see log lines like:
  ```
  tradzfxSync: Started — 2 symbol(s), interval 60s, backfill 90d
  tradzfxSync: Connected to server. Starting sync for 2 symbol(s).
  tradzfxSync: Full backfill for EURUSD: 2024.10.15 → 2025.01.15
  tradzfxSync: EURUSD — pushed 2000 bar(s), cursor → 2024.10.16 15:20
  ```

### On the server:
- Check the ingestion log:
  ```sql
  SELECT symbol, bars_accepted, status, created_at
  FROM mt5_ingestion_log
  ORDER BY created_at DESC
  LIMIT 10;
  ```
- Check terminal key stats:
  ```sql
  SELECT label, last_seen_at, last_symbol, bars_pushed_total
  FROM mt5_terminal_keys
  WHERE is_active = true;
  ```

---

## How It Works

```
MT5 Terminal                          tradzfx-v2 server
┌──────────────┐                     ┌──────────────────────┐
│ EA Timer (60s)│─── GET /config ───→│ Returns symbols,     │
│              │←── {symbols, ...} ──│ backfill, interval   │
│              │                     │                      │
│  CopyRates() │                     │                      │
│  (M1 OHLCV)  │─── GET /status ───→│ Returns cursor       │
│              │←── {cursor: ms} ────│ (last bar in DB)     │
│              │                     │                      │
│ Filter bars  │                     │                      │
│ after cursor │─── POST /bars ────→│ Upserts into         │
│              │←── {ok, cursor} ────│ market_candles table  │
│              │                     │ → SSE notification   │
│              │                     │ → Analysis pipeline  │
└──────────────┘                     └──────────────────────┘
```

### Sync Flow:
1. **Config poll** (every 2 min): EA fetches dynamic config from server
2. **Status check**: EA gets the cursor (last bar timestamp) per symbol
3. **CopyRates**: EA reads M1 candles from MT5 history
4. **Filter**: Only bars newer than cursor are sent
5. **Batch push**: Bars sent in batches of `batchSize` to `POST /bars`
6. **Server-side**: Upserts into `market_candles`, updates coverage, fires SSE + analysis

### Backfill (first run):
- On first connection, EA backfills `backfillDays` of M1 data
- Uses two-phase strategy: fills backward gaps first, then forward to present
- Approximately 1,380 bars/day × 90 days ≈ 124,000 bars per symbol
- Takes ~5-15 minutes depending on broker and batch size

---

## Troubleshooting

### "WebRequest error 4014"
**Cause:** URL not in the allowed list.  
**Fix:** Tools → Options → Expert Advisors → add `http://127.0.0.1:3000`

### "Invalid or inactive API key" (HTTP 403)
**Cause:** API key doesn't exist or is deactivated.  
**Fix:** Check the key exists and `is_active = true`:
```sql
SELECT api_key, is_active FROM mt5_terminal_keys;
```

### EA shows no smiley face / not running
**Fix:** 
- Click the **AutoTrading** button in the MT5 toolbar (must be enabled)
- Check **Common** tab on EA properties → ✅ Allow Algo Trading

### "Server returned HTTP 429"
**Cause:** Rate limited (>20 requests/minute).  
**Fix:** Increase `InpSyncIntervalSec` to 120 or higher.

### EA is pushing but dashboard shows no data
**Cause:** Symbol mismatch. MT5 may use `EURUSDm` but server normalizes to `EURUSD`.  
**Fix:** The server auto-normalizes. Check logs:
```sql
SELECT symbol, bars_accepted, created_at
FROM mt5_ingestion_log ORDER BY created_at DESC LIMIT 5;
```

### Backfill stalls / "Too many empty gaps"
**Cause:** Broker doesn't have enough M1 history.  
**Fix:** Reduce `InpBackfillDays` (e.g. 30). Or let it retry — it auto-recovers.

### Multiple EAs running
You only need **ONE chart** with the EA attached. It handles multiple symbols via the `InpSymbols` input or server config. Don't attach the EA to multiple charts.

---

## Managing Symbols from the Server

You can control which symbols the EA syncs without restarting MT5:

### Via SQL:
```sql
UPDATE mt5_terminal_keys
SET allowed_symbols = ARRAY['EURUSD','GBPUSD','USDJPY'],
    config = config || '{"symbols":["EURUSD","GBPUSD","USDJPY"]}'::jsonb,
    updated_at = now()
WHERE is_active = true;
```

### Via API:
```
curl -X POST http://127.0.0.1:3000/api/ingest/mt5/sync-symbols \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["EURUSD","GBPUSD","USDJPY"]}'
```

The EA polls config every 2 minutes and picks up changes automatically.

### Force Re-sync:
```sql
UPDATE mt5_terminal_keys
SET config = config || '{"clearAndResync":true}'::jsonb,
    updated_at = now()
WHERE is_active = true;
```
This resets cursors so the EA re-pushes all data from the backfill window.

---

## Monitoring

### Check push stats:
```
GET http://127.0.0.1:3000/api/ingest/mt5/stats
```

### Check diagnostics:
```
GET http://127.0.0.1:3000/api/ingest/mt5/diag
```

### Revoke a key:
```sql
UPDATE mt5_terminal_keys
SET is_active = false, updated_at = now()
WHERE api_key = 'tm_mt5_...';
```

---

## Quick Start Summary

```
1. VPS:   ALTER TABLE mt5_terminal_keys ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb;
2. VPS:   INSERT INTO mt5_terminal_keys (api_key, label) VALUES ('tm_mt5_'||encode(gen_random_bytes(16),'hex'), 'My MT5') RETURNING api_key;
3. MT5:   File → Open Data Folder → MQL5/Experts/ → paste tradzfxSync_v4_22.mq5
4. MT5:   F4 → open file → F7 to compile → 0 errors
5. MT5:   Tools → Options → Expert Advisors → ✅ Allow WebRequest → add http://127.0.0.1:3000
6. MT5:   Drag EA onto chart → paste API key → OK
7. MT5:   Experts tab (Ctrl+E) → watch for "pushed X bars" messages
```
