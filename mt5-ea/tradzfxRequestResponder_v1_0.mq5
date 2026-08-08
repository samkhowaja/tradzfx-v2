//+------------------------------------------------------------------+
//| tradzfxRequestResponder_v1_0.mq5                                 |
//| LINEAGE-06 on-demand candle request responder.                   |
//|                                                                  |
//| Polls Common\Files\tradzfx\requests\pending\*.json (written by   |
//| the app), fetches the window with CopyRates(M1), and POSTs the   |
//| response to /api/ingest/mt5/ondemand on the ingestion server.    |
//|                                                                  |
//| Request JSON (one object per file, filename <request_id>.json):  |
//|   {"request_id":"<uuid>","symbol":"XAUUSD","timeframe":"1m",     |
//|    "from_utc":"2026-07-29T11:30:00Z","to_utc":"2026-07-29T12:30:00Z"} |
//|                                                                  |
//| Fulfilled request files are moved to ..\done\, failures to       |
//| ..\failed\ with a .err sidecar. All scheduling uses TimeLocal()  |
//| (never TimeCurrent() — it freezes when the market is closed).    |
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "1.00"
#property strict

input string InpServerUrl  = "http://127.0.0.1:3004"; // Ingestion server URL (direct, port 3004)
input int    InpPollSec    = 5;                       // Request folder poll interval (seconds)
input int    InpMaxBars    = 5000;                    // Max bars per response (safety cap)
// No API key input: the server authenticates by terminal identity
// (X-Terminal-Login + X-Terminal-Server headers, resolved against mt5_terminals).

#define REQ_PENDING "tradzfx\\requests\\pending"
#define REQ_DONE    "tradzfx\\requests\\done"
#define REQ_FAILED  "tradzfx\\requests\\failed"

//+------------------------------------------------------------------+
int OnInit()
{
   EventSetTimer(MathMax(1, InpPollSec));
   FolderCreate("tradzfx", FILE_COMMON);
   FolderCreate("tradzfx\\requests", FILE_COMMON);
   FolderCreate(REQ_PENDING, FILE_COMMON);
   FolderCreate(REQ_DONE, FILE_COMMON);
   FolderCreate(REQ_FAILED, FILE_COMMON);
   Print("tradzfxRequestResponder v1.00 ready — polling ", REQ_PENDING);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason) { EventKillTimer(); }

//+------------------------------------------------------------------+
void OnTimer()
{
   string filename;
   long handle = FileFindFirst(REQ_PENDING + "\\*.json", filename, FILE_COMMON);
   if(handle == INVALID_HANDLE) return;
   do
   {
      ProcessRequest(filename);
   }
   while(FileFindNext(handle, filename));
   FileFindClose(handle);
}

//+------------------------------------------------------------------+
//| Minimal JSON field extraction (requests are machine-written,      |
//| flat, double-quoted; no nested objects).                          |
//+------------------------------------------------------------------+
string JsonGet(const string json, const string key)
{
   string pat = "\"" + key + "\":\"";
   int p = StringFind(json, pat);
   if(p < 0) return "";
   p += StringLen(pat);
   int e = StringFind(json, "\"", p);
   if(e < 0) return "";
   return StringSubstr(json, p, e - p);
}

datetime IsoToTime(const string iso)
{
   string s = iso;
   StringReplace(s, "T", " ");
   StringReplace(s, "Z", "");
   StringReplace(s, "-", ".");
   return StringToTime(s); // naive parse, treated as UTC by caller
}

string GmtIso()
{
   string s = TimeToString(TimeGMT(), TIME_DATE | TIME_SECONDS); // yyyy.mm.dd hh:mi:ss
   StringReplace(s, ".", "-");
   StringReplace(s, " ", "T");
   return s + "Z";
}

//+------------------------------------------------------------------+
void ProcessRequest(const string filename)
{
   string path = REQ_PENDING + "\\" + filename;
   // FILE_ANSI: app writes ASCII JSON; default FILE_TXT is UTF-16 and garbles parse.
   int h = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON | FILE_SHARE_READ);
   if(h == INVALID_HANDLE) return;
   string json = "";
   while(!FileIsEnding(h)) json += FileReadString(h);
   FileClose(h);

   string requestId = JsonGet(json, "request_id");
   string symbol    = JsonGet(json, "symbol");
   string fromIso   = JsonGet(json, "from_utc");
   string toIso     = JsonGet(json, "to_utc");
   if(StringLen(requestId) == 0 || StringLen(symbol) == 0 || StringLen(fromIso) == 0 || StringLen(toIso) == 0)
   {
      FailRequest(filename, "malformed request json");
      return;
   }

   // Request timestamps are UTC; CopyRates wants server time. StringToTime is a
   // naive parse, so fromUtc/toUtc hold the UTC instants (as raw epoch values).
   // Offset derived via TimeTradeServer() (never TimeCurrent(): it freezes when
   // the market is closed).
   int offsetSec = (int)(TimeTradeServer() - TimeGMT());
   datetime fromUtc = IsoToTime(fromIso);
   datetime toUtc   = IsoToTime(toIso);
   datetime fromSrv = fromUtc + offsetSec;
   datetime toSrv   = toUtc + offsetSec;

   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(symbol, PERIOD_M1, fromSrv, toSrv, rates);
   if(copied < 0)
   {
      FailRequest(filename, "CopyRates error " + IntegerToString(GetLastError()));
      return;
   }
   if(copied > InpMaxBars) copied = InpMaxBars;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);

   // Build response payload. ts is epoch seconds UTC: server bar time minus offset.
   string barsJson = "";
   for(int i = 0; i < copied; i++)
   {
      long tsUtc = (long)rates[i].time - offsetSec;
      if(i > 0) barsJson += ",";
      barsJson += StringFormat(
         "{\"ts\":%I64d,\"o\":%s,\"h\":%s,\"l\":%s,\"c\":%s,\"tickVol\":%I64d,\"spread\":%d}",
         tsUtc,
         DoubleToString(rates[i].open,  digits),
         DoubleToString(rates[i].high,  digits),
         DoubleToString(rates[i].low,   digits),
         DoubleToString(rates[i].close, digits),
         rates[i].tick_volume,
         rates[i].spread);
   }

   string payload = "{";
   payload += "\"request_id\":\"" + requestId + "\",";
   payload += "\"symbol\":\"" + symbol + "\",";
   payload += "\"timeframe\":\"1m\",";
   payload += "\"from_utc\":\"" + fromIso + "\",";
   payload += "\"to_utc\":\"" + toIso + "\",";
   payload += "\"retrieved_at\":\"" + GmtIso() + "\",";
   payload += "\"terminal\":{";
   payload += "\"login\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",";
   payload += "\"server\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\",";
   payload += "\"build\":\"" + IntegerToString(TerminalInfoInteger(TERMINAL_BUILD)) + "\"},";
   payload += "\"source\":{\"broker\":\"" + AccountInfoString(ACCOUNT_SERVER) + "\",\"digits\":" + IntegerToString(digits) + ",\"source\":\"on_request\"},";
   payload += "\"bars\":[" + barsJson + "]}";

   if(PostResponse(payload))
      MoveRequest(filename, REQ_DONE);
   // else: leave in pending; next timer tick retries (server down / network error).
}

//+------------------------------------------------------------------+
bool PostResponse(const string payload)
{
   string url = InpServerUrl;
   if(StringGetCharacter(url, StringLen(url) - 1) == '/')
      StringSetCharacter(url, StringLen(url) - 1, 0);
   url += "/api/ingest/mt5/ondemand";

   char data[], result[];
   string resultHeaders;
   StringToCharArray(payload, data, 0, StringLen(payload), CP_UTF8);
   string headers = "Content-Type: application/json\r\n";
   headers += "X-Terminal-Login: " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\r\n";
   headers += "X-Terminal-Server: " + AccountInfoString(ACCOUNT_SERVER) + "\r\n";
   int status = WebRequest("POST", url, headers, 10000, data, result, resultHeaders);
   if(status == 200) return true;
   Print("WARN: ondemand POST status=", status, " body=", CharArrayToString(result));
   return false;
}

//+------------------------------------------------------------------+
void MoveRequest(const string filename, const string destFolder)
{
   FileMove(REQ_PENDING + "\\" + filename, FILE_COMMON, destFolder + "\\" + filename, FILE_COMMON);
}

void FailRequest(const string filename, const string reason)
{
   int h = FileOpen(REQ_FAILED + "\\" + filename + ".err", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(h != INVALID_HANDLE)
   {
      FileWriteString(h, reason + " at " + TimeToString(TimeLocal(), TIME_DATE|TIME_SECONDS));
      FileClose(h);
   }
   MoveRequest(filename, REQ_FAILED);
   Print("ERROR: request ", filename, " failed: ", reason);
}
//+------------------------------------------------------------------+
