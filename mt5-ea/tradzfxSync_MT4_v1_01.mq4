//+------------------------------------------------------------------+
//|                                       tradzfxSync_MT4.mq4    |
//|                        tradzfx -- MT4 Execution EA        |
//|                                                                  |
//| PURPOSE:                                                         |
//| Execute trade signals from tradzfx server on MT4 accounts.   |
//| Syncs account info (balance/equity) and trade history.           |
//| NO candle data push — MT5 handles all market data.               |
//|                                                                  |
//| v1.0 -- MT4 execution-only EA (signals + account sync)           |
//|                                                                  |
//| SETUP:                                                           |
//| 1. Copy this file to: MT4 -> MQL4/Experts/                      |
//| 2. Allow WebRequest in MT4:                                      |
//|    Tools -> Options -> Expert Advisors ->                        |
//|    [x] Allow WebRequest for listed URL:                          |
//|    Add: http://127.0.0.1  (or your server IP/domain)             |
//| 3. Drag EA onto any chart (e.g., EURUSD M1)                     |
//| 4. Set your API Key (from tradzfx -> Accounts -> MT5 Conn)  |
//| 5. EA will poll for signals, execute, and sync account info      |
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "1.01"
#property description "MT4 execution-only EA: trade signals + account sync (v1.01)"
#property strict

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

//--- Input parameters
input string InpApiKey           = ""; // API Key (from tradzfx)
input string InpServerUrl        = "http://127.0.0.1";              // Server URL (port 80 via nginx)
input bool   InpExecEnabled      = true;                            // Enable trade execution
input bool   InpExecPaperMode    = false;                           // Paper mode (log only, no real trades)
input int    InpExecPollSec      = 3;                               // Signal poll interval (1-10 seconds)
input int    InpExecSlippage     = 20;                               // Max slippage in points
input double InpExecMaxSpreadPips= 3.0;                              // Max spread in pips (0 = no guard)
input string InpExecComment      = "TM";                             // Order comment prefix

//--- Constants
#define EA_NAME          "tradzfxSync_MT4"
#define EXEC_MAGIC       202633
#define MAX_TRACKED      20
#define HEARTBEAT_SEC    30
#define TRADE_SYNC_SEC   300

//--- State
datetime g_lastHeartbeat = 0;
datetime g_lastExecPoll = 0;
datetime g_lastTradeSync = 0;
int      g_execPollSec = 3;

//--- Execution tracking
string   g_trackedSignalId[];
int      g_trackedTicket[];
int      g_trackedCount = 0;

//--- Counters
int g_totalSignalsReceived = 0;
int g_totalOrdersFilled = 0;
int g_totalOrdersRejected = 0;
int g_totalSpreadRejected = 0;
int g_totalPaperLogged = 0;
int g_totalPositionsClosed = 0;
int g_totalTradesSynced = 0;

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

   ArrayResize(g_trackedSignalId, MAX_TRACKED);
   ArrayResize(g_trackedTicket, MAX_TRACKED);
   g_trackedCount = 0;

   g_execPollSec = MathMax(1, MathMin(InpExecPollSec, 10));

   string modeStr = InpExecPaperMode ? "PAPER" : "LIVE";
   Print(EA_NAME + ": Started [", modeStr, "] (magic=", EXEC_MAGIC,
         ", poll every ", g_execPollSec, "s, spreadGuard=",
         DoubleToString(InpExecMaxSpreadPips, 1), " pips)");

   EventSetTimer(HEARTBEAT_SEC);

   // Initial heartbeat
   SendHeartbeat();

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization                                          |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
   Print(EA_NAME + ": Stopped. Filled=", g_totalOrdersFilled,
         " Rejected=", g_totalOrdersRejected,
         " Closed=", g_totalPositionsClosed);
}

//+------------------------------------------------------------------+
//| Timer event -- heartbeat + trade sync                            |
//+------------------------------------------------------------------+
void OnTimer()
{
   // Heartbeat every 30s
   if(TimeCurrent() - g_lastHeartbeat >= HEARTBEAT_SEC)
   {
      SendHeartbeat();
      g_lastHeartbeat = TimeCurrent();
   }

   // Trade history sync every 5 min
   if(TimeCurrent() - g_lastTradeSync >= TRADE_SYNC_SEC)
   {
      SyncTradeHistory();
      g_lastTradeSync = TimeCurrent();
   }

   // Monitor tracked positions for closes
   MonitorOpenPositions();
}

//+------------------------------------------------------------------+
//| Tick event -- fast signal polling                                 |
//+------------------------------------------------------------------+
void OnTick()
{
   if(!InpExecEnabled) return;

   datetime now = TimeCurrent();
   if(now - g_lastExecPoll < g_execPollSec) return;
   g_lastExecPoll = now;

   PollAndExecuteSignals();
   PollAndExecuteCommands();

   UpdateStatusComment();
}

//+------------------------------------------------------------------+
//| ==================== JSON HELPERS ============================== |
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
         numStr += ShortToString(ch);
      else
         break;
   }

   if(StringLen(numStr) == 0) return 0;
   return (long)StringToInteger(numStr);
}

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
         numStr += ShortToString(ch);
      else
         break;
   }

   if(StringLen(numStr) == 0) return 0.0;
   return StringToDouble(numStr);
}

//+------------------------------------------------------------------+
//| ==================== SYMBOL MATCHING =========================== |
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

   // 3) Search all symbols for base pair substring
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      if(StringFind(name, baseSym) == 0 && SymbolSelect(name, true))
         return name;
   }

   return "";
}

   double ResolveExecMaxSpreadPips(string brokerSym)
   {
      double maxSpread = InpExecMaxSpreadPips;
      if(maxSpread <= 0.0) return 0.0;

      string sym = brokerSym;
      StringToUpper(sym);

      // Gold usually has structurally wider spread than FX majors.
      // Keep user input if higher, but enforce a practical floor for XAU.
      if(StringFind(sym, "XAU") >= 0)
         maxSpread = MathMax(maxSpread, 50.0);

      return maxSpread;
   }

//+------------------------------------------------------------------+
//| ==================== HEARTBEAT ================================= |
//+------------------------------------------------------------------+

void SendHeartbeat()
{
   // MT4 account info
   double acctBalance    = AccountBalance();
   double acctEquity     = AccountEquity();
   double acctMarginFree = AccountFreeMargin();
   int    acctLeverage   = (int)AccountLeverage();
   int    acctLogin      = (int)AccountNumber();
   string acctServer     = AccountServer();
   string acctBroker     = AccountCompany();
   string acctCurrency   = AccountCurrency();
   string acctType       = IsDemo() ? "demo" : "real";

   // Build JSON
   string json = "{";
   json += "\"symbolsActive\":[],";
   json += "\"queueDepth\":0,";
   json += "\"errors\":0,";
   json += "\"version\":\"mt4-1.00\",";
   json += "\"balance\":" + DoubleToString(acctBalance, 2) + ",";
   json += "\"equity\":" + DoubleToString(acctEquity, 2) + ",";
   json += "\"marginFree\":" + DoubleToString(acctMarginFree, 2) + ",";
   json += "\"leverage\":" + IntegerToString(acctLeverage) + ",";
   json += "\"accountNumber\":\"" + IntegerToString(acctLogin) + "\",";
   json += "\"brokerServer\":\"" + acctServer + "\",";
   json += "\"broker\":\"" + acctBroker + "\",";
   json += "\"accountType\":\"" + acctType + "\",";
   json += "\"platform\":\"mt4\",";
   json += "\"currency\":\"" + acctCurrency + "\"";
   json += "}";

   string url = InpServerUrl + "/api/ingest/mt5/heartbeat";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 5000, postData, resultData, resultHeaders);
   if(httpCode != 200 && httpCode != -1)
   {
      Print(EA_NAME + ": Heartbeat HTTP ", httpCode);
   }
}

//+------------------------------------------------------------------+
//| ==================== SIGNAL EXECUTION ========================== |
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
            Print(EA_NAME + " [exec]: Signal poll error ", err);
      }
      else
         Print(EA_NAME + " [exec]: Signal poll HTTP ", httpCode);
      return;
   }

   string body = CharArrayToString(result);

   // Server-authoritative mode — server "paper" always forces paper,
   // server "live" overrides EA default to allow real execution.
   string serverMode = ExtractJsonString(body, "mode");
   bool serverPaper = (serverMode == "paper");
   bool serverLive  = (serverMode == "live");
   bool effectivePaper = serverPaper ? true : (serverLive ? false : InpExecPaperMode);

   long count = ExtractJsonLong(body, "count");
   if(count <= 0) return;

   Print(EA_NAME + " [exec]: Received ", count, " signal(s)");

   int arrStart = StringFind(body, "\"signals\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   int searchPos = arrStart;
   for(int s = 0; s < (int)count && s < MAX_TRACKED; s++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;

      string sigJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      string signalId      = ExtractJsonString(sigJson, "signalId");
      string symbol        = ExtractJsonString(sigJson, "symbol");
      string side          = ExtractJsonString(sigJson, "side");
      double entry         = ExtractJsonDouble(sigJson, "entryPrice");
      double sl            = ExtractJsonDouble(sigJson, "stopLoss");
      double tp            = ExtractJsonDouble(sigJson, "takeProfit");
      double lots          = ExtractJsonDouble(sigJson, "lotSize");
      string entryType     = ExtractJsonString(sigJson, "entryType");
      double expiresInSec  = ExtractJsonDouble(sigJson, "expiresInSeconds");
      double entryZonePips = ExtractJsonDouble(sigJson, "entryZonePips");

      if(StringLen(signalId) == 0 || StringLen(symbol) == 0)
      {
         Print(EA_NAME + " [exec]: Skipping malformed signal");
         continue;
      }

      g_totalSignalsReceived++;

      // TTL check — server sends remaining seconds until expiry.
      // No timezone conversion needed: just check if seconds remaining > 0.
      if(expiresInSec > 0 && expiresInSec < 5)
      {
         // Less than 5 seconds remaining — too tight to execute safely
         Print(EA_NAME + " [exec]: TTL EXPIRED — signal ", signalId,
               " (", DoubleToString(expiresInSec, 0), "s remaining)");
         ReportFillOrReject(signalId, 0, 0.0, false, "TTL_EXPIRED_CLIENT_SIDE");
         g_totalOrdersRejected++;
         continue;
      }

      // Prefer server-mapped broker symbol; fallback to local Market Watch lookup
      string brokerSym = ExtractJsonString(sigJson, "brokerSymbol");
      if(StringLen(brokerSym) == 0)
         brokerSym = FindBrokerSymbol(symbol);
      if(StringLen(brokerSym) == 0)
      {
         Print(EA_NAME + " [exec]: Symbol '", symbol, "' not found, rejecting signal ", signalId);
         ReportFillOrReject(signalId, 0, 0.0, false, "Symbol not found in Market Watch");
         g_totalOrdersRejected++;
         continue;
      }

      string sideDisplay = side;
      StringToUpper(sideDisplay);
      Print(EA_NAME + " [exec]: Executing ", sideDisplay, " ", brokerSym,
            " @ ", DoubleToString(entry, 5),
            " SL=", DoubleToString(sl, 5),
            " TP=", DoubleToString(tp, 5),
            " lots=", DoubleToString(lots, 2));

      ExecuteSignal(signalId, brokerSym, side, entry, sl, tp, lots, entryType, effectivePaper, entryZonePips);
   }
}

//+------------------------------------------------------------------+
//| Execute a single trade signal (MT4 OrderSend)                    |
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
   double entryZonePips)
{
   // Validate lot size
   double minLot  = MarketInfo(brokerSym, MODE_MINLOT);
   double maxLot  = MarketInfo(brokerSym, MODE_MAXLOT);
   double lotStep = MarketInfo(brokerSym, MODE_LOTSTEP);

   if(lots < minLot) lots = minLot;
   if(lots > maxLot) lots = maxLot;
   lots = MathFloor(lots / lotStep + 0.5) * lotStep;
   lots = NormalizeDouble(lots, 2);

   // Spread guard
   double maxSpreadPips = ResolveExecMaxSpreadPips(brokerSym);
   if(maxSpreadPips > 0.0)
   {
      double spreadPoints = MarketInfo(brokerSym, MODE_SPREAD);
      int pipDigits = (MarketInfo(brokerSym, MODE_DIGITS) == 3 || MarketInfo(brokerSym, MODE_DIGITS) == 5) ? 10 : 1;
      double spreadPips = spreadPoints / (double)pipDigits;

      if(spreadPips > maxSpreadPips)
      {
         Print(EA_NAME + " [exec]: SPREAD GUARD — ", brokerSym,
               " spread=", DoubleToString(spreadPips, 1), " > max=",
               DoubleToString(maxSpreadPips, 1));
         ReportFillOrReject(signalId, 0, 0.0, false,
            "Spread guard: " + DoubleToString(spreadPips, 1) + " > " + DoubleToString(maxSpreadPips, 1));
         g_totalSpreadRejected++;
         g_totalOrdersRejected++;
         return;
      }
   }

   // Entry zone guard
   if(entryZonePips > 0.0)
   {
      double livePrice = (side == "buy") ? MarketInfo(brokerSym, MODE_ASK)
                                         : MarketInfo(brokerSym, MODE_BID);
      double point = MarketInfo(brokerSym, MODE_POINT);
      int pipDigits = (MarketInfo(brokerSym, MODE_DIGITS) == 3 || MarketInfo(brokerSym, MODE_DIGITS) == 5) ? 10 : 1;
      double zoneDist = entryZonePips * point * pipDigits;
      double drift = MathAbs(livePrice - entry);

      if(drift > zoneDist)
      {
         double driftPips = drift / (point * pipDigits);
         Print(EA_NAME + " [exec]: ENTRY ZONE REJECT — drift=",
               DoubleToString(driftPips, 1), " > zone=",
               DoubleToString(entryZonePips, 1));
         ReportFillOrReject(signalId, 0, 0.0, false,
            "Entry zone: drift " + DoubleToString(driftPips, 1) + " > " + DoubleToString(entryZonePips, 1));
         g_totalOrdersRejected++;
         return;
      }
   }

   // Determine order type
   int digits = (int)MarketInfo(brokerSym, MODE_DIGITS);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);
   if(entryType == "limit" || entryType == "stop") entry = NormalizeDouble(entry, digits);

   // Paper mode
   if(paperMode)
   {
      double paperPrice = (side == "buy") ? MarketInfo(brokerSym, MODE_ASK)
                                          : MarketInfo(brokerSym, MODE_BID);
      Print(EA_NAME + " [PAPER]: Would execute ", StringToUpper(side), " ", brokerSym,
            " lots=", DoubleToString(lots, 2),
            " SL=", DoubleToString(sl, digits),
            " TP=", DoubleToString(tp, digits));
      g_totalPaperLogged++;
      ReportFillOrReject(signalId, 0, paperPrice, true, "");
      return;
   }

   // Determine MT4 order type + price
   int orderType;
   double price;
   string comment = InpExecComment + "_" + StringSubstr(signalId, 0, 8);

   if(entryType == "limit" || entryType == "stop")
   {
      price = entry;
      if(side == "buy")
         orderType = (entryType == "limit") ? OP_BUYLIMIT : OP_BUYSTOP;
      else if(side == "sell")
         orderType = (entryType == "limit") ? OP_SELLLIMIT : OP_SELLSTOP;
      else
      {
         ReportFillOrReject(signalId, 0, 0.0, false, "Invalid side: " + side);
         g_totalOrdersRejected++;
         return;
      }
   }
   else
   {
      // Market order
      if(side == "buy")
      {
         orderType = OP_BUY;
         price = MarketInfo(brokerSym, MODE_ASK);
      }
      else if(side == "sell")
      {
         orderType = OP_SELL;
         price = MarketInfo(brokerSym, MODE_BID);
      }
      else
      {
         ReportFillOrReject(signalId, 0, 0.0, false, "Invalid side: " + side);
         g_totalOrdersRejected++;
         return;
      }
   }

   // Send order (MT4 style)
   int ticket = OrderSend(brokerSym, orderType, lots, price, InpExecSlippage,
                           sl, tp, comment, EXEC_MAGIC, 0, clrNONE);

   if(ticket > 0)
   {
      double fillPrice = 0;
      if(OrderSelect(ticket, SELECT_BY_TICKET))
         fillPrice = OrderOpenPrice();
      else
         fillPrice = price;

      if(entryType == "limit" || entryType == "stop")
      {
         Print(EA_NAME + " [exec]: PENDING PLACED — type=", entryType, " ticket=", ticket, " signal=", signalId);
      }
      else
      {
         Print(EA_NAME + " [exec]: FILLED — ticket=", ticket,
               " fillPrice=", DoubleToString(fillPrice, digits),
               " signal=", signalId);
      }

      // Track position
      if(g_trackedCount < MAX_TRACKED)
      {
         g_trackedSignalId[g_trackedCount] = signalId;
         g_trackedTicket[g_trackedCount] = ticket;
         g_trackedCount++;
      }

      g_totalOrdersFilled++;
      ReportFillOrReject(signalId, ticket, fillPrice, true, "");
   }
   else
   {
      int err = GetLastError();
      string errMsg = IntegerToString(err) + " " + ErrorDescription(err);
      Print(EA_NAME + " [exec]: REJECTED — error=", err,
            " (", ErrorDescription(err), ") signal=", signalId);
      g_totalOrdersRejected++;
      ReportFillOrReject(signalId, 0, 0.0, false, errMsg);
   }
}

//+------------------------------------------------------------------+
//| Simple MT4 error descriptions for common errors                  |
//+------------------------------------------------------------------+
string ErrorDescription(int err)
{
   switch(err)
   {
      case 0:    return "No error";
      case 1:    return "No error, trade conditions not changed";
      case 2:    return "Common error";
      case 3:    return "Invalid trade parameters";
      case 4:    return "Trade server is busy";
      case 5:    return "Old version of the client terminal";
      case 6:    return "No connection with trade server";
      case 7:    return "Not enough rights";
      case 8:    return "Too frequent requests";
      case 9:    return "Malfunctional trade operation";
      case 64:   return "Account disabled";
      case 65:   return "Invalid account";
      case 128:  return "Trade timeout";
      case 129:  return "Invalid price";
      case 130:  return "Invalid stops";
      case 131:  return "Invalid trade volume";
      case 132:  return "Market is closed";
      case 133:  return "Trade is disabled";
      case 134:  return "Not enough money";
      case 135:  return "Price changed";
      case 136:  return "Off quotes";
      case 137:  return "Broker is busy";
      case 138:  return "Requote";
      case 139:  return "Order is locked";
      case 140:  return "Long positions only allowed";
      case 141:  return "Too many requests";
      case 145:  return "Modification denied because order is too close to market";
      case 146:  return "Trade context is busy";
      case 147:  return "Expirations are denied by broker";
      case 148:  return "Trades too many open and pending orders";
      case 149:  return "Hedging is prohibited";
      case 150:  return "Prohibited by FIFO rules";
      default:   return "Unknown error " + IntegerToString(err);
   }
}

//+------------------------------------------------------------------+
//| ==================== FILL / CLOSE REPORTING ==================== |
//+------------------------------------------------------------------+

void ReportFillOrReject(string signalId, int mt4Ticket, double fillPrice, bool isFilled, string rejectReason)
{
   string json = "{";
   json += "\"signalId\":\"" + signalId + "\",";
   json += "\"mt5Ticket\":" + IntegerToString(mt4Ticket) + ",";
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
      Print(EA_NAME + " [exec]: Fill report HTTP ", httpCode, " for signal ", signalId);
}

void ReportClose(string signalId, int mt4Ticket, double closePrice, string closeReason, double realizedPnl)
{
   string json = "{";
   json += "\"signalId\":\"" + signalId + "\",";
   json += "\"mt5Ticket\":" + IntegerToString(mt4Ticket) + ",";
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
      Print(EA_NAME + " [exec]: Close report HTTP ", httpCode, " for signal ", signalId);
}

//+------------------------------------------------------------------+
//| ==================== POSITION MONITORING ======================== |
//+------------------------------------------------------------------+

void MonitorOpenPositions()
{
   if(g_trackedCount == 0) return;

   for(int i = g_trackedCount - 1; i >= 0; i--)
   {
      int ticket = g_trackedTicket[i];
      string signalId = g_trackedSignalId[i];

      // Check if order is still open
      bool isOpen = false;

      if(OrderSelect(ticket, SELECT_BY_TICKET))
      {
         // OrderCloseTime() == 0 means still open
         if(OrderCloseTime() == 0)
            isOpen = true;
      }

      if(!isOpen)
      {
         // Position closed — get details
         double closePrice = 0.0;
         double realizedPnl = 0.0;
         string closeReason = "MANUAL";

         if(OrderSelect(ticket, SELECT_BY_TICKET))
         {
            closePrice = OrderClosePrice();
            realizedPnl = OrderProfit() + OrderSwap() + OrderCommission();

            // Determine close reason by comparing close price to SL/TP
            double point = MarketInfo(OrderSymbol(), MODE_POINT);
            if(point > 0)
            {
               if(OrderTakeProfit() > 0 && MathAbs(closePrice - OrderTakeProfit()) < point * 2)
                  closeReason = "TP_HIT";
               else if(OrderStopLoss() > 0 && MathAbs(closePrice - OrderStopLoss()) < point * 2)
                  closeReason = "SL_HIT";
            }
         }

         Print(EA_NAME + " [exec]: CLOSED — ticket=", ticket,
               " reason=", closeReason,
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
//| ==================== COMMAND EXECUTION ========================= |
//+------------------------------------------------------------------+

void PollAndExecuteCommands()
{
   string url = InpServerUrl + "/api/mt5/commands";
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   post[];
   char   result[];
   string resultHeaders;

   int httpCode = WebRequest("GET", url, headers, 10000, post, result, resultHeaders);

   if(httpCode != 200) return;

   string body = CharArrayToString(result);

   long count = ExtractJsonLong(body, "count");
   if(count <= 0) return;

   Print(EA_NAME + " [cmd]: Received ", count, " command(s)");

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
      int    mt4Ticket   = (int)ExtractJsonLong(cmdJson, "mt5Ticket");
      string symbol      = ExtractJsonString(cmdJson, "symbol");
      string commandType = ExtractJsonString(cmdJson, "commandType");
      double newSl       = ExtractJsonDouble(cmdJson, "newSl");
      double closeLots   = ExtractJsonDouble(cmdJson, "closeLots");

      if(StringLen(commandId) == 0 || mt4Ticket == 0) continue;

      string brokerSym = FindBrokerSymbol(symbol);
      if(StringLen(brokerSym) == 0) brokerSym = symbol;

      bool success = false;
      string failReason = "";

      if(commandType == "MODIFY_SL")
      {
         success = ModifyOrderSL(mt4Ticket, brokerSym, newSl);
         if(!success) failReason = "OrderModify failed";
      }
      else if(commandType == "CLOSE_POSITION")
      {
         success = CloseOrderByTicket(mt4Ticket, brokerSym);
         if(!success) failReason = "OrderClose failed";
      }
      else if(commandType == "PARTIAL_CLOSE")
      {
         success = PartialCloseOrder(mt4Ticket, brokerSym, closeLots);
         if(!success) failReason = "PartialClose failed";
      }
      else
      {
         failReason = "Unknown command: " + commandType;
      }

      ReportCommandResult(commandId, success, failReason);
   }
}

bool ModifyOrderSL(int ticket, string brokerSym, double newSl)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print(EA_NAME + " [cmd]: Cannot select ticket=", ticket);
      return false;
   }

   int digits = (int)MarketInfo(brokerSym, MODE_DIGITS);
   newSl = NormalizeDouble(newSl, digits);

   double currentSL = OrderStopLoss();
   double currentTP = OrderTakeProfit();

   if(MathAbs(newSl - currentSL) < MarketInfo(brokerSym, MODE_POINT))
      return true; // No change needed

   bool ok = OrderModify(ticket, OrderOpenPrice(), newSl, currentTP, 0, clrNONE);
   if(ok)
   {
      Print(EA_NAME + " [cmd]: SL MODIFIED — ticket=", ticket,
            " ", DoubleToString(currentSL, digits), " -> ", DoubleToString(newSl, digits));
   }
   else
   {
      Print(EA_NAME + " [cmd]: SL MODIFY FAILED — ticket=", ticket,
            " error=", GetLastError());
   }
   return ok;
}

bool CloseOrderByTicket(int ticket, string brokerSym)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print(EA_NAME + " [cmd]: Cannot select ticket=", ticket, " for close");
      return false;
   }

   double volume = OrderLots();
   int orderType = OrderType();
   double price;

   if(orderType == OP_BUY)
      price = MarketInfo(brokerSym, MODE_BID);
   else
      price = MarketInfo(brokerSym, MODE_ASK);

   bool ok = OrderClose(ticket, volume, price, InpExecSlippage, clrNONE);
   if(ok)
      Print(EA_NAME + " [cmd]: CLOSED — ticket=", ticket, " price=", DoubleToString(price, 5));
   else
      Print(EA_NAME + " [cmd]: CLOSE FAILED — ticket=", ticket, " error=", GetLastError());

   return ok;
}

bool PartialCloseOrder(int ticket, string brokerSym, double closeLots)
{
   if(!OrderSelect(ticket, SELECT_BY_TICKET))
   {
      Print(EA_NAME + " [cmd]: Cannot select ticket=", ticket, " for partial close");
      return false;
   }

   double volume = OrderLots();
   int orderType = OrderType();

   if(closeLots <= 0 || closeLots >= volume)
   {
      Print(EA_NAME + " [cmd]: Invalid partial lots=", DoubleToString(closeLots, 2),
            " total=", DoubleToString(volume, 2), " — full close");
      return CloseOrderByTicket(ticket, brokerSym);
   }

   double minLot = MarketInfo(brokerSym, MODE_MINLOT);
   double lotStep = MarketInfo(brokerSym, MODE_LOTSTEP);
   closeLots = MathFloor(closeLots / lotStep) * lotStep;
   if(closeLots < minLot) closeLots = minLot;

   double price;
   if(orderType == OP_BUY)
      price = MarketInfo(brokerSym, MODE_BID);
   else
      price = MarketInfo(brokerSym, MODE_ASK);

   bool ok = OrderClose(ticket, closeLots, price, InpExecSlippage, clrNONE);
   if(ok)
      Print(EA_NAME + " [cmd]: PARTIAL CLOSE — ticket=", ticket,
            " closed=", DoubleToString(closeLots, 2),
            " remaining=", DoubleToString(volume - closeLots, 2));
   else
      Print(EA_NAME + " [cmd]: PARTIAL CLOSE FAILED — ticket=", ticket, " error=", GetLastError());

   return ok;
}

void ReportCommandResult(string commandId, bool success, string failReason)
{
   string json = "{";
   json += "\"commandId\":\"" + commandId + "\",";
   json += "\"success\":" + (success ? "true" : "false");
   if(!success && StringLen(failReason) > 0)
      json += ",\"error\":\"" + failReason + "\"";
   json += "}";

   string url = InpServerUrl + "/api/mt5/command-results";
   string headers = "Content-Type: application/json\r\nX-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();

   char   postData[];
   char   resultData[];
   string resultHeaders;

   StringToCharArray(json, postData, 0, StringLen(json));

   int httpCode = WebRequest("POST", url, headers, 10000, postData, resultData, resultHeaders);
   if(httpCode != 200 && httpCode != -1)
      Print(EA_NAME + " [cmd]: Command result report HTTP ", httpCode);
}

//+------------------------------------------------------------------+
//| ==================== TRADE HISTORY SYNC ======================== |
//+------------------------------------------------------------------+

void SyncTradeHistory()
{
   // MT4: Select order history for last 7 days
   int totalHistory = OrdersHistoryTotal();
   if(totalHistory <= 0) return;

   datetime fromTime = TimeCurrent() - 7 * 24 * 3600;

   string json = "{\"deals\":[";
   int count = 0;
   int limit = 500;

   for(int i = totalHistory - 1; i >= 0 && count < limit; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_HISTORY)) continue;

      // Skip orders older than 7 days
      if(OrderCloseTime() < fromTime && OrderOpenTime() < fromTime) continue;

      int ticket     = OrderTicket();
      string symbol  = OrderSymbol();
      int orderType  = OrderType();
      double volume  = OrderLots();
      double openPr  = OrderOpenPrice();
      double closePr = OrderClosePrice();
      double slVal   = OrderStopLoss();
      double tpVal   = OrderTakeProfit();
      double profit  = OrderProfit();
      double swap    = OrderSwap();
      double comm    = OrderCommission();
      int    magic   = OrderMagicNumber();
      string comment = OrderComment();
      datetime closeTime = OrderCloseTime();

      // Map order type
      string typeStr = "UNKNOWN";
      if(orderType == OP_BUY)        typeStr = "BUY";
      else if(orderType == OP_SELL)  typeStr = "SELL";
      else if(orderType == OP_BUYLIMIT)  typeStr = "BUY_LIMIT";
      else if(orderType == OP_SELLLIMIT) typeStr = "SELL_LIMIT";
      else if(orderType == OP_BUYSTOP)   typeStr = "BUY_STOP";
      else if(orderType == OP_SELLSTOP)  typeStr = "SELL_STOP";

      // Entry type: closed = ENTRY_OUT, else treat as full cycle
      string entryStr = "ENTRY_OUT";

      // Escape comment
      StringReplace(comment, "\\", "\\\\");
      StringReplace(comment, "\"", "\\\"");

      if(count > 0) json += ",";
      json += "{";
      json += "\"ticket\":" + IntegerToString(ticket) + ",";
      json += "\"orderTicket\":" + IntegerToString(ticket) + ",";
      json += "\"symbol\":\"" + symbol + "\",";
      json += "\"type\":\"" + typeStr + "\",";
      json += "\"entry\":\"" + entryStr + "\",";
      json += "\"volume\":" + DoubleToString(volume, 4) + ",";
      json += "\"price\":" + DoubleToString(closePr, 6) + ",";
      json += "\"sl\":" + DoubleToString(slVal, 6) + ",";
      json += "\"tp\":" + DoubleToString(tpVal, 6) + ",";
      json += "\"profit\":" + DoubleToString(profit, 2) + ",";
      json += "\"swap\":" + DoubleToString(swap, 2) + ",";
      json += "\"commission\":" + DoubleToString(comm, 2) + ",";
      json += "\"fee\":0.00,";
      json += "\"magic\":" + IntegerToString(magic) + ",";
      json += "\"comment\":\"" + comment + "\",";
      json += "\"timeMs\":" + IntegerToString((long)closeTime * 1000);
      json += "}";
      count++;
   }

   json += "]}";

   if(count == 0) return;

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
      Print(EA_NAME + ": Trade history synced ", count, " orders (total: ", g_totalTradesSynced, ")");
   }
   else
   {
      Print(EA_NAME + ": Trade sync failed HTTP ", httpCode);
   }
}

//+------------------------------------------------------------------+
//| ==================== STATUS DISPLAY ============================ |
//+------------------------------------------------------------------+

void UpdateStatusComment()
{
   string mode = InpExecPaperMode ? "[PAPER]" : "[LIVE]";
   string txt = EA_NAME + " v1.0 " + mode + "\n";
   txt += "Server: " + InpServerUrl + "\n";
   txt += "Account: " + IntegerToString(AccountNumber()) + " @ " + AccountServer() + "\n";
   txt += "Balance: " + DoubleToString(AccountBalance(), 2) + " " + AccountCurrency() + "\n";
   txt += "Equity: " + DoubleToString(AccountEquity(), 2) + "\n";
   txt += "Signals: " + IntegerToString(g_totalSignalsReceived) + " recv, "
          + IntegerToString(g_totalOrdersFilled) + " filled, "
          + IntegerToString(g_totalPaperLogged) + " paper, "
          + IntegerToString(g_totalOrdersRejected) + " rejected ("
          + IntegerToString(g_totalSpreadRejected) + " spread)\n";
   txt += "Closed: " + IntegerToString(g_totalPositionsClosed)
          + " | Tracked: " + IntegerToString(g_trackedCount) + "\n";
   txt += "Trades synced: " + IntegerToString(g_totalTradesSynced) + "\n";

   Comment(txt);
}
//+------------------------------------------------------------------+
