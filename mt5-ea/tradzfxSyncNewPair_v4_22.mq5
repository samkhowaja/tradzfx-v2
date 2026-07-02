#define TM_SYNC_ONLY
// Single-symbol mode disabled by default to allow cloud-configured multi-symbol sync.
// Define TM_FORCE_SINGLE_SYMBOL manually only for targeted symbol debugging.
#define TM_EA_NAME "tradzfxSyncNewPair"
//+------------------------------------------------------------------+
//|                                           tradzfxSync.mq5    |
//|                        tradzfx -- MT5 VPS Sync EA         |
//|                                                                  |
//| PURPOSE:                                                         |
//| Push M1 candle history + live bars from MT5 to tradzfx-v2 server   |
//| cloud via HTTP. Works on any broker, any account.               |
//|                                                                  |
//| v3.0 -- Local VPS Postgres backend (no Supabase dependency).     |
//|        Symbols, backfill days, sync interval, pause -- all       |
//|        controllable from the web UI or server config endpoint.   |
//|                                                                  |
//| SETUP:                                                           |
//| 1. Copy this file to: MT5 -> MQL5/Experts/                       |
//| 2. Allow WebRequest in MT5:                                      |
//|    Tools -> Options -> Expert Advisors ->                           |
//|    [x] Allow WebRequest for listed URL:                            |
//|    Add: http://127.0.0.1:3000  (or public IP if MT5 is remote)   |
//| 3. Drag EA onto any chart                                        |
//| 4. Set your API Key (from tradzfx -> MT5 Connector)       |
//| 5. EA will poll config from server, backfill, then sync live bars|
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "4.22"
#property description "Pushes M1 candles + executes trade signals + work queue commands from tradzfx-v2 server (v4.22 � tick-triggered live sync)"
#property strict

#include <Trade\Trade.mqh>

#ifdef TM_SYNC_ONLY
   #define TM_MODE_SYNC_ENABLED 1
#else
   #define TM_MODE_SYNC_ENABLED 1
#endif

#ifdef TM_EXEC_ONLY
   #undef TM_MODE_SYNC_ENABLED
   #define TM_MODE_SYNC_ENABLED 0
#endif

#ifdef TM_SYNC_ONLY
   #define TM_MODE_EXEC_ENABLED 0
#else
   #define TM_MODE_EXEC_ENABLED 1
#endif

#ifdef TM_EXEC_ONLY
   #undef TM_MODE_EXEC_ENABLED
   #define TM_MODE_EXEC_ENABLED 1
#endif

#ifdef TM_FORCE_SINGLE_SYMBOL
   #define TM_MODE_SINGLE_SYMBOL 1
#else
   #define TM_MODE_SINGLE_SYMBOL 0
#endif

//+------------------------------------------------------------------+
//| Terminal identification headers for server-side routing          |
//+------------------------------------------------------------------+
string TMGetTerminalHeaders()
{
   string platform = "mt5";
#ifdef __MQL4__
   platform = "mt4";
#endif
   long account = 0;
   string brokerServer = "";
#ifdef __MQL4__
   account = AccountNumber();
   brokerServer = AccountServer();
#else
   account = AccountInfoInteger(ACCOUNT_LOGIN);
   brokerServer = AccountInfoString(ACCOUNT_SERVER);
#endif
   string brokerServerEncoded = brokerServer;
   StringReplace(brokerServerEncoded, " ", "%20");

   return "X-Terminal-Platform: " + platform + "\r\n" +
          "X-Terminal-Account: " + IntegerToString(account) + "\r\n" +
          "X-Terminal-Broker-Server: " + brokerServerEncoded + "\r\n";
}
//+------------------------------------------------------------------+

//--- Input parameters (user configures these)
input string InpApiKey       = ""; // API Key (from tradzfx-v2 server)
input string InpServerUrl    = "http://127.0.0.1";                               // Server URL (port 80 via nginx � http://127.0.0.1 if MT5 runs on same VPS)
input string InpSymbols      = "";                                    // Symbols (comma-separated, empty = use server config)
input int    InpBackfillDays = 90;                                    // Backfill days (fallback if no cloud config)
input int    InpBatchSize    = 2000;                                  // Bars per batch (fallback)
input int    InpSyncIntervalSec = 60;                                 // Sync interval (fallback)
input bool   InpShowAlerts   = true;                                  // Show status alerts
input bool   InpExecEnabled  = false;                                 // Enable trade execution (signals -> orders)
input bool   InpExecPaperMode = false;                                 // Paper mode: log signals but don't execute (safe start)
input int    InpExecPollSec   = 3;                                     // Signal poll interval in seconds (1-10)
input int    InpExecSlippage  = 20;                                    // Max slippage in points for market orders
input double InpExecMaxSpreadPips = 3.0;                               // Max spread in pips � reject if wider (0 = no guard)
input string InpExecComment  = "TM";                                   // Order comment prefix
input int    InpLiveSyncSec  = 10;                                     // Live bar push interval seconds (fires on tick)

//--- Constants
#define SCHEMA_VERSION    "mt5-bars-v1"
#ifdef TM_EA_NAME
   #define EA_NAME         TM_EA_NAME
#else
   #define EA_NAME         "tradzfxSync"
#endif
#define MAX_RETRIES       3
#define RETRY_DELAY_BASE_MS 2000                                      // Base retry delay (doubles on each attempt)
#define CONFIG_POLL_SEC   120                                         // Poll config every 2 min
#define BATCH_DELAY_MS    500                                         // Delay between batches during backfill
#define SYMBOL_DELAY_MS   1000                                        // Delay between symbols during backfill
#define EXEC_MAGIC        202633                                      // Magic number for execution orders
#define MAX_TRACKED       20                                          // Max simultaneously tracked signals
#define HEARTBEAT_SEC     30                                          // Heartbeat interval (lightweight health ping)
#define MAX_SYMBOL_ERRORS 5                                           // Skip symbol after N consecutive push failures
#define WORK_QUEUE_POLL_SEC 60                                        // Poll work queue interval
#define TRADE_SYNC_SEC    300                                       // Sync trade history every 5 min

// Use trade server clock for scheduling and bar-close boundaries.
// TimeCurrent() can be stale around session boundaries when ticks are sparse.
datetime NowServerTime()
{
   datetime ts = TimeTradeServer();
   if(ts <= 0) ts = TimeCurrent();
   if(ts <= 0) ts = TimeLocal();
   return ts;
}

//--- State
datetime g_lastSyncTime[];        // Last synced bar time per symbol
string   g_symbols[];             // Active symbols (broker names, e.g. EURCADm)
string   g_baseSymbols[];         // Base pair names for server (e.g. EURCAD)
int      g_symbolCount = 0;
bool     g_backfillDone[];        // Whether initial backfill is complete per symbol
datetime g_serverFirstMs[];       // Earliest bar on server per symbol (for gap detection)
int      g_totalBarsPushed = 0;
datetime g_lastHeartbeat = 0;
datetime g_lastConfigPoll = 0;

//--- Reliability tracking (v4.0)
int      g_consecutiveErrors[];   // Per-symbol consecutive push failure count
int      g_configPollFailures = 0;// Consecutive config poll failures
datetime g_lastWorkQueuePoll = 0; // Last work queue poll time
int      g_totalWorkCompleted = 0;
int      g_totalWorkFailed = 0;
datetime g_lastTradeSync = 0;     // Last trade history sync time
int      g_totalTradesSynced = 0;

//--- Dynamic config (overridden by cloud)
int      g_backfillDays = 90;
int      g_syncIntervalSec = 60;
int      g_batchSize = 2000;
bool     g_paused = false;
int      g_lastModifyRetcode = 0;     // Last retcode from ModifyPositionSL for diagnostics
bool     g_clearAndResync = false;
string   g_configSymbols[];       // Symbols from cloud config
int      g_configSymbolCount = 0;

//--- Execution state
string   g_trackedSignalId[];     // Signal IDs we're tracking
long     g_trackedTicket[];       // MT5 ticket for each tracked signal
int      g_trackedCount = 0;      // Number of tracked (open) positions
bool     g_execEnabled = false;   // Effective exec enabled (cloud config overrides input)
bool     g_execPaperMode = false; // Effective paper mode
int      g_execSlippage = 20;     // Effective slippage in points
double   g_execMaxSpreadPips = 3.0; // Effective max spread guard
string   g_execComment = "TM";    // Effective order comment prefix
int      g_totalSignalsReceived = 0;
int      g_totalOrdersFilled = 0;
int      g_totalOrdersRejected = 0;
int      g_totalSpreadRejected = 0;
int      g_totalPaperLogged = 0;
int      g_totalPositionsClosed = 0;
datetime g_lastExecPoll = 0;       // Last time we polled /api/mt5/signals
int      g_execPollSec = 3;       // Effective poll interval (clamped 1-10)
datetime g_lastLiveSyncCheck = 0; // Last time DoLiveSyncPass ran

bool ModeSyncEnabled()
{
   return (TM_MODE_SYNC_ENABLED == 1);
}

bool ModeExecEnabled()
{
   return (TM_MODE_EXEC_ENABLED == 1);
}

bool ModeSingleSymbol()
{
   return (TM_MODE_SINGLE_SYMBOL == 1);
}

//+------------------------------------------------------------------+
//| Expert initialization                                            |
//+------------------------------------------------------------------+
int OnInit()
{
   if(StringLen(InpApiKey) < 10)
   {
      Alert(EA_NAME + ": Please set your API Key in EA settings!");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // Use input defaults
   g_backfillDays = InpBackfillDays;
   g_syncIntervalSec = InpSyncIntervalSec;
   g_batchSize = InpBatchSize;

   // Initialize execution tracking arrays
   ArrayResize(g_trackedSignalId, MAX_TRACKED);
   ArrayResize(g_trackedTicket, MAX_TRACKED);
   g_trackedCount = 0;

   g_execEnabled = InpExecEnabled;
   g_execPaperMode = InpExecPaperMode;
   g_execSlippage = InpExecSlippage;
   g_execMaxSpreadPips = InpExecMaxSpreadPips;
   g_execComment = InpExecComment;
   g_execPollSec = MathMax(1, MathMin(InpExecPollSec, 10));

   if(!ModeExecEnabled())
   {
      g_execEnabled = false;
      g_execPaperMode = false;
   }

   if(g_execEnabled)
   {
      string modeStr = g_execPaperMode ? "PAPER" : "LIVE";
      Print(EA_NAME + ": Trade execution ENABLED [", modeStr, "] (magic=", EXEC_MAGIC,
            ", poll every ", g_execPollSec, "s, spreadGuard=",
            DoubleToString(g_execMaxSpreadPips, 1), " pips)");
   }
   else
      Print(EA_NAME + ": Trade execution DISABLED (data sync only)");

   // Fetch cloud config on startup
   PollCloudConfig();

   // Parse symbols (cloud config overrides local input)
   RebuildSymbolList();

   if(ModeSyncEnabled() && g_symbolCount == 0)
   {
      Alert(EA_NAME + ": No valid symbols found!");
      return(INIT_PARAMETERS_INCORRECT);
   }

   // Set timer
   EventSetTimer(MathMax(g_syncIntervalSec, 10));

   // Check server connectivity
   if(ModeSyncEnabled() && g_symbolCount > 0)
   {
      if(!CheckServerStatus(g_symbols[0]))
      {
         Print(EA_NAME + ": WARNING - Could not reach server. Will retry on timer.");
      }
      else
      {
         Print(EA_NAME + ": Connected to server. Starting sync for ",
               g_symbolCount, " symbol(s).");
      }
   }
   else if(ModeExecEnabled())
   {
      Print(EA_NAME + ": Execution bridge initialized.");
   }

   // Start immediate backfill
   if(ModeSyncEnabled())
      Comment(EA_NAME + ": Starting initial backfill...");
   OnTimer();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
   Print(EA_NAME + ": Stopped. Total bars pushed: ", g_totalBarsPushed);
}

//+------------------------------------------------------------------+
//| Timer event -- periodic sync + config poll                        |
//+------------------------------------------------------------------+
void OnTimer()
{
   datetime nowTs = NowServerTime();

   // -- Heartbeat (every 30s, lightweight) --
   if(nowTs - g_lastHeartbeat >= HEARTBEAT_SEC)
   {
      SendHeartbeat();
      g_lastHeartbeat = nowTs;
   }

   // -- Config poll (with exponential backoff on failure) --
   int configInterval = CONFIG_POLL_SEC;
   if(g_configPollFailures > 0)
      configInterval = MathMin(CONFIG_POLL_SEC * (int)MathPow(2, g_configPollFailures), 600);

   if(nowTs - g_lastConfigPoll > configInterval)
   {
      PollCloudConfig();

      // Handle clearAndResync flag
      if(g_clearAndResync)
      {
         Print(EA_NAME + ": Cloud config requested clearAndResync -- resetting cursors");
         for(int r = 0; r < g_symbolCount; r++)
         {
            g_lastSyncTime[r] = 0;
            g_backfillDone[r] = false;
            g_serverFirstMs[r] = 0;
            g_consecutiveErrors[r] = 0;
         }
         g_clearAndResync = false;
      }

      // Rebuild symbol list if cloud config changed
      RebuildSymbolList();

      // Update timer interval if changed
      EventKillTimer();
      EventSetTimer(MathMax(g_syncIntervalSec, 10));
   }

   // If paused, just update status and return
   if(g_paused)
   {
      Comment(EA_NAME + " v4.1 [PAUSED by server config]\n"
              "Server: " + InpServerUrl + "\n"
              "Total bars pushed: " + IntegerToString(g_totalBarsPushed));
      return;
   }

   // -- Work Queue: execution bridge only --
   if(ModeExecEnabled() && nowTs - g_lastWorkQueuePoll > WORK_QUEUE_POLL_SEC)
   {
      PollWorkQueue();
      g_lastWorkQueuePoll = nowTs;
   }

   // -- Trade History Sync (every 5 min) --
   if(ModeExecEnabled() && nowTs - g_lastTradeSync >= TRADE_SYNC_SEC)
   {
      SyncTradeHistory();
      g_lastTradeSync = nowTs;
   }

   // -- Backfill loop (timer-driven; live sync is handled by OnTick DoLiveSyncPass) --
   if(ModeSyncEnabled())
   {
      for(int i = 0; i < g_symbolCount; i++)
      {
         string sym = g_symbols[i];

         // Skip symbol if too many consecutive errors (reset via config poll)
         if(g_consecutiveErrors[i] >= MAX_SYMBOL_ERRORS)
         {
            if(g_consecutiveErrors[i] == MAX_SYMBOL_ERRORS)
            {
               Print(EA_NAME + ": Skipping ", sym, " after ", MAX_SYMBOL_ERRORS,
                     " consecutive errors. Will retry on next config poll.");
               g_consecutiveErrors[i]++; // Increment past threshold to avoid repeated logging
            }
            continue;
         }

         if(!g_backfillDone[i])
         {
            Print(EA_NAME + ": Backfilling ", sym, " (", g_backfillDays, " days)...");
            bool ok = DoBackfill(i, sym);
            if(ok)
            {
               g_backfillDone[i] = true;
               g_consecutiveErrors[i] = 0;
               Print(EA_NAME + ": Backfill complete for ", sym);
            }
            else
            {
               g_consecutiveErrors[i]++;
            }
            // Pause between symbols during backfill to avoid rate-limit storms
            Sleep(SYMBOL_DELAY_MS);
         }
      }
   }

   // -- Live sync pass (fallback when ticks are sparse, e.g. pre-market or off-hours) --
   if(ModeSyncEnabled())
      DoLiveSyncPass();

   // -- Execution layer: position monitoring (local, no HTTP) --
   if(ModeExecEnabled() && g_execEnabled && !g_paused)
   {
      MonitorOpenPositions();
   }
   // Signal polling is in OnTick() for fast response (every g_execPollSec).

   UpdateStatusComment();
}

//+------------------------------------------------------------------+
//| Build/rebuild symbol list from cloud config or local input       |
//+------------------------------------------------------------------+
void RebuildSymbolList()
{
   if(ModeSingleSymbol())
   {
      ParseSymbols();
      ArrayResize(g_lastSyncTime, g_symbolCount);
      ArrayResize(g_backfillDone, g_symbolCount);
      ArrayResize(g_serverFirstMs, g_symbolCount);
      ArrayResize(g_consecutiveErrors, g_symbolCount);
      for(int i = 0; i < g_symbolCount; i++)
      {
         g_lastSyncTime[i] = 0;
         g_backfillDone[i] = false;
         g_serverFirstMs[i] = 0;
         g_consecutiveErrors[i] = 0;
      }
      return;
   }

   // Cloud config symbols take priority
   if(g_configSymbolCount > 0)
   {
      // Check if list actually changed
      bool changed = (g_configSymbolCount != g_symbolCount);
      if(!changed)
      {
         for(int i = 0; i < g_symbolCount; i++)
         {
            if(g_symbols[i] != g_configSymbols[i]) { changed = true; break; }
         }
      }

      if(changed)
      {
         Print(EA_NAME + ": Applying cloud config symbols (", g_configSymbolCount, " symbols)");

         // Save old cursors by symbol name
         string oldSym[];
         datetime oldTime[];
         bool oldDone[];
         int oldCount = g_symbolCount;
         ArrayResize(oldSym, oldCount);
         ArrayResize(oldTime, oldCount);
         ArrayResize(oldDone, oldCount);
         for(int i = 0; i < oldCount; i++)
         {
            oldSym[i] = g_symbols[i];
            oldTime[i] = (i < ArraySize(g_lastSyncTime)) ? g_lastSyncTime[i] : 0;
            oldDone[i] = (i < ArraySize(g_backfillDone)) ? g_backfillDone[i] : false;
         }

         // Build new list
         g_symbolCount = 0;
         ArrayResize(g_symbols, g_configSymbolCount);
         ArrayResize(g_lastSyncTime, g_configSymbolCount);
         ArrayResize(g_backfillDone, g_configSymbolCount);
         ArrayResize(g_serverFirstMs, g_configSymbolCount);
         ArrayResize(g_consecutiveErrors, g_configSymbolCount);

         for(int i = 0; i < g_configSymbolCount; i++)
         {
            string sym = g_configSymbols[i];
            string brokerSym = FindBrokerSymbol(sym);
            if(StringLen(brokerSym) > 0)
            {
               g_symbols[g_symbolCount] = brokerSym;
               g_lastSyncTime[g_symbolCount] = 0;
               g_backfillDone[g_symbolCount] = false;
               g_serverFirstMs[g_symbolCount] = 0;
               g_consecutiveErrors[g_symbolCount] = 0;
               for(int j = 0; j < oldCount; j++)
               {
                  if(oldSym[j] == brokerSym)
                  {
                     g_lastSyncTime[g_symbolCount] = oldTime[j];
                     g_backfillDone[g_symbolCount] = oldDone[j];
                     break;
                  }
               }
               if(brokerSym != sym)
                  Print(EA_NAME + ": Mapped '", sym, "' -> broker symbol '", brokerSym, "'");
               g_symbolCount++;
            }
            else
            {
               Print(EA_NAME + ": Cloud symbol '", sym, "' not found in Market Watch, skipping");
            }
         }
         ArrayResize(g_symbols, g_symbolCount);
         ArrayResize(g_lastSyncTime, g_symbolCount);
         ArrayResize(g_backfillDone, g_symbolCount);
         ArrayResize(g_serverFirstMs, g_symbolCount);
         ArrayResize(g_consecutiveErrors, g_symbolCount);
      }
   }
   else if(g_symbolCount == 0)
   {
      // No cloud config and no symbols yet -- parse from local input
      ParseSymbols();
      ArrayResize(g_lastSyncTime, g_symbolCount);
      ArrayResize(g_backfillDone, g_symbolCount);
      ArrayResize(g_serverFirstMs, g_symbolCount);
      ArrayResize(g_consecutiveErrors, g_symbolCount);
      for(int i = 0; i < g_symbolCount; i++)
      {
         g_lastSyncTime[i] = 0;
         g_backfillDone[i] = false;
         g_serverFirstMs[i] = 0;
         g_consecutiveErrors[i] = 0;
      }
   }
}

//+------------------------------------------------------------------+
//| Poll cloud config endpoint                                       |
//+------------------------------------------------------------------+
void PollCloudConfig()
{
   g_lastConfigPoll = NowServerTime();

   string url = InpServerUrl + "/api/ingest/mt5/config";
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;

   int res = WebRequest("GET", url, headers, 10000, post, result, resultHeaders);

   if(res != 200)
   {
      g_configPollFailures++;
      if(res == -1)
      {
         int err = GetLastError();
         Print(EA_NAME + ": Config poll WebRequest error ", err,
               " (failures: ", g_configPollFailures, ")");
      }
      else
      {
         Print(EA_NAME + ": Config poll HTTP ", res,
               " (failures: ", g_configPollFailures, ")");
      }
      return;
   }

   g_configPollFailures = 0; // Reset on success

   string body = CharArrayToString(result);

   // Extract config fields
   long bd = ExtractJsonLong(body, "backfillDays");
   if(bd > 0 && bd <= 365) g_backfillDays = (int)bd;

   long si = ExtractJsonLong(body, "syncIntervalSec");
   if(si >= 10 && si <= 3600) g_syncIntervalSec = (int)si;

   long bs = ExtractJsonLong(body, "batchSize");
   if(bs >= 100 && bs <= 10000) g_batchSize = (int)bs;

   // Execution config (cloud overrides local input)
   g_execEnabled = ExtractJsonBool(body, "execEnabled");
   g_execPaperMode = ExtractJsonBool(body, "execPaperMode");
   long ep = ExtractJsonLong(body, "execPollSec");
   if(ep >= 1 && ep <= 10) g_execPollSec = (int)ep;
   long es = ExtractJsonLong(body, "execSlippage");
   if(es >= 0 && es <= 1000) g_execSlippage = (int)es;
   double ems = ExtractJsonDouble(body, "execMaxSpreadPips");
   if(ems >= 0.0) g_execMaxSpreadPips = ems;

   if(!ModeExecEnabled())
   {
      g_execEnabled = false;
      g_execPaperMode = false;
   }

   g_paused = ExtractJsonBool(body, "paused");
   g_clearAndResync = ExtractJsonBool(body, "clearAndResync");

   ParseConfigSymbols(body);

   // Reset per-symbol errors on successful config update
   for(int i = 0; i < g_symbolCount; i++)
      if(i < ArraySize(g_consecutiveErrors)) g_consecutiveErrors[i] = 0;

   Print(EA_NAME + ": Config updated -- ",
         g_configSymbolCount, " symbols, ",
         g_backfillDays, "d backfill, ",
         g_syncIntervalSec, "s interval, exec=", (g_execEnabled ? "ON" : "OFF"),
         ", spreadGuard=", DoubleToString(g_execMaxSpreadPips, 1), "p",
         g_paused ? " [PAUSED]" : "");
}

//+------------------------------------------------------------------+
//| Resolve effective max spread per symbol                          |
//+------------------------------------------------------------------+
double ResolveExecMaxSpreadPips(string brokerSym)
{
   double maxSpread = g_execMaxSpreadPips;
   if(maxSpread <= 0.0) return 0.0;

   string sym = brokerSym;
   StringToUpper(sym);

   // Gold typically runs much wider than FX majors.
   // Keep user/config value if higher, but enforce a sane floor for XAU.
   if(StringFind(sym, "XAU") >= 0)
      maxSpread = MathMax(maxSpread, 50.0);

   return maxSpread;
}

//+------------------------------------------------------------------+
//| Parse symbols array from config JSON                             |
//+------------------------------------------------------------------+
void ParseConfigSymbols(string json)
{
   string key = "\"symbols\":[";
   int pos = StringFind(json, key);
   if(pos < 0)
   {
      g_configSymbolCount = 0;
      return;
   }

   int start = pos + StringLen(key);
   int end = StringFind(json, "]", start);
   if(end < 0)
   {
      g_configSymbolCount = 0;
      return;
   }

   string arrStr = StringSubstr(json, start, end - start);
   StringReplace(arrStr, "\"", "");
   StringReplace(arrStr, " ", "");

   if(StringLen(arrStr) == 0)
   {
      g_configSymbolCount = 0;
      ArrayResize(g_configSymbols, 0);
      return;
   }

   string parts[];
   int count = StringSplit(arrStr, ',', parts);
   g_configSymbolCount = 0;
   ArrayResize(g_configSymbols, count);

   for(int i = 0; i < count; i++)
   {
      string sym = parts[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) >= 3)
      {
         g_configSymbols[g_configSymbolCount] = sym;
         g_configSymbolCount++;
      }
   }
   ArrayResize(g_configSymbols, g_configSymbolCount);
}

//+------------------------------------------------------------------+
//| Parse input symbols (fallback -- used when no cloud config)       |
//+------------------------------------------------------------------+
void ParseSymbols()
{
   if(ModeSingleSymbol())
   {
      string singleSym = InpSymbols;
      StringTrimLeft(singleSym);
      StringTrimRight(singleSym);
      if(StringFind(singleSym, ",") >= 0)
      {
         Print(EA_NAME + ": single-symbol mode received multiple symbols in InpSymbols. Use one chart / one symbol.");
         g_symbolCount = 0;
         ArrayResize(g_symbols, 0);
         return;
      }
      if(StringLen(singleSym) == 0)
         singleSym = Symbol();

      string brokerSymSingle = FindBrokerSymbol(singleSym);
      if(StringLen(brokerSymSingle) == 0)
      {
         g_symbolCount = 0;
         ArrayResize(g_symbols, 0);
         return;
      }

      g_symbolCount = 1;
      ArrayResize(g_symbols, 1);
      g_symbols[0] = brokerSymSingle;
      if(brokerSymSingle != singleSym)
         Print(EA_NAME + ": Mapped single symbol '", singleSym, "' -> '", brokerSymSingle, "'");
      return;
   }

   if(StringLen(InpSymbols) == 0)
   {
      g_symbolCount = 1;
      ArrayResize(g_symbols, 1);
      g_symbols[0] = Symbol();
      return;
   }

   string parts[];
   int count = StringSplit(InpSymbols, ',', parts);
   g_symbolCount = 0;
   ArrayResize(g_symbols, count);

   for(int i = 0; i < count; i++)
   {
      string sym = parts[i];
      StringTrimLeft(sym);
      StringTrimRight(sym);
      if(StringLen(sym) > 0)
      {
         string brokerSym = FindBrokerSymbol(sym);
         if(StringLen(brokerSym) > 0)
         {
            g_symbols[g_symbolCount] = brokerSym;
            if(brokerSym != sym)
               Print(EA_NAME + ": Mapped '", sym, "' -> '", brokerSym, "'");
            g_symbolCount++;
         }
         else
         {
            Print(EA_NAME + ": Symbol '", sym, "' not found, skipping.");
         }
      }
   }
   ArrayResize(g_symbols, g_symbolCount);
}

//+------------------------------------------------------------------+
//| Find the broker-side symbol name for a base pair like EURCAD     |
//| Tries: exact, then common suffixes (m, .r, .i, _SB, pro, etc),  |
//| then scans all symbols in Market Watch for a substring match.    |
//+------------------------------------------------------------------+
string FindBrokerSymbol(string baseSym)
{
   // 1) Exact match
   if(SymbolSelect(baseSym, true)) return baseSym;

   // 2) Common broker suffixes
   string suffixes[] = { "m", "M", ".r", ".i", ".pro", "_SB", ".s",
                         ".a", ".b", "micro", ".", "-", "c", "f" };
   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string candidate = baseSym + suffixes[i];
      if(SymbolSelect(candidate, true)) return candidate;
   }

   // 3) Search all available symbols for base pair substring
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      // Symbol must start with the base pair (e.g. "EURCAD" in "EURCADmicro")
      if(StringFind(name, baseSym) == 0 && SymbolSelect(name, true))
         return name;
   }

   return ""; // Not found
}

//+------------------------------------------------------------------+
//| Check server connectivity via /status endpoint                   |
//+------------------------------------------------------------------+
bool CheckServerStatus(string symbol)
{
   string url = InpServerUrl + "/api/ingest/mt5/status?symbol=" + symbol;
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;
   int    timeout = 10000;

   int res = WebRequest("GET", url, headers, timeout, post, result, resultHeaders);

   if(res == -1)
   {
      int err = GetLastError();
      Print(EA_NAME + ": WebRequest error ", err,
            ". Make sure URL is allowed in Tools -> Options -> Expert Advisors");
      return false;
   }

   if(res != 200)
   {
      string body = CharArrayToString(result);
      Print(EA_NAME + ": Server returned HTTP ", res, ": ", SafeBodySnippet(body));
      return false;
   }

   string body = CharArrayToString(result);
   long cursor = ExtractJsonLong(body, "cursor");
   long firstMs = ExtractJsonLong(body, "firstMs");

   for(int i = 0; i < g_symbolCount; i++)
   {
      if(g_symbols[i] == symbol)
      {
         if(cursor > 0)
         {
            g_lastSyncTime[i] = (datetime)(cursor / 1000);
            Print(EA_NAME + ": Cursor (latest) for ", symbol, ": ",
                  TimeToString(g_lastSyncTime[i], TIME_DATE | TIME_MINUTES));
         }
         if(firstMs > 0)
         {
            g_serverFirstMs[i] = (datetime)(firstMs / 1000);
            Print(EA_NAME + ": First bar for ", symbol, ": ",
                  TimeToString(g_serverFirstMs[i], TIME_DATE | TIME_MINUTES));
         }
         break;
      }
   }

   return true;
}

//+------------------------------------------------------------------+
//| Backfill historical M1 data                                      |
//| v3.0 -- Two-phase: fills backward gap first, then forward to now. |
//| Anchors CopyRates at window END for MT5 auto-download.           |
//+------------------------------------------------------------------+
bool DoBackfill(int symIdx, string symbol)
{
   CheckServerStatus(symbol);

   datetime nowTs = NowServerTime();
   datetime targetStart = nowTs - g_backfillDays * 86400;
   datetime now = nowTs;
   datetime serverFirst = g_serverFirstMs[symIdx];
   datetime serverLast  = g_lastSyncTime[symIdx];

   // Decide what to fill:
   // Phase 1: backward gap -- targetStart -> serverFirst (if server has data but not early enough)
   // Phase 2: forward gap -- serverLast -> now (normal forward fill)

   datetime fillStart = 0;
   datetime fillEnd = 0;

   if(serverFirst > 0 && serverFirst > targetStart + 3600)
   {
      // There's a backward gap: e.g. target=Nov10, server starts=Dec29
      fillStart = targetStart;
      fillEnd = serverFirst - 60;
      Print(EA_NAME + ": Phase 1 - Filling backward gap for ", symbol,
            ": ", TimeToString(fillStart, TIME_DATE),
            " -> ", TimeToString(fillEnd, TIME_DATE));
   }
   else if(serverLast > 0)
   {
      // No backward gap (or already filled); fill forward from cursor
      fillStart = serverLast + 60;
      fillEnd = now;
      if(fillStart >= fillEnd - 120)
      {
         // Less than 2 min gap -- backfill is complete
         return true;
      }
      Print(EA_NAME + ": Phase 2 - Filling forward for ", symbol,
            ": ", TimeToString(fillStart, TIME_DATE),
            " -> ", TimeToString(fillEnd, TIME_DATE));
   }
   else
   {
      // No data on server at all -- full backfill
      fillStart = targetStart;
      fillEnd = now;
      Print(EA_NAME + ": Full backfill for ", symbol,
            ": ", TimeToString(fillStart, TIME_DATE),
            " -> ", TimeToString(fillEnd, TIME_DATE));
   }

   datetime batchStart = fillStart;
   int stallCount = 0;
   int windowSec = g_batchSize * 60;

   while(batchStart < fillEnd)
   {
      datetime batchEnd = batchStart + (datetime)windowSec;
      if(batchEnd > fillEnd) batchEnd = fillEnd;

      MqlRates rates[];
      int copied = CopyRates(symbol, PERIOD_M1, batchEnd, g_batchSize, rates);

      if(copied <= 0)
      {
         int err = GetLastError();
         if(err == 4401 || err == 0 || err == 4400)
         {
            Print(EA_NAME + ": No data for ", symbol, " at ",
                  TimeToString(batchEnd, TIME_DATE),
                  " (err=", err, "), skipping window");
            batchStart = batchEnd + 60;
            stallCount++;
            if(stallCount > 30)
            {
               Print(EA_NAME + ": Too many empty gaps for ", symbol,
                     ", retry next tick");
               return false;
            }
            Sleep(500);
            continue;
         }
         Print(EA_NAME + ": CopyRates error ", err, " for ", symbol);
         return false;
      }

      // Filter: only keep bars >= batchStart and <= fillEnd
      int validIdx = -1;
      for(int r = 0; r < copied; r++)
      {
         if(rates[r].time >= batchStart) { validIdx = r; break; }
      }

      if(validIdx < 0)
      {
         Print(EA_NAME + ": All bars before target for ", symbol,
               ", skipping past ", TimeToString(batchEnd, TIME_DATE));
         batchStart = batchEnd + 60;
         stallCount++;
         if(stallCount > 30) return false;
         continue;
      }

      stallCount = 0;

      // Also trim bars past fillEnd
      int lastValid = copied - 1;
      for(int r = validIdx; r < copied; r++)
      {
         if(rates[r].time > fillEnd) { lastValid = r - 1; break; }
      }

      int pushCount = lastValid - validIdx + 1;
      if(pushCount <= 0)
      {
         batchStart = batchEnd + 60;
         continue;
      }

      MqlRates pushRates[];
      ArrayResize(pushRates, pushCount);
      for(int r = 0; r < pushCount; r++)
         pushRates[r] = rates[validIdx + r];

      datetime lastBarTime = pushRates[pushCount - 1].time;

      int pushed = PushBatch(symbol, pushRates, pushCount);
      if(pushed < 0)
      {
         Print(EA_NAME + ": Push failed for ", symbol, ", retry next tick");
         return false;
      }

      g_totalBarsPushed += pushed;
      batchStart = lastBarTime + 60;

      Comment(EA_NAME + " v3.0: Backfilling ", symbol, " -- ",
              TimeToString(batchStart, TIME_DATE), " (",
              pushed, " bars, ", g_totalBarsPushed, " total)");

      Sleep(BATCH_DELAY_MS);
   }

   // After filling one phase, re-check if there's still work to do
   // (backward gap done -> may still need forward fill)
   if(serverFirst > 0 && serverFirst > targetStart + 3600 && fillEnd < now - 120)
   {
      Print(EA_NAME + ": Backward gap filled for ", symbol, ", now checking forward...");
      // Don't mark as done -- let next timer tick re-run DoBackfill
      // which will enter Phase 2
      return false;
   }

   return true;
}

//+------------------------------------------------------------------+
//| Incremental sync: push new bars since cursor                     |
//+------------------------------------------------------------------+
bool DoIncrementalSync(int symIdx, string symbol)
{
   datetime fromTime = g_lastSyncTime[symIdx];
   datetime nowTs = NowServerTime();
   if(fromTime == 0)
   {
      fromTime = nowTs - 3600;
   }

   // Get the most recent bars, then filter to only after cursor
   MqlRates rates[];
   int copied = CopyRates(symbol, PERIOD_M1, nowTs, g_batchSize, rates);

   if(copied <= 0) return true; // No data is not an error

   // Exclude the currently forming bar (not yet closed � open time == current minute start)
   datetime currentMinute = nowTs - (nowTs % 60);

   // Find first bar strictly after cursor AND before the current (forming) bar
   int validIdx = -1;
   for(int r = 0; r < copied; r++)
   {
      if(rates[r].time > fromTime && rates[r].time < currentMinute) { validIdx = r; break; }
   }
   if(validIdx < 0) return true; // No new closed bars

   // Count only fully closed bars (stop before current minute)
   int pushCount = 0;
   for(int r = validIdx; r < copied; r++)
   {
      if(rates[r].time >= currentMinute) break;
      pushCount++;
   }
   if(pushCount == 0) return true;

   MqlRates pushRates[];
   ArrayResize(pushRates, pushCount);
   for(int r = 0; r < pushCount; r++)
      pushRates[r] = rates[validIdx + r];

   int pushed = PushBatch(symbol, pushRates, pushCount);
   if(pushed >= 0)
   {
      if(pushed > 0)
         g_totalBarsPushed += pushed;
      g_lastSyncTime[symIdx] = pushRates[pushCount - 1].time;
      return true;
   }
   return false; // negative = push error
}

//+------------------------------------------------------------------+
//| Push a batch of rates to the server                              |
//+------------------------------------------------------------------+
int PushBatch(string symbol, MqlRates &rates[], int count)
{
   if(count <= 0) return 0;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 5; // safe fallback

   // Calculate broker time offset (broker time - UTC time)
   // This offset is stable for the duration of the EA session.
   // Positive offset = broker ahead of UTC (e.g., GMT+2 = +7200s)
   long brokerOffsetSec = (long)(NowServerTime() - TimeGMT());

   string json = "{";
   json += "\"schemaVersion\":\"" + SCHEMA_VERSION + "\",";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"timeframe\":\"M1\",";
   json += "\"source\":{";
   json += "\"broker\":\"" + AccountInfoString(ACCOUNT_COMPANY) + "\",";
   json += "\"accountType\":\"" + (AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO ? "demo" : "live") + "\",";
   json += "\"digits\":" + IntegerToString(digits);
   json += "},";
   json += "\"bars\":[";

   int sentCount = 0;

   for(int i = 0; i < count; i++)
   {
      // Source hardening: skip phantom forward-filled candles.
      if((long)rates[i].tick_volume <= 0)
         continue;

      if(sentCount > 0) json += ",";
      // Convert broker time ? UTC time by subtracting offset
      datetime utcTime = rates[i].time - brokerOffsetSec;
      long epochMs = (long)utcTime * 1000;

      json += "{";
      json += "\"ts\":" + IntegerToString(epochMs) + ",";
      json += "\"o\":" + DoubleToString(rates[i].open, digits) + ",";
      json += "\"h\":" + DoubleToString(rates[i].high, digits) + ",";
      json += "\"l\":" + DoubleToString(rates[i].low, digits) + ",";
      json += "\"c\":" + DoubleToString(rates[i].close, digits) + ",";
      json += "\"tickVol\":" + IntegerToString(rates[i].tick_volume) + ",";
      json += "\"spread\":" + IntegerToString(rates[i].spread);
      json += "}";
      sentCount++;
   }

   if(sentCount <= 0)
      return 0;

   json += "]}";

   string url = InpServerUrl + "/api/ingest/mt5/bars";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int retries = 0;
   int httpCode = -1;

   while(retries < MAX_RETRIES)
   {
      httpCode = WebRequest("POST", url, headers, 30000, postData, resultData, resultHeaders);
      if(httpCode == 200) break;

      retries++;
      if(retries < MAX_RETRIES)
      {
         // Exponential backoff: 2s, 4s, 8s -- gives rate-limit bucket time to refill
         int delayMs = RETRY_DELAY_BASE_MS * (int)MathPow(2, retries - 1);
         Print(EA_NAME + ": HTTP ", httpCode, " for ", symbol,
               ", retry ", retries, "/", MAX_RETRIES,
               " (wait ", delayMs, "ms)");
         Sleep(delayMs);
      }
   }

   if(httpCode == -1)
   {
      int err = GetLastError();
      Print(EA_NAME + ": WebRequest failed with error ", err);
      return -1;
   }

   if(httpCode != 200)
   {
      string body = CharArrayToString(resultData);
      Print(EA_NAME + ": Server HTTP ", httpCode, ": ", SafeBodySnippet(body));
      return -1;
   }

   string body = CharArrayToString(resultData);
   long accepted = ExtractJsonLong(body, "barsAccepted");
   return (int)accepted;
}

//+------------------------------------------------------------------+
//| Safe response body snippet for logging (strips HTML pages)      |
//+------------------------------------------------------------------+
string SafeBodySnippet(const string body)
{
   string trimmed = body;
   StringTrimLeft(trimmed);
   // If the response looks like HTML, don't flood the log with markup
   if(StringFind(trimmed, "<") == 0)
      return "[HTML response, " + IntegerToString(StringLen(body)) + " bytes]";
   return StringSubstr(trimmed, 0, 200);
}

//+------------------------------------------------------------------+
//| Simple JSON long value extractor                                 |
//+------------------------------------------------------------------+
long ExtractJsonLong(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return 0;

   int valueStart = pos + StringLen(searchKey);
   string rest = StringSubstr(json, valueStart, 30);
   StringTrimLeft(rest);

   if(StringFind(rest, "null") == 0) return 0;

   string numStr = "";
   for(int i = 0; i < StringLen(rest); i++)
   {
      ushort ch = StringGetCharacter(rest, i);
      if((ch >= '0' && ch <= '9') || (ch == '-' && i == 0))
         numStr += CharToString((uchar)ch);
      else
         break;
   }

   if(StringLen(numStr) == 0) return 0;
   return StringToInteger(numStr);
}

//+------------------------------------------------------------------+
//| Extract boolean from JSON: "key":true or "key":false             |
//+------------------------------------------------------------------+
bool ExtractJsonBool(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return false;

   int valueStart = pos + StringLen(searchKey);
   string rest = StringSubstr(json, valueStart, 10);
   StringTrimLeft(rest);

   return (StringFind(rest, "true") == 0);
}

//+------------------------------------------------------------------+
//| Extract string value from JSON: "key":"value"                    |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string searchKey = "\"" + key + "\":\"";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return "";

   int valueStart = pos + StringLen(searchKey);
   int valueEnd = StringFind(json, "\"", valueStart);
   if(valueEnd < 0) return "";

   return StringSubstr(json, valueStart, valueEnd - valueStart);
}

//+------------------------------------------------------------------+
//| Extract double value from JSON: "key":1.23456                    |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return 0.0;

   int valueStart = pos + StringLen(searchKey);
   string rest = StringSubstr(json, valueStart, 30);
   StringTrimLeft(rest);

   if(StringFind(rest, "null") == 0) return 0.0;

   string numStr = "";
   for(int i = 0; i < StringLen(rest); i++)
   {
      ushort ch = StringGetCharacter(rest, i);
      if((ch >= '0' && ch <= '9') || ch == '.' || (ch == '-' && i == 0))
         numStr += CharToString((uchar)ch);
      else
         break;
   }

   if(StringLen(numStr) == 0) return 0.0;
   return StringToDouble(numStr);
}

//+------------------------------------------------------------------+
//| EXECUTION MODULE v1                                              |
//| ================================================================ |
//| Polls GET /api/mt5/signals for PENDING signals, executes them    |
//| via OrderSend, reports results via POST /api/mt5/fills and       |
//| POST /api/mt5/closes. Same API key + auth as bar ingestion.      |
//|                                                                  |
//| Safety: EXEC_MAGIC number tags all orders; only monitors its own |
//| trades. Fixed lot size from signal (server-controlled = 0.01).   |
//| InpExecEnabled must be true, otherwise entire module is no-op.   |
//+------------------------------------------------------------------+

//+------------------------------------------------------------------+
//| Poll server for PENDING signals and execute each one             |
//+------------------------------------------------------------------+
void PollAndExecuteSignals()
{
   string url = InpServerUrl + "/api/mt5/signals";
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;

   int httpCode = WebRequest("GET", url, headers, 15000, post, result, resultHeaders);

   if(httpCode != 200)
   {
      if(httpCode == -1)
      {
         int err = GetLastError();
         if(err != 0)
            Print(EA_NAME + " [exec]: Signal poll WebRequest error ", err);
      }
      else
      {
         Print(EA_NAME + " [exec]: Signal poll HTTP ", httpCode);
      }
      return;
   }

   string body = CharArrayToString(result);

   // -- Server-authoritative mode: override EA local paper setting --
   string serverMode = ExtractJsonString(body, "mode");
   bool serverPaper = (serverMode == "paper");
   bool serverLive  = (serverMode == "live");
   // If server says "paper", force paper mode regardless of EA input
   // If server says "live", override EA default to allow real execution
   bool effectivePaper = serverPaper ? true : (serverLive ? false : g_execPaperMode);

   // Quick check: if count is 0, nothing to do
   long count = ExtractJsonLong(body, "count");
   if(count <= 0) return;

   Print(EA_NAME + " [exec]: Received ", count, " signal(s)");

   // Parse signals array: find "signals":[ and iterate objects
   int arrStart = StringFind(body, "\"signals\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   // Split into individual signal objects by finding { ... }
   int searchPos = arrStart;
   for(int s = 0; s < (int)count && s < MAX_TRACKED; s++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;

      string sigJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      // Extract signal fields
      string signalId  = ExtractJsonString(sigJson, "signalId");
      string symbol    = ExtractJsonString(sigJson, "symbol");
      string side      = ExtractJsonString(sigJson, "side");
      double entry     = ExtractJsonDouble(sigJson, "entryPrice");
      double sl        = ExtractJsonDouble(sigJson, "stopLoss");
      double tp        = ExtractJsonDouble(sigJson, "takeProfit");
      double lots      = ExtractJsonDouble(sigJson, "lotSize");
      string entryType = ExtractJsonString(sigJson, "entryType");
      double expiresInSec = ExtractJsonDouble(sigJson, "expiresInSeconds");
      double entryZonePips = ExtractJsonDouble(sigJson, "entryZonePips"); // 0 = no zone check

      if(StringLen(signalId) == 0 || StringLen(symbol) == 0)
      {
         Print(EA_NAME + " [exec]: Skipping malformed signal");
         continue;
      }

      g_totalSignalsReceived++;

      // -- Client-side TTL check: server sends remaining seconds --
      // No timezone conversion needed.
      if(expiresInSec > 0 && expiresInSec < 5)
      {
         Print(EA_NAME + " [exec]: TTL EXPIRED � signal ", signalId,
               " (", DoubleToString(expiresInSec, 0), "s remaining). Rejecting.");
         ReportFillOrReject(signalId, 0, 0.0, false, "TTL_EXPIRED_CLIENT_SIDE");
         g_totalOrdersRejected++;
         continue;
      }

      // Map server symbol ("EURUSD") to broker symbol ("EURUSDm")
      string brokerSym = FindBrokerSymbol(symbol);
      if(StringLen(brokerSym) == 0)
      {
         Print(EA_NAME + " [exec]: Symbol '", symbol, "' not found in Market Watch, rejecting signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false, "Symbol not found in Market Watch");
         g_totalOrdersRejected++;
         continue;
      }

      string sideDisplay = side;
      StringToUpper(sideDisplay);
      Print(EA_NAME + " [exec]: Executing signal ", signalId,
            " � ", sideDisplay, " ", brokerSym,
            " @ ", DoubleToString(entry, 5),
            " SL=", DoubleToString(sl, 5),
            " TP=", DoubleToString(tp, 5),
            " lots=", DoubleToString(lots, 2),
            " zone=", (entryZonePips > 0 ? DoubleToString(entryZonePips, 1) + "p" : "none"));

      ExecuteSignal(signalId, brokerSym, side, entry, sl, tp, lots, entryType, effectivePaper, entryZonePips);
   }
}

//+------------------------------------------------------------------+
//| Execute a single trade signal via OrderSend                      |
//+------------------------------------------------------------------+
void ExecuteSignal(
   string signalId,
   string brokerSym,
   string side,
   double entry,
   double sl,
   double tp,
   double lots,
   string entryType,
   bool   paperMode,
   double entryZonePips = 0.0)
{
   // Validate lot size
   double minLot = SymbolInfoDouble(brokerSym, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(brokerSym, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(brokerSym, SYMBOL_VOLUME_STEP);

   if(lots < minLot) lots = minLot;
   if(lots > maxLot) lots = maxLot;
   // Round to lot step
   lots = MathFloor(lots / lotStep + 0.5) * lotStep;
   lots = NormalizeDouble(lots, 2);

   // -- Spread guard (critical safety per expert spec) --
   double maxSpreadPips = ResolveExecMaxSpreadPips(brokerSym);
   if(maxSpreadPips > 0.0)
   {
      double spreadPoints = (double)SymbolInfoInteger(brokerSym, SYMBOL_SPREAD);
      double point = SymbolInfoDouble(brokerSym, SYMBOL_POINT);
      int pipDigits = ((int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS) == 3 || (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS) == 5) ? 10 : 1;
      double spreadPips = (spreadPoints * point) / (point * pipDigits);
      // Simpler: spreadPips = spreadPoints / pipDigits
      spreadPips = spreadPoints / (double)pipDigits;

      if(spreadPips > maxSpreadPips)
      {
         Print(EA_NAME + " [exec]: SPREAD GUARD � ", brokerSym,
               " spread=", DoubleToString(spreadPips, 1), " pips > max=",
            DoubleToString(maxSpreadPips, 1),
               " pips. Rejecting signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false,
         "Spread guard: " + DoubleToString(spreadPips, 1) + " pips > " + DoubleToString(maxSpreadPips, 1) + " max");
         g_totalSpreadRejected++;
         g_totalOrdersRejected++;
         return;
      }
   }

   // -- Entry zone guard: reject if live price drifted outside acceptable zone --
   // entryZonePips = 0 means no zone check (backward-compatible)
   if(entryZonePips > 0.0)
   {
      double liveAsk = SymbolInfoDouble(brokerSym, SYMBOL_ASK);
      double liveBid = SymbolInfoDouble(brokerSym, SYMBOL_BID);
      double liveCheck = (side == "buy") ? liveAsk : liveBid;
      double point = SymbolInfoDouble(brokerSym, SYMBOL_POINT);
      int pipDigitsZone = ((int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS) == 3 || (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS) == 5) ? 10 : 1;
      double zoneDist = entryZonePips * point * pipDigitsZone;
      double drift = MathAbs(liveCheck - entry);

      if(drift > zoneDist)
      {
         double driftPips = drift / (point * pipDigitsZone);
         Print(EA_NAME + " [exec]: ENTRY ZONE REJECT � ", brokerSym,
               " live=", DoubleToString(liveCheck, (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS)),
               " entry=", DoubleToString(entry, (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS)),
               " drift=", DoubleToString(driftPips, 1), " pips > zone=",
               DoubleToString(entryZonePips, 1), " pips. Signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false,
            "Entry zone: drift " + DoubleToString(driftPips, 1) + " pips > " + DoubleToString(entryZonePips, 1) + " zone");
         g_totalOrdersRejected++;
         return;
      }
      else
      {
         double driftPips = drift / (point * pipDigitsZone);
         Print(EA_NAME + " [exec]: Entry zone OK � drift=",
               DoubleToString(driftPips, 1), " pips <= zone=",
               DoubleToString(entryZonePips, 1), " pips");
      }
   }

   // Determine order type
   ENUM_ORDER_TYPE orderType;
   bool isLimit = (entryType == "limit");
   bool isStop  = (entryType == "stop");
   bool isPending = isLimit || isStop;

   if(isPending)
   {
      // Pending order: limit or stop
      if(side == "buy")
         orderType = isLimit ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_BUY_STOP;
      else if(side == "sell")
         orderType = isLimit ? ORDER_TYPE_SELL_LIMIT : ORDER_TYPE_SELL_STOP;
      else
      {
         Print(EA_NAME + " [exec]: Invalid side '", side, "' for signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false, "Invalid side: " + side);
         g_totalOrdersRejected++;
         return;
      }
   }
   else
   {
      // Market order (default / entryType == "market")
      if(side == "buy")
         orderType = ORDER_TYPE_BUY;
      else if(side == "sell")
         orderType = ORDER_TYPE_SELL;
      else
      {
         Print(EA_NAME + " [exec]: Invalid side '", side, "' for signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false, "Invalid side: " + side);
         g_totalOrdersRejected++;
         return;
      }
   }

   // Normalize prices to symbol digits
   int digits = (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);
   if(isPending) entry = NormalizeDouble(entry, digits);

   // Build order request
   MqlTradeRequest request;
   MqlTradeResult  tradeResult;
   ZeroMemory(request);
   ZeroMemory(tradeResult);

   if(isPending)
   {
      request.action    = TRADE_ACTION_PENDING;  // Pending order
      request.price     = entry;                  // Pending order price
   }
   else
   {
      request.action    = TRADE_ACTION_DEAL;      // Market execution
      request.deviation = g_execSlippage;
      // CRITICAL: MT5 requires request.price for TRADE_ACTION_DEAL
      // Buy → Ask price, Sell → Bid price. Without this → error 10015.
      if(side == "buy")
         request.price = SymbolInfoDouble(brokerSym, SYMBOL_ASK);
      else
         request.price = SymbolInfoDouble(brokerSym, SYMBOL_BID);
   }

   request.symbol    = brokerSym;
   request.volume    = lots;
   request.type      = orderType;
   request.sl        = sl;
   request.tp        = tp;
   request.magic     = EXEC_MAGIC;
   request.comment   = g_execComment + "_" + StringSubstr(signalId, 0, 8);
   request.type_filling = ORDER_FILLING_IOC;  // Most common; falls back below
   if(isPending) request.type_time = ORDER_TIME_GTC;  // Good till cancelled

   // -- Paper mode: log but don't execute --
   if(paperMode)
   {
      Print(EA_NAME + " [PAPER]: Would execute ", StringToUpper(side), " ", brokerSym,
            " lots=", DoubleToString(lots, 2),
            " SL=", DoubleToString(sl, digits),
            " TP=", DoubleToString(tp, digits),
            " type=", entryType,
            " signal=", signalId);
      // Report as filled with paper price so server tracks intent lifecycle
      double paperPrice = (side == "buy") ? SymbolInfoDouble(brokerSym, SYMBOL_ASK)
                                           : SymbolInfoDouble(brokerSym, SYMBOL_BID);
      g_totalPaperLogged++;
      ReportFillOrReject(signalId, 0, paperPrice, true, "");
      return;
   }

   // Try IOC first, then FOK
   if(!OrderSend(request, tradeResult))
   {
      // If fill policy rejected, try FOK
      if(tradeResult.retcode == TRADE_RETCODE_INVALID_FILL)
      {
         request.type_filling = ORDER_FILLING_FOK;
         ZeroMemory(tradeResult);
         bool fokOk = OrderSend(request, tradeResult);
         if(!fokOk)
            Print(EA_NAME + " [exec]: FOK fallback also failed � retcode=", tradeResult.retcode);
      }
   }

   // Evaluate result
   if(tradeResult.retcode == TRADE_RETCODE_DONE || tradeResult.retcode == TRADE_RETCODE_PLACED)
   {
      long ticket = (long)tradeResult.deal;
      if(ticket == 0) ticket = (long)tradeResult.order;  // fallback to order ID
      double fillPrice = tradeResult.price;

      if(isLimit)
      {
         // Limit order placed � report as SENT (pending fill).
         // The order will fill later; position monitor will detect the fill.
         Print(EA_NAME + " [exec]: LIMIT PLACED � order=", ticket,
               " price=", DoubleToString(entry, digits),
               " signal=", signalId);

         // Track the pending order for later fill detection
         if(g_trackedCount < MAX_TRACKED)
         {
            g_trackedSignalId[g_trackedCount] = signalId;
            g_trackedTicket[g_trackedCount] = ticket;
            g_trackedCount++;
         }

         g_totalOrdersFilled++;
         // Report with entry price as fill price (will update on actual fill)
         ReportFillOrReject(signalId, ticket, entry, true, "");
      }
      else
      {
         // For market fills, resolve the POSITION_IDENTIFIER from the deal.
         // tradeResult.deal is the deal ticket, but MonitorOpenPositions
         // iterates PositionGetTicket() which returns the position ticket.
         // We must track the position identifier, not the deal ticket.
         long posId = ticket;  // fallback to deal ticket
         if(tradeResult.deal > 0)
         {
            // Look up position ID from deal history
            HistorySelect(TimeCurrent() - 60, TimeCurrent() + 60);
            long dealPosId = (long)HistoryDealGetInteger(tradeResult.deal, DEAL_POSITION_ID);
            if(dealPosId > 0)
            {
               posId = dealPosId;
               Print(EA_NAME + " [exec]: Resolved position ID ", posId,
                     " from deal ", tradeResult.deal);
            }
         }

         Print(EA_NAME + " [exec]: FILLED � deal=", ticket,
               " posId=", posId,
               " fillPrice=", DoubleToString(fillPrice, digits),
               " signal=", signalId);

         // Track this position by POSITION ID (not deal ticket)
         if(g_trackedCount < MAX_TRACKED)
         {
            g_trackedSignalId[g_trackedCount] = signalId;
            g_trackedTicket[g_trackedCount] = posId;
            g_trackedCount++;
         }

         g_totalOrdersFilled++;
         ReportFillOrReject(signalId, posId, fillPrice, true, "");
      }
   }
   else
   {
      string retMsg = IntegerToString(tradeResult.retcode);
      if(StringLen(tradeResult.comment) > 0)
         retMsg += " " + tradeResult.comment;

      Print(EA_NAME + " [exec]: REJECTED � retcode=", tradeResult.retcode,
            " comment=", tradeResult.comment,
            " signal=", signalId);

      g_totalOrdersRejected++;
      ReportFillOrReject(signalId, 0, 0.0, false, retMsg);
   }
}

//+------------------------------------------------------------------+
//| Report fill or rejection to POST /api/mt5/fills                  |
//+------------------------------------------------------------------+
void ReportFillOrReject(
   string signalId,
   long   mt5Ticket,
   double fillPrice,
   bool   isFilled,
   string rejectReason)
{
   string json = "{";
   json += "\"signalId\":\"" + signalId + "\",";
   json += "\"mt5Ticket\":" + IntegerToString(mt5Ticket) + ",";
   json += "\"fillPrice\":" + DoubleToString(fillPrice, 5) + ",";

   if(isFilled)
      json += "\"status\":\"filled\"";
   else
      json += "\"status\":\"rejected\",\"rejectReason\":\"" + rejectReason + "\"";

   json += "}";

   string url = InpServerUrl + "/api/mt5/fills";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 15000, postData, resultData, resultHeaders);

   if(httpCode != 200)
   {
      Print(EA_NAME + " [exec]: Fill report HTTP ", httpCode,
            " for signal ", signalId);
   }
}

//+------------------------------------------------------------------+
//| Monitor tracked positions -- detect closes and report            |
//+------------------------------------------------------------------+
void MonitorOpenPositions()
{
   if(g_trackedCount == 0) return;

   // Iterate tracked signals in reverse (allows removal during loop)
   for(int i = g_trackedCount - 1; i >= 0; i--)
   {
      long ticket = g_trackedTicket[i];
      string signalId = g_trackedSignalId[i];

      // Check if position is still open
      bool isOpen = false;
      for(int p = PositionsTotal() - 1; p >= 0; p--)
      {
         ulong posTicket = PositionGetTicket(p);
         if(posTicket == 0) continue;

         // Match by magic + deal/order ticket
         if(PositionGetInteger(POSITION_MAGIC) == EXEC_MAGIC)
         {
            if((long)posTicket == ticket ||
               (long)PositionGetInteger(POSITION_IDENTIFIER) == ticket)
            {
               isOpen = true;
               break;
            }
         }
      }

      if(!isOpen)
      {
         // Position closed -- find the close details from deal history
         double closePrice = 0.0;
         double realizedPnl = 0.0;
         string closeReason = "MANUAL";  // default

         // Search recent history for the closing deal
         datetime fromTime = TimeCurrent() - 86400; // last 24h
         datetime toTime = TimeCurrent() + 60;
         HistorySelect(fromTime, toTime);

         for(int d = HistoryDealsTotal() - 1; d >= 0; d--)
         {
            ulong dealTicket = HistoryDealGetTicket(d);
            if(dealTicket == 0) continue;

            long dealPosId = (long)HistoryDealGetInteger(dealTicket, DEAL_POSITION_ID);
            long dealMagic = (long)HistoryDealGetInteger(dealTicket, DEAL_MAGIC);
            ENUM_DEAL_ENTRY dealEntry = (ENUM_DEAL_ENTRY)HistoryDealGetInteger(dealTicket, DEAL_ENTRY);

            if(dealPosId == ticket && dealEntry == DEAL_ENTRY_OUT)
            {
               closePrice = HistoryDealGetDouble(dealTicket, DEAL_PRICE);
               realizedPnl = HistoryDealGetDouble(dealTicket, DEAL_PROFIT)
                           + HistoryDealGetDouble(dealTicket, DEAL_SWAP)
                           + HistoryDealGetDouble(dealTicket, DEAL_COMMISSION);

               // Determine close reason from SL/TP
               ENUM_DEAL_REASON reason = (ENUM_DEAL_REASON)HistoryDealGetInteger(dealTicket, DEAL_REASON);
               if(reason == DEAL_REASON_TP)
                  closeReason = "TP_HIT";
               else if(reason == DEAL_REASON_SL)
                  closeReason = "SL_HIT";
               else if(reason == DEAL_REASON_SO)
                  closeReason = "MARGIN_CALL";
               else
                  closeReason = "MANUAL";

               break;
            }
         }

         Print(EA_NAME + " [exec]: Position CLOSED � ticket=", ticket,
               " reason=", closeReason,
               " closePrice=", DoubleToString(closePrice, 5),
               " pnl=", DoubleToString(realizedPnl, 2),
               " signal=", signalId);

         ReportClose(signalId, ticket, closePrice, closeReason, realizedPnl);
         g_totalPositionsClosed++;

         // Remove from tracking (swap with last)
         g_trackedSignalId[i] = g_trackedSignalId[g_trackedCount - 1];
         g_trackedTicket[i] = g_trackedTicket[g_trackedCount - 1];
         g_trackedCount--;
      }
   }
}

//+------------------------------------------------------------------+
//| Report position close to POST /api/mt5/closes                   |
//+------------------------------------------------------------------+
void ReportClose(
   string signalId,
   long   mt5Ticket,
   double closePrice,
   string closeReason,
   double realizedPnl)
{
   string json = "{";
   json += "\"signalId\":\"" + signalId + "\",";
   json += "\"mt5Ticket\":" + IntegerToString(mt5Ticket) + ",";
   json += "\"closePrice\":" + DoubleToString(closePrice, 5) + ",";
   json += "\"closeReason\":\"" + closeReason + "\",";
   json += "\"realizedPnl\":" + DoubleToString(realizedPnl, 2);
   json += "}";

   string url = InpServerUrl + "/api/mt5/closes";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 15000, postData, resultData, resultHeaders);

   if(httpCode != 200)
   {
      Print(EA_NAME + " [exec]: Close report HTTP ", httpCode,
            " for signal ", signalId);
   }
}

//+------------------------------------------------------------------+
//| Send lightweight heartbeat to server (every 30s)                 |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   // Count active errors
   int totalErrors = 0;
   for(int i = 0; i < g_symbolCount; i++)
      if(i < ArraySize(g_consecutiveErrors)) totalErrors += g_consecutiveErrors[i];

   // Account info
   double acctBalance   = AccountInfoDouble(ACCOUNT_BALANCE);
   double acctEquity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double acctMarginFree= AccountInfoDouble(ACCOUNT_MARGIN_FREE);
   long   acctLeverage  = AccountInfoInteger(ACCOUNT_LEVERAGE);
   long   acctLogin     = AccountInfoInteger(ACCOUNT_LOGIN);
   string acctServer    = AccountInfoString(ACCOUNT_SERVER);
   string acctBroker    = AccountInfoString(ACCOUNT_COMPANY);
   string acctCurrency  = AccountInfoString(ACCOUNT_CURRENCY);
   ENUM_ACCOUNT_TRADE_MODE tradeMode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string acctType = "unknown";
   if(tradeMode == ACCOUNT_TRADE_MODE_DEMO)   acctType = "demo";
   if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) acctType = "contest";
   if(tradeMode == ACCOUNT_TRADE_MODE_REAL)    acctType = "real";

   // Build JSON with account info
   string json = "{";
   json += "\"symbolsActive\":[";
   for(int i = 0; i < g_symbolCount; i++)
   {
      if(i > 0) json += ",";
      json += "\"" + g_symbols[i] + "\"";
   }
   json += "],";
   json += "\"queueDepth\":" + IntegerToString(g_symbolCount) + ",";
   json += "\"errors\":" + IntegerToString(totalErrors) + ",";
   json += "\"version\":\"4.20\",";
   json += "\"balance\":" + DoubleToString(acctBalance, 2) + ",";
   json += "\"equity\":" + DoubleToString(acctEquity, 2) + ",";
   json += "\"marginFree\":" + DoubleToString(acctMarginFree, 2) + ",";
   json += "\"leverage\":" + IntegerToString(acctLeverage) + ",";
   json += "\"accountNumber\":\"" + IntegerToString(acctLogin) + "\",";
   json += "\"brokerServer\":\"" + acctServer + "\",";
   json += "\"broker\":\"" + acctBroker + "\",";
   json += "\"accountType\":\"" + acctType + "\",";
   json += "\"currency\":\"" + acctCurrency + "\"";
   json += "}";

   string url = InpServerUrl + "/api/ingest/mt5/heartbeat";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   // Fire-and-forget with short timeout (5s) -- don't block sync
   int httpCode = WebRequest("POST", url, headers, 5000, postData, resultData, resultHeaders);
   if(httpCode != 200 && httpCode != -1)
   {
      Print(EA_NAME + ": Heartbeat HTTP ", httpCode);
   }
}

//+------------------------------------------------------------------+
//| Sync trade history (deals) to server (every 5 min)               |
//+------------------------------------------------------------------+
void SyncTradeHistory()
{
   // Select last 7 days of deal history
   datetime fromTime = TimeCurrent() - 7 * 24 * 3600;
   datetime toTime   = TimeCurrent();

   if(!HistorySelect(fromTime, toTime))
   {
      Print(EA_NAME + ": HistorySelect failed");
      return;
   }

   int totalDeals = HistoryDealsTotal();
   if(totalDeals <= 0) return;

   // Build JSON array of deals (max 500 per batch)
   int batchLimit = MathMin(totalDeals, 500);
   string json = "{\"deals\":[";
   int count = 0;

   for(int i = MathMax(0, totalDeals - batchLimit); i < totalDeals; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      string symbol   = HistoryDealGetString(ticket, DEAL_SYMBOL);
      long   dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
      long   dealEntry= HistoryDealGetInteger(ticket, DEAL_ENTRY);
      double volume   = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double price    = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double sl       = HistoryDealGetDouble(ticket, DEAL_SL);
      double tp       = HistoryDealGetDouble(ticket, DEAL_TP);
      double profit   = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double swap     = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double commission = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double fee      = HistoryDealGetDouble(ticket, DEAL_FEE);
      long   magic    = HistoryDealGetInteger(ticket, DEAL_MAGIC);
      string comment  = HistoryDealGetString(ticket, DEAL_COMMENT);
      long   orderTicket = (long)HistoryDealGetInteger(ticket, DEAL_ORDER);
      long   dealTimeMs  = (long)HistoryDealGetInteger(ticket, DEAL_TIME_MSC);

      // Map deal type to string
      string typeStr = "UNKNOWN";
      if(dealType == DEAL_TYPE_BUY)              typeStr = "BUY";
      else if(dealType == DEAL_TYPE_SELL)         typeStr = "SELL";
      else if(dealType == DEAL_TYPE_BALANCE)      typeStr = "BALANCE";
      else if(dealType == DEAL_TYPE_CREDIT)       typeStr = "CREDIT";
      else if(dealType == DEAL_TYPE_CHARGE)       typeStr = "CHARGE";
      else if(dealType == DEAL_TYPE_CORRECTION)   typeStr = "CORRECTION";
      else if(dealType == DEAL_TYPE_BONUS)        typeStr = "BONUS";
      else if(dealType == DEAL_TYPE_COMMISSION)   typeStr = "COMMISSION";

      // Map entry to string
      string entryStr = "";
      if(dealEntry == DEAL_ENTRY_IN)        entryStr = "ENTRY_IN";
      else if(dealEntry == DEAL_ENTRY_OUT)  entryStr = "ENTRY_OUT";
      else if(dealEntry == DEAL_ENTRY_INOUT) entryStr = "ENTRY_INOUT";
      else if(dealEntry == DEAL_ENTRY_OUT_BY) entryStr = "ENTRY_OUT_BY";

      // Escape comment for JSON
      StringReplace(comment, "\\", "\\\\");
      StringReplace(comment, "\"", "\\\"");

      if(count > 0) json += ",";
      json += "{";
      json += "\"ticket\":" + IntegerToString((long)ticket) + ",";
      json += "\"orderTicket\":" + IntegerToString(orderTicket) + ",";
      json += "\"symbol\":\"" + symbol + "\",";
      json += "\"type\":\"" + typeStr + "\",";
      json += "\"entry\":\"" + entryStr + "\",";
      json += "\"volume\":" + DoubleToString(volume, 4) + ",";
      json += "\"price\":" + DoubleToString(price, 6) + ",";
      json += "\"sl\":" + DoubleToString(sl, 6) + ",";
      json += "\"tp\":" + DoubleToString(tp, 6) + ",";
      json += "\"profit\":" + DoubleToString(profit, 2) + ",";
      json += "\"swap\":" + DoubleToString(swap, 2) + ",";
      json += "\"commission\":" + DoubleToString(commission, 2) + ",";
      json += "\"fee\":" + DoubleToString(fee, 2) + ",";
      json += "\"magic\":" + IntegerToString(magic) + ",";
      json += "\"comment\":\"" + comment + "\",";
      json += "\"timeMs\":" + IntegerToString(dealTimeMs);
      json += "}";
      count++;
   }

   json += "]}";

   if(count == 0) return;

   // POST to server
   string url = InpServerUrl + "/api/mt5/trades";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 15000, postData, resultData, resultHeaders);
   if(httpCode == 200)
   {
      g_totalTradesSynced += count;
      Print(EA_NAME + ": Trade history synced ", count, " deals (total: ", g_totalTradesSynced, ")");
   }
   else
   {
      Print(EA_NAME + ": Trade sync failed HTTP ", httpCode);
   }
}

//+------------------------------------------------------------------+
//| Poll work queue for server-driven commands                       |
//+------------------------------------------------------------------+
void PollWorkQueue()
{
   string url = InpServerUrl + "/api/ingest/mt5/work?limit=3";
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;

   int httpCode = WebRequest("GET", url, headers, 10000, post, result, resultHeaders);

   if(httpCode != 200)
   {
      if(httpCode == -1)
      {
         int err = GetLastError();
         if(err != 0) Print(EA_NAME + ": Work queue poll error ", err);
      }
      return;
   }

   string body = CharArrayToString(result);
   long count = ExtractJsonLong(body, "count");
   if(count <= 0) return;

   Print(EA_NAME + ": Work queue returned ", count, " command(s)");

   // Parse commands array
   int arrStart = StringFind(body, "\"commands\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   int searchPos = arrStart;
   for(int c = 0; c < (int)count && c < 5; c++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;

      // Find matching closing brace (handle nested objects)
      int depth = 0;
      int objEnd = -1;
      for(int p = objStart; p < StringLen(body); p++)
      {
         ushort ch = StringGetCharacter(body, p);
         if(ch == '{') depth++;
         else if(ch == '}') { depth--; if(depth == 0) { objEnd = p; break; } }
      }
      if(objEnd < 0) break;

      string cmdJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      string cmdId   = ExtractJsonString(cmdJson, "id");
      string cmdSym  = ExtractJsonString(cmdJson, "symbol");
      string cmdType = ExtractJsonString(cmdJson, "commandType");

      if(StringLen(cmdId) == 0 || StringLen(cmdSym) == 0) continue;

      Print(EA_NAME + ": Executing work command: ", cmdType, " ", cmdSym, " (", cmdId, ")");

      bool success = false;
      int barsResult = 0;

      if(cmdType == "INCREMENTAL")
      {
         // Find symbol index for incremental sync
         string brokerSym = FindBrokerSymbol(cmdSym);
         if(StringLen(brokerSym) > 0)
         {
            int idx = -1;
            for(int i = 0; i < g_symbolCount; i++)
               if(g_symbols[i] == brokerSym) { idx = i; break; }

            if(idx >= 0)
            {
               success = DoIncrementalSync(idx, brokerSym);
            }
            else
            {
               // Symbol not in our list but server wants it � do a standalone push
               MqlRates rates[];
               int copied = CopyRates(brokerSym, PERIOD_M1, NowServerTime(), g_batchSize, rates);
               if(copied > 0)
               {
                  barsResult = PushBatch(brokerSym, rates, copied);
                  success = (barsResult >= 0);
                  g_totalBarsPushed += MathMax(barsResult, 0);
               }
               else
                  success = true; // No data available is not an error
            }
         }
      }
      else if(cmdType == "BACKFILL")
      {
         string brokerSym = FindBrokerSymbol(cmdSym);
         if(StringLen(brokerSym) > 0)
         {
            int idx = -1;
            for(int i = 0; i < g_symbolCount; i++)
               if(g_symbols[i] == brokerSym) { idx = i; break; }

            if(idx >= 0)
            {
               g_backfillDone[idx] = false;
               g_lastSyncTime[idx] = 0;
               g_serverFirstMs[idx] = 0;
               g_consecutiveErrors[idx] = 0;
               success = DoBackfill(idx, brokerSym);
               if(success) g_backfillDone[idx] = true;
            }
         }
      }
      else if(cmdType == "GAP_REPAIR")
      {
         // Gap repair = targeted backfill for specific time range
         string brokerSym = FindBrokerSymbol(cmdSym);
         if(StringLen(brokerSym) > 0)
         {
            int idx = -1;
            for(int i = 0; i < g_symbolCount; i++)
               if(g_symbols[i] == brokerSym) { idx = i; break; }

            if(idx >= 0)
            {
               // Reset cursor to force re-backfill
               g_backfillDone[idx] = false;
               g_serverFirstMs[idx] = 0;
               g_consecutiveErrors[idx] = 0;
               success = DoBackfill(idx, brokerSym);
               if(success) g_backfillDone[idx] = true;
            }
         }
      }
      else if(cmdType == "PAUSE_SYMBOL" || cmdType == "RESUME_SYMBOL")
      {
         // These are informational � config poll handles actual symbol list changes
         success = true;
      }

      // Report result back to server
      ReportWorkResult(cmdId, success, barsResult);
   }
}

//+------------------------------------------------------------------+
//| Report work command completion/failure to server                 |
//+------------------------------------------------------------------+
void ReportWorkResult(string cmdId, bool success, int barsResult)
{
   string action = success ? "complete" : "fail";
   string json = "{";
   json += "\"action\":\"" + action + "\",";
   if(!success)
      json += "\"error\":\"Push failed\",";
   json += "\"result\":{\"barsAccepted\":" + IntegerToString(MathMax(barsResult, 0)) + "}";
   json += "}";

   string url = InpServerUrl + "/api/ingest/mt5/work/" + cmdId;
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 10000, postData, resultData, resultHeaders);

   if(success) g_totalWorkCompleted++;
   else g_totalWorkFailed++;

   if(httpCode != 200)
   {
      if(httpCode != -1)
         Print(EA_NAME + ": Work report HTTP ", httpCode, " for command ", cmdId);
   }
}

//+------------------------------------------------------------------+
//| Update chart comment with live status                            |
//+------------------------------------------------------------------+
void UpdateStatusComment()
{
   string txt = EA_NAME + " v4.1";
   if(g_paused) txt += " [PAUSED]";
   if(ModeSyncEnabled() && !ModeExecEnabled()) txt += " [SYNC-ONLY]";
   if(!ModeSyncEnabled() && ModeExecEnabled()) txt += " [EXEC-ONLY]";
   txt += "\n";
   txt += "Server: " + InpServerUrl + "\n";
   txt += "Config: " + IntegerToString(g_backfillDays) + "d backfill, "
          + IntegerToString(g_syncIntervalSec) + "s interval\n";
   txt += "Total bars pushed: " + IntegerToString(g_totalBarsPushed) + "\n";
   if(ModeExecEnabled())
      txt += "Work queue: " + IntegerToString(g_totalWorkCompleted) + " done, "
             + IntegerToString(g_totalWorkFailed) + " failed\n";

   if(g_execEnabled)
   {
      string mode = g_execPaperMode ? "[PAPER] " : "";
      txt += "Exec " + mode + ": " + IntegerToString(g_totalSignalsReceived) + " recv, "
             + IntegerToString(g_totalOrdersFilled) + " filled, "
             + IntegerToString(g_totalPaperLogged) + " paper, "
             + IntegerToString(g_totalOrdersRejected) + " rejected ("
             + IntegerToString(g_totalSpreadRejected) + " spread), "
             + IntegerToString(g_totalPositionsClosed) + " closed | "
             + IntegerToString(g_trackedCount) + " open\n";
   }
   else
   {
      txt += "Exec: DISABLED\n";
   }
   txt += "\n";

   if(ModeSyncEnabled())
   {
      for(int i = 0; i < g_symbolCount; i++)
      {
         txt += g_symbols[i] + ": ";
         if(i < ArraySize(g_consecutiveErrors) && g_consecutiveErrors[i] >= MAX_SYMBOL_ERRORS)
            txt += "SKIPPED (errors)";
         else if(!g_backfillDone[i])
            txt += "Backfilling...";
         else if(g_lastSyncTime[i] > 0)
            txt += "Synced to " + TimeToString(g_lastSyncTime[i], TIME_DATE | TIME_MINUTES);
         else
            txt += "Waiting...";
         txt += "\n";
      }
   }

   Comment(txt);
}

//+------------------------------------------------------------------+
//| Tick event -- fast signal polling (throttled to g_execPollSec)    |
//| Ticks fire every fraction of a second on active pairs. We use    |
//| them as a fast clock for signal polling so the EA can react in   |
//| 1-5 seconds instead of waiting for the 60s bar-sync timer.       |
//+------------------------------------------------------------------+
void OnTick()
{
   // -- Live bar push: all backfilled symbols, fires on every tick (throttled to InpLiveSyncSec) --
   // This is the primary live ingestion path. Candle-close latency = time to next tick after close.
   if(ModeSyncEnabled())
      DoLiveSyncPass();

   // -- Execution poll (signal -> order) --
   if(!ModeExecEnabled() || !g_execEnabled || g_paused) return;

   datetime now = NowServerTime();
   if(now - g_lastExecPoll < g_execPollSec) return;
   g_lastExecPoll = now;

   PollAndExecuteSignals();
   PollAndExecuteCommands();
}

//+------------------------------------------------------------------+
//| Push closed 1m bars for all backfilled symbols (no Sleep between) |
//| Throttled to InpLiveSyncSec. Called from both OnTick and OnTimer.  |
//+------------------------------------------------------------------+
void DoLiveSyncPass()
{
   if(!ModeSyncEnabled()) return;

   datetime now = NowServerTime();
   if(now - g_lastLiveSyncCheck < InpLiveSyncSec) return;
   g_lastLiveSyncCheck = now;

   for(int i = 0; i < g_symbolCount; i++)
   {
      if(!g_backfillDone[i]) continue;
      if(g_consecutiveErrors[i] >= MAX_SYMBOL_ERRORS) continue;

      bool ok = DoIncrementalSync(i, g_symbols[i]);
      if(ok)
         g_consecutiveErrors[i] = 0;
      else
         g_consecutiveErrors[i]++;
      // No Sleep here � sequential but fast (1-2 bars each, ~50-100ms/symbol)
   }
}

//+------------------------------------------------------------------+
//| Poll server for PENDING commands (MODIFY_SL, CLOSE_POSITION)     |
//| from trailing stop engine. Runs on every tick (throttled).        |
//+------------------------------------------------------------------+
void PollAndExecuteCommands()
{
   string url = InpServerUrl + "/api/mt5/commands";
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;

   int httpCode = WebRequest("GET", url, headers, 10000, post, result, resultHeaders);

   if(httpCode != 200)
   {
      if(httpCode == -1)
      {
         int err = GetLastError();
         if(err != 0)
            Print(EA_NAME + " [cmd]: Command poll WebRequest error ", err);
      }
      return;
   }

   string body = CharArrayToString(result);

   long count = ExtractJsonLong(body, "count");
   if(count <= 0) return;

   Print(EA_NAME + " [cmd]: Received ", count, " command(s)");

   // Parse commands array
   int arrStart = StringFind(body, "\"commands\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   int searchPos = arrStart;
   for(int s = 0; s < (int)count && s < 20; s++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;

      string cmdJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      string commandId   = ExtractJsonString(cmdJson, "commandId");
      long   mt5Ticket   = ExtractJsonLong(cmdJson, "mt5Ticket");
      string symbol      = ExtractJsonString(cmdJson, "symbol");
      string commandType = ExtractJsonString(cmdJson, "commandType");
      double newSl       = ExtractJsonDouble(cmdJson, "newSl");
      double newTp       = ExtractJsonDouble(cmdJson, "newTp");
      string closeReason = ExtractJsonString(cmdJson, "closeReason");
      double closeLots   = ExtractJsonDouble(cmdJson, "closeLots");

      if(StringLen(commandId) == 0 || mt5Ticket == 0)
      {
         Print(EA_NAME + " [cmd]: Skipping malformed command");
         continue;
      }

      string brokerSym = FindBrokerSymbol(symbol);
      if(StringLen(brokerSym) == 0) brokerSym = symbol;

      bool success = false;
      string failReason = "";

      if(commandType == "MODIFY_SL")
      {
         g_lastModifyRetcode = 0;
         int errBefore = GetLastError(); // clear error state
         success = ModifyPositionSL(mt5Ticket, brokerSym, newSl, newTp);
         int errAfter = GetLastError();
         if(!success)
         {
            if(g_lastModifyRetcode == -1)
               failReason = "Cannot select ticket=" + IntegerToString(mt5Ticket) + " (position closed?) err=" + IntegerToString(errAfter);
            else
               failReason = "PositionModify retcode=" + IntegerToString(g_lastModifyRetcode) + " err=" + IntegerToString(errAfter)
                  + " ticket=" + IntegerToString(mt5Ticket) + " sym=" + brokerSym
                  + " newSl=" + DoubleToString(newSl, 5) + " newTp=" + DoubleToString(newTp, 5);
         }
      }
      else if(commandType == "CLOSE_POSITION")
      {
         success = ClosePositionByTicket(mt5Ticket, brokerSym);
         if(!success) failReason = "PositionClose failed";
      }
      else if(commandType == "PARTIAL_CLOSE")
      {
         success = PartialClosePosition(mt5Ticket, brokerSym, closeLots);
         if(!success) failReason = "PartialClose failed";
      }
      else
      {
         failReason = "Unknown command type: " + commandType;
      }

      // Report result back to server
      ReportCommandResult(commandId, success, failReason);
   }
}

//+------------------------------------------------------------------+
//| Modify SL of an open position by ticket                          |
//+------------------------------------------------------------------+
bool ModifyPositionSL(long ticket, string brokerSym, double newSl, double newTp = -1)
{
   if(!PositionSelectByTicket((ulong)ticket))
   {
      Print(EA_NAME + " [cmd]: Cannot select position ticket=", ticket);
      g_lastModifyRetcode = -1;
      return false;
   }

   // Use the actual symbol from the position (broker may use suffixed names)
   string posSymbol = PositionGetString(POSITION_SYMBOL);
   if(StringLen(posSymbol) > 0) brokerSym = posSymbol;

   int digits = (int)SymbolInfoInteger(brokerSym, SYMBOL_DIGITS);
   newSl = NormalizeDouble(newSl, digits);

   double currentSL = PositionGetDouble(POSITION_SL);
   double currentTP = PositionGetDouble(POSITION_TP);

   // Determine target TP: if newTp >= 0 from server, use it (0 = remove TP); else keep existing
   double targetTP = (newTp >= 0) ? NormalizeDouble(newTp, digits) : currentTP;

   // Don't modify if neither SL nor TP changed
   bool slChanged = MathAbs(newSl - currentSL) >= SymbolInfoDouble(brokerSym, SYMBOL_POINT);
   bool tpChanged = MathAbs(targetTP - currentTP) >= SymbolInfoDouble(brokerSym, SYMBOL_POINT);

   if(!slChanged && !tpChanged)
   {
      Print(EA_NAME + " [cmd]: SL/TP unchanged for ticket=", ticket, " (SL=", DoubleToString(currentSL, digits), " TP=", DoubleToString(currentTP, digits), ")");
      return true;  // Not an error
   }

   double finalSL = slChanged ? newSl : currentSL;
   double finalTP = targetTP;
   double ask = SymbolInfoDouble(brokerSym, SYMBOL_ASK);
   double bid = SymbolInfoDouble(brokerSym, SYMBOL_BID);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

   Print(EA_NAME + " [cmd]: MODIFY PRE-CHECK � ticket=", ticket,
         " sym=", brokerSym, " digits=", digits,
         " posType=", EnumToString(posType),
         " bid=", DoubleToString(bid, digits), " ask=", DoubleToString(ask, digits),
         " curSL=", DoubleToString(currentSL, digits), " curTP=", DoubleToString(currentTP, digits),
         " finalSL=", DoubleToString(finalSL, digits), " finalTP=", DoubleToString(finalTP, digits),
         " slChanged=", slChanged, " tpChanged=", tpChanged);

   // Use CTrade class � handles broker-specific quirks (fill types, etc.)
   CTrade trade;
   trade.SetExpertMagicNumber(0);
   trade.SetDeviationInPoints(10);

   bool ok = trade.PositionModify((ulong)ticket, finalSL, finalTP);
   uint retcode = trade.ResultRetcode();
   string comment = trade.ResultComment();

   Print(EA_NAME + " [cmd]: CTrade.PositionModify result � ok=", ok,
         " retcode=", retcode,
         " comment=", comment,
         " lastError=", GetLastError());

   if(ok && (retcode == TRADE_RETCODE_DONE || retcode == TRADE_RETCODE_PLACED))
   {
      string msg = EA_NAME + " [cmd]: MODIFIED � ticket=" + IntegerToString(ticket);
      if(slChanged) msg += " SL " + DoubleToString(currentSL, digits) + " ? " + DoubleToString(newSl, digits);
      if(tpChanged) msg += " TP " + DoubleToString(currentTP, digits) + " ? " + DoubleToString(finalTP, digits);
      Print(msg);
      return true;
   }
   else
   {
      g_lastModifyRetcode = (int)retcode;
      Print(EA_NAME + " [cmd]: MODIFY FAILED � ticket=", ticket,
            " retcode=", retcode,
            " comment=", comment);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Close a position by ticket (market close)                        |
//+------------------------------------------------------------------+
bool ClosePositionByTicket(long ticket, string brokerSym)
{
   if(!PositionSelectByTicket((ulong)ticket))
   {
      Print(EA_NAME + " [cmd]: Cannot select position ticket=", ticket, " for close");
      return false;
   }

   double volume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

   MqlTradeRequest request;
   MqlTradeResult  tradeResult;
   ZeroMemory(request);
   ZeroMemory(tradeResult);

   request.action    = TRADE_ACTION_DEAL;
   request.position  = (ulong)ticket;
   request.symbol    = brokerSym;
   request.volume    = volume;
   request.deviation = g_execSlippage;
   request.magic     = EXEC_MAGIC;
   request.comment   = g_execComment + "_TRAIL";

   // Opposite direction to close
   if(posType == POSITION_TYPE_BUY)
   {
      request.type  = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(brokerSym, SYMBOL_BID);
   }
   else
   {
      request.type  = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(brokerSym, SYMBOL_ASK);
   }

   request.type_filling = ORDER_FILLING_IOC;

   bool ok = OrderSend(request, tradeResult);

   if(!ok && tradeResult.retcode == TRADE_RETCODE_INVALID_FILL)
   {
      request.type_filling = ORDER_FILLING_FOK;
      ZeroMemory(tradeResult);
      ok = OrderSend(request, tradeResult);
   }

   if(ok && (tradeResult.retcode == TRADE_RETCODE_DONE || tradeResult.retcode == TRADE_RETCODE_PLACED))
   {
      Print(EA_NAME + " [cmd]: POSITION CLOSED � ticket=", ticket,
            " price=", DoubleToString(tradeResult.price, 5));
      return true;
   }
   else
   {
      Print(EA_NAME + " [cmd]: CLOSE FAILED � ticket=", ticket,
            " retcode=", tradeResult.retcode,
            " comment=", tradeResult.comment);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Partially close a position by ticket (close N lots)              |
//+------------------------------------------------------------------+
bool PartialClosePosition(long ticket, string brokerSym, double closeLots)
{
   if(!PositionSelectByTicket((ulong)ticket))
   {
      Print(EA_NAME + " [cmd]: Cannot select position ticket=", ticket, " for partial close");
      return false;
   }

   double volume = PositionGetDouble(POSITION_VOLUME);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);

   // Validate close volume
   double minLot = SymbolInfoDouble(brokerSym, SYMBOL_VOLUME_MIN);
   double lotStep = SymbolInfoDouble(brokerSym, SYMBOL_VOLUME_STEP);
   if(closeLots <= 0 || closeLots >= volume)
   {
      Print(EA_NAME + " [cmd]: Invalid partial close lots=", DoubleToString(closeLots, 2),
            " position volume=", DoubleToString(volume, 2), " � using full close");
      return ClosePositionByTicket(ticket, brokerSym);
   }

   // Round to lot step
   closeLots = MathFloor(closeLots / lotStep) * lotStep;
   if(closeLots < minLot) closeLots = minLot;

   MqlTradeRequest request;
   MqlTradeResult  tradeResult;
   ZeroMemory(request);
   ZeroMemory(tradeResult);

   request.action    = TRADE_ACTION_DEAL;
   request.position  = (ulong)ticket;
   request.symbol    = brokerSym;
   request.volume    = closeLots;
   request.deviation = g_execSlippage;
   request.magic     = EXEC_MAGIC;
   request.comment   = g_execComment + "_PARTIAL";

   if(posType == POSITION_TYPE_BUY)
   {
      request.type  = ORDER_TYPE_SELL;
      request.price = SymbolInfoDouble(brokerSym, SYMBOL_BID);
   }
   else
   {
      request.type  = ORDER_TYPE_BUY;
      request.price = SymbolInfoDouble(brokerSym, SYMBOL_ASK);
   }

   request.type_filling = ORDER_FILLING_IOC;

   bool ok = OrderSend(request, tradeResult);

   if(!ok && tradeResult.retcode == TRADE_RETCODE_INVALID_FILL)
   {
      request.type_filling = ORDER_FILLING_FOK;
      ZeroMemory(tradeResult);
      ok = OrderSend(request, tradeResult);
   }

   if(ok && (tradeResult.retcode == TRADE_RETCODE_DONE || tradeResult.retcode == TRADE_RETCODE_PLACED))
   {
      Print(EA_NAME + " [cmd]: PARTIAL CLOSE � ticket=", ticket,
            " closed=", DoubleToString(closeLots, 2),
            " remaining=", DoubleToString(volume - closeLots, 2),
            " price=", DoubleToString(tradeResult.price, 5));
      return true;
   }
   else
   {
      Print(EA_NAME + " [cmd]: PARTIAL CLOSE FAILED � ticket=", ticket,
            " retcode=", tradeResult.retcode,
            " comment=", tradeResult.comment);
      return false;
   }
}

//+------------------------------------------------------------------+
//| Report command execution result to POST /api/mt5/commands/ack    |
//+------------------------------------------------------------------+
void ReportCommandResult(string commandId, bool success, string failReason)
{
   string json = "{";
   json += "\"commandId\":\"" + commandId + "\",";
   if(success)
      json += "\"status\":\"executed\"";
   else
      json += "\"status\":\"failed\",\"failureReason\":\"" + failReason + "\"";
   json += "}";

   string url = InpServerUrl + "/api/mt5/commands/ack";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 10000, postData, resultData, resultHeaders);

   if(httpCode != 200)
   {
      Print(EA_NAME + " [cmd]: Command ack HTTP ", httpCode,
            " for command ", commandId);
   }
}
//+------------------------------------------------------------------+

