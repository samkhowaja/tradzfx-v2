//+------------------------------------------------------------------+
//| Export 1-minute candles to CSV                                   |
//|------------------------------------------------------------------|
//| Mode A: fetch from the tradzfx app server (dynamic)          |
//| Mode B: export from local MT5 history                            |
//|                                                                  |
//| Mode A writes exactly what is in the DB to:                      |
//|   MQL5\Files\tradzfx\<SYMBOL>_M1_<from>_<to>.csv            |
//|                                                                  |
//| After running, copy the CSV files from MQL5\Files\tradzfx\   |
//| and run: node scripts/verify-mt5-csv.js <csv-path>               |
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "2.00"
#property strict
#property script_show_inputs

input bool   InpFromServer  = false;                   // true = request CSV from app server
input string InpServerUrl   = "http://127.0.0.1:3003"; // tradzfx V2 server URL
input string InpApiKey      = "";                      // Server API key (if required)
input string InpSymbols     = "AUDUSD,EURUSD,GBPUSD,NZDUSD,USDCAD,USDCHF,USDJPY,USDSEK,XAUUSD";
input int    InpLookbackDays = 30;                     // Server mode: how many days back to request
input int    InpMaxBars      = 0;                      // Local mode: 0 = all available history
input string InpOutputDir    = "tradzfx";          // sub-folder under MQL5\Files
input bool   InpOpenCharts   = false;                  // Local mode: open temp charts to force history load

//+------------------------------------------------------------------+
//| Script entry point                                               |
//+------------------------------------------------------------------+
void OnStart()
{
   string symbols[];
   int n = StringSplit(InpSymbols, ',', symbols);

   string folder = InpOutputDir;
   if (StringLen(folder) > 0)
      FolderCreate(folder, FILE_COMMON);

   Print("Starting export for ", n, " symbols");

   for (int i = 0; i < n; i++)
   {
      string sym = symbols[i];
      StringToUpper(sym);
      if (StringLen(sym) == 0) continue;

      datetime fromTime = TimeCurrent() - (datetime)(InpLookbackDays * 24 * 3600);
      datetime toTime   = TimeCurrent();

      bool ok = false;
      if (InpFromServer)
         ok = ExportFromServer(sym, fromTime, toTime, folder);
      else
         ok = ExportFromLocal(sym, folder);

      if (ok)
         Print("Exported ", sym);
      else
         Print("FAILED to export ", sym);
   }

   Print("Export complete. Files are in MQL5\\Files\\", folder);
}

//+------------------------------------------------------------------+
//| Fetch CSV from app server and write to file                      |
//+------------------------------------------------------------------+
bool ExportFromServer(string sym, datetime fromTime, datetime toTime, string folder)
{
   string url = BuildServerUrl(sym, fromTime, toTime);
   string headers = "";
   if (StringLen(InpApiKey) > 0)
      headers = "X-API-Key: " + InpApiKey + "\r\n";

   char data[], result[];
   string resultHeaders;
   int status = WebRequest("GET", url, headers, 5000, data, result, resultHeaders);

   if (status != 200)
   {
      string body = CharArrayToString(result);
      Print("WARN: server request failed for ", sym, " status=", status, " body=", body);
      return false;
   }

   string filename = BuildFilename(folder, sym, fromTime, toTime);
   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if (handle == INVALID_HANDLE)
   {
      Print("ERROR: cannot open file: ", filename, " err=", GetLastError());
      return false;
   }

   FileWriteString(handle, CharArrayToString(result));
   FileClose(handle);
   return true;
}

//+------------------------------------------------------------------+
//| Build server URL with ISO-8601 timestamps and timezone offset    |
//+------------------------------------------------------------------+
string BuildServerUrl(string sym, datetime fromTime, datetime toTime)
{
   string base = InpServerUrl;
   if (StringGetCharacter(base, StringLen(base) - 1) == '/')
      StringSetCharacter(base, StringLen(base) - 1, 0);

   int offsetSec = TimeGMTOffset();
   string url = base + "/api/candles/export?";
   url += "symbol=" + sym;
   url += "&from=" + FormatISO(fromTime - (datetime)offsetSec); // request in UTC
   url += "&to=" + FormatISO(toTime - (datetime)offsetSec);
   url += "&tf=1m";
   url += "&tzOffsetSec=" + IntegerToString(offsetSec);          // output shifted to MT5 local time
   return url;
}

//+------------------------------------------------------------------+
//| Format datetime as ISO-8601 UTC string                           |
//+------------------------------------------------------------------+
string FormatISO(datetime t)
{
   string s = TimeToString(t, TIME_DATE|TIME_SECONDS);
   StringReplace(s, " ", "T");
   StringReplace(s, ".", "-");
   s += "Z";
   return s;
}

//+------------------------------------------------------------------+
//| Export from local MT5 history                                    |
//+------------------------------------------------------------------+
bool ExportFromLocal(string sym, string folder)
{
   if (SymbolInfoInteger(sym, SYMBOL_VISIBLE) == 0)
   {
      if (!SymbolSelect(sym, true))
      {
         Print("WARN: cannot select symbol: ", sym);
         return false;
      }
      Sleep(500);
   }

   // Wait up to 10 seconds for history to become available
   int attempts = 0;
   while (Bars(sym, PERIOD_M1) == 0 && attempts < 20)
   {
      Sleep(500);
      attempts++;
   }

   long chartId = 0;
   bool openedTempChart = false;
   if (Bars(sym, PERIOD_M1) == 0 && InpOpenCharts)
   {
      chartId = ChartOpen(sym, PERIOD_M1);
      if (chartId > 0)
      {
         openedTempChart = true;
         Sleep(1000);
      }
   }

   int available = Bars(sym, PERIOD_M1);
   if (available <= 0)
   {
      Print("WARN: no 1m history for ", sym);
      if (openedTempChart) ChartClose(chartId);
      return false;
   }

   int count = (InpMaxBars > 0 && InpMaxBars < available) ? InpMaxBars : available;

   MqlRates rates[];
   int copied = CopyRates(sym, PERIOD_M1, 0, count, rates);
   if (copied <= 0)
   {
      Print("WARN: CopyRates failed for ", sym, " err=", GetLastError());
      if (openedTempChart) ChartClose(chartId);
      return false;
   }
   ArraySetAsSeries(rates, true);

   datetime fromTime = rates[copied - 1].time;
   datetime toTime   = rates[0].time;

   string filename = BuildFilename(folder, sym, fromTime, toTime);
   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_COMMON|FILE_SHARE_READ|FILE_SHARE_WRITE);
   if (handle == INVALID_HANDLE)
   {
      Print("ERROR: cannot open file: ", filename, " err=", GetLastError());
      if (openedTempChart) ChartClose(chartId);
      return false;
   }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   FileWriteString(handle, "<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\r\n");

   for (int b = copied - 1; b >= 0; b--)
   {
      string dts = TimeToString(rates[b].time, TIME_DATE|TIME_SECONDS);
      string parts[];
      StringSplit(dts, ' ', parts);

      string line =
         parts[0] + "\t" +
         parts[1] + "\t" +
         DoubleToString(rates[b].open,  digits) + "\t" +
         DoubleToString(rates[b].high,  digits) + "\t" +
         DoubleToString(rates[b].low,   digits) + "\t" +
         DoubleToString(rates[b].close, digits) + "\t" +
         IntegerToString(rates[b].tick_volume) + "\t" +
         IntegerToString(rates[b].real_volume) + "\t" +
         IntegerToString(rates[b].spread) + "\r\n";

      FileWriteString(handle, line);
   }

   FileClose(handle);
   if (openedTempChart) ChartClose(chartId);
   return true;
}

//+------------------------------------------------------------------+
//| Build CSV filename matching MT5 export convention                |
//+------------------------------------------------------------------+
string BuildFilename(string folder, string sym, datetime fromTime, datetime toTime)
{
   string fromStr = TimeToString(fromTime, TIME_DATE|TIME_SECONDS);
   StringReplace(fromStr, " ", "");
   StringReplace(fromStr, ":", "");
   StringReplace(fromStr, ".", "");

   string toStr = TimeToString(toTime, TIME_DATE|TIME_SECONDS);
   StringReplace(toStr, " ", "");
   StringReplace(toStr, ":", "");
   StringReplace(toStr, ".", "");

   string path = sym + "_M1_" + fromStr + "_" + toStr + ".csv";
   if (StringLen(folder) > 0)
      path = folder + "\\" + path;
   return path;
}
//+------------------------------------------------------------------+
