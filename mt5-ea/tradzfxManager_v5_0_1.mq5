//+------------------------------------------------------------------+
//|                                            tradzfxManager.mq5|
//|                        Single server-managed EA for MT5 terminals|
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property link      "https://github.com/samkhowaja/tradzfx-v2"
#property version   "5.02"
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

//+------------------------------------------------------------------+
//| Inline helper library (flattened to avoid include path issues)   |
//+------------------------------------------------------------------+
//+------------------------------------------------------------------+
//| tradzfx Logger Include                                       |
//| Shared logging helpers for MT4/MT5 manager EAs                    |
//+------------------------------------------------------------------+

string TM_LOG_PREFIX = "tradzfxManager";

void TMSetPrefix(string prefix)
{
   TM_LOG_PREFIX = prefix;
}

void TMLogInfo(string msg)
{
   Print(TM_LOG_PREFIX + " [INFO]: " + msg);
}

void TMLogWarn(string msg)
{
   Print(TM_LOG_PREFIX + " [WARN]: " + msg);
}

void TMLogError(string msg)
{
   Print(TM_LOG_PREFIX + " [ERROR]: " + msg);
}

void TMLogTrade(string msg)
{
   Print(TM_LOG_PREFIX + " [TRADE]: " + msg);
}



//+------------------------------------------------------------------+
//| tradzfx Network / JSON Include                               |
//| Shared HTTP request and JSON extraction helpers for MT4/MT5       |
//+------------------------------------------------------------------+


// MT5 WebRequest signature: int WebRequest(string method, string url, string headers,
//                                          int timeout, char &data[], char &result[], string &resultHeaders);
// MT4 WebRequest signature: int WebRequest(string method, string url, string headers,
//                                          int timeout, char &data[], char &result[], string &resultHeaders);
// They are compatible in signature but MT4 requires URL allow-list in Tools > Options.

/**
 * Perform HTTP GET and return body as string.
 */
string TMHttpGet(string url, string apiKey, int timeoutMs = 10000)
{
   string headers = "X-API-Key: " + apiKey + "\r\n" + TMGetTerminalHeaders();
   char   data[];
   char   result[];
   string resultHeaders;

   int res = WebRequest("GET", url, headers, timeoutMs, data, result, resultHeaders);
   if(res != 200)
   {
      TMLogError("GET " + url + " failed HTTP " + IntegerToString(res) + " err " + IntegerToString(GetLastError()));
      return "";
   }
   g_lastSuccessfulServerContact = TimeCurrent();
   g_serverReachable = true;
   return CharArrayToString(result);
}

/**
 * Perform HTTP POST with JSON body and return body as string.
 */
string TMHttpPost(string url, string apiKey, string jsonBody, int timeoutMs = 10000)
{
   string headers = "Content-Type: application/json\r\nX-API-Key: " + apiKey + "\r\n" + TMGetTerminalHeaders();
   char   data[];
   char   result[];
   string resultHeaders;

   StringToCharArray(jsonBody, data, 0, StringLen(jsonBody));

   int res = WebRequest("POST", url, headers, timeoutMs, data, result, resultHeaders);
   if(res != 200)
   {
      TMLogError("POST " + url + " failed HTTP " + IntegerToString(res) + " err " + IntegerToString(GetLastError()));
      return "";
   }
   g_lastSuccessfulServerContact = TimeCurrent();
   g_serverReachable = true;
   return CharArrayToString(result);
}

/**
 * Retry an HTTP POST with exponential backoff for transient failures.
 * Returns the final response body or empty string if all attempts fail.
 */
string TMHttpPostWithRetry(string url, string apiKey, string jsonBody, int timeoutMs = 10000, int maxRetries = 3)
{
   string body = "";
   for(int attempt = 0; attempt <= maxRetries; attempt++)
   {
      body = TMHttpPost(url, apiKey, jsonBody, timeoutMs);
      if(StringLen(body) > 0) return body;

      if(attempt < maxRetries)
      {
         int delayMs = 500 * (1 << attempt); // 500, 1000, 2000
         TMLogWarn("POST retry " + IntegerToString(attempt + 1) + "/" + IntegerToString(maxRetries) +
                   " for " + url + " in " + IntegerToString(delayMs) + "ms");
         Sleep(delayMs);
      }
   }
   return "";
}

/**
 * Extract a string value from JSON: "key":"value".
 * Handles escaped quotes so malformed payloads cannot truncate values.
 */
string TMJsonString(string json, string key)
{
   string searchKey = "\"" + key + "\":\"";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return "";
   pos += StringLen(searchKey);

   int len = StringLen(json);
   string out = "";
   for(int i = pos; i < len; i++)
   {
      ushort c = StringGetCharacter(json, i);
      if(c == '\\' && i + 1 < len)
      {
         ushort next = StringGetCharacter(json, i + 1);
         if(next == '"' || next == '\\' || next == '/')
         {
            StringAdd(out, StringSubstr(json, i + 1, 1));
            i++;
            continue;
         }
      }
      if(c == '"') break;
      StringAdd(out, StringSubstr(json, i, 1));
   }
   return out;
}

/**
 * Extract a number value from JSON: "key":123 or "key":12.34
 */
double TMJsonDouble(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return 0.0;
   pos += StringLen(searchKey);
   // Skip whitespace
   while(pos < StringLen(json) && StringGetCharacter(json, pos) == ' ') pos++;

   int endPos = pos;
   while(endPos < StringLen(json))
   {
      ushort c = StringGetCharacter(json, endPos);
      if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E')
         endPos++;
      else
         break;
   }
   string numStr = StringSubstr(json, pos, endPos - pos);
   return StringToDouble(numStr);
}

/**
 * Extract a long value from JSON.
 */
long TMJsonLong(string json, string key)
{
   return (long)TMJsonDouble(json, key);
}

/**
 * Extract a boolean value from JSON: "key":true or "key":false
 */
bool TMJsonBool(string json, string key)
{
   string searchKey = "\"" + key + "\":";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return false;
   pos += StringLen(searchKey);
   while(pos < StringLen(json) && StringGetCharacter(json, pos) == ' ') pos++;

   if(StringSubstr(json, pos, 4) == "true") return true;
   if(StringSubstr(json, pos, 5) == "false") return false;
   return TMJsonDouble(json, key) != 0.0;
}

/**
 * Extract an array of strings from JSON: "key":["a","b","c"]
 * Returns count or fills up to maxItems. Use -1 for all.
 */
int TMJsonStringArray(string json, string key, string &out[], int maxItems = 50)
{
   ArrayResize(out, 0);
   string searchKey = "\"" + key + "\":[";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return 0;
   pos += StringLen(searchKey);

   int arrEnd = StringFind(json, "]", pos);
   if(arrEnd < 0) return 0;

   int count = 0;
   int searchPos = pos;
   while(searchPos < arrEnd && count < maxItems)
   {
      int q1 = StringFind(json, "\"", searchPos);
      if(q1 < 0 || q1 >= arrEnd) break;
      int q2 = StringFind(json, "\"", q1 + 1);
      if(q2 < 0 || q2 > arrEnd) break;

      string val = StringSubstr(json, q1 + 1, q2 - q1 - 1);
      ArrayResize(out, count + 1);
      out[count] = val;
      count++;
      searchPos = q2 + 1;
   }
   return count;
}



//+------------------------------------------------------------------+
//| tradzfx Symbol Helpers Include                               |
//| Broker symbol resolution, lot/pip/point helpers for MT4/MT5       |
//+------------------------------------------------------------------+


/**
 * Helper: test if a symbol can actually be used (visible / not disabled).
 */
bool TMSymbolIsUsable(string sym)
{
#ifdef __MQL5__
   if(!SymbolSelect(sym, true)) return false;
   long tradeMode = SymbolInfoInteger(sym, SYMBOL_TRADE_MODE);
   long visible = SymbolInfoInteger(sym, SYMBOL_VISIBLE);
   return (tradeMode != SYMBOL_TRADE_MODE_DISABLED) && (visible != 0);
#else
   return SymbolSelect(sym, true);
#endif
}

#ifdef __MQL5__
/**
 * Force MT5 to load a symbol's M1 history by opening (or reusing) a chart.
 * Some brokers only make 1-minute history available once a chart is open.
 */
long TMOpenChartForSymbol(string sym)
{
   long chart = ChartFirst();
   while(chart != -1)
   {
      if(ChartGetString(chart, (ENUM_CHART_PROPERTY_STRING)0) == sym)
         return chart;
      chart = ChartNext(chart);
   }
   long id = ChartOpen(sym, PERIOD_M1);
   if(id > 0)
      TMLogInfo("Opened M1 chart for " + sym + " id=" + IntegerToString((long)id));
   return id;
}
#endif

/**
 * Find the broker-specific symbol name from a canonical base symbol.
 * Tries exact match, common suffixes, then substring scan of Market Watch.
 */
string TMFindBrokerSymbol(string baseSym)
{
   if(StringLen(baseSym) == 0) return "";

   // Exact match
   if(TMSymbolIsUsable(baseSym)) return baseSym;

   // Known aliases for common indices/symbols
   if(baseSym == "DXY")
   {
      string dxyAliases[] = {"DX", "USDX", "USDINDEX", "DOLLAR", "US Dollar Index"};
      for(int a = 0; a < ArraySize(dxyAliases); a++)
         if(TMSymbolIsUsable(dxyAliases[a])) return dxyAliases[a];
   }

   // Common broker suffixes (Exness, 1xserver, IC Markets, etc.)
   string suffixes[];
   ArrayResize(suffixes, 28);
   suffixes[0]  = "m";
   suffixes[1]  = "M";
   suffixes[2]  = ".r";
   suffixes[3]  = ".i";
   suffixes[4]  = ".pro";
   suffixes[5]  = "_SB";
   suffixes[6]  = ".s";
   suffixes[7]  = ".a";
   suffixes[8]  = ".b";
   suffixes[9]  = "micro";
   suffixes[10] = ".";
   suffixes[11] = "-";
   suffixes[12] = "c";
   suffixes[13] = "f";
   suffixes[14] = "ecn";
   suffixes[15] = "+";
   suffixes[16] = "-STD";
   suffixes[17] = "-ECN";
   suffixes[18] = "-VIP";
   suffixes[19] = "-RAW";
   suffixes[20] = "-ZERO";
   suffixes[21] = "-PLUS";
   suffixes[22] = "-PRO";
   suffixes[23] = "-MINI";
   suffixes[24] = "-MICRO";
   suffixes[25] = "-CENT";
   suffixes[26] = "-R";
   suffixes[27] = "r";

   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string candidate = baseSym + suffixes[i];
      if(TMSymbolIsUsable(candidate)) return candidate;
   }

   // Substring scan — prefer exact-prefix names that are usable
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      if(StringFind(name, baseSym) == 0 && TMSymbolIsUsable(name))
         return name;
   }
   return "";
}

/**
 * Resolve broker symbol, preferring server-provided brokerSymbol if present.
 */
string TMResolveBrokerSymbol(string serverSymbol, string serverBrokerSymbol)
{
   if(StringLen(serverBrokerSymbol) > 0)
   {
      if(SymbolSelect(serverBrokerSymbol, true)) return serverBrokerSymbol;
      TMLogWarn("Server brokerSymbol '" + serverBrokerSymbol + "' not in Market Watch; falling back");
   }
   return TMFindBrokerSymbol(serverSymbol);
}

/**
 * Normalize lot size to broker constraints.
 */
double TMNormalizeLots(string symbol, double lots)
{
   #ifdef __MQL5__
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   #else
   double minLot = MarketInfo(symbol, MODE_MINLOT);
   double maxLot = MarketInfo(symbol, MODE_MAXLOT);
   double lotStep = MarketInfo(symbol, MODE_LOTSTEP);
   #endif

   if(lots < minLot) lots = minLot;
   if(lots > maxLot) lots = maxLot;
   if(lotStep > 0)
      lots = MathFloor(lots / lotStep + 0.5) * lotStep;
   return NormalizeDouble(lots, 2);
}

/**
 * Get point size for symbol.
 */
double TMPoint(string symbol)
{
   #ifdef __MQL5__
   return SymbolInfoDouble(symbol, SYMBOL_POINT);
   #else
   return MarketInfo(symbol, MODE_POINT);
   #endif
}

/**
 * Get digits for symbol.
 */
int TMDigits(string symbol)
{
   #ifdef __MQL5__
   return (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   #else
   return (int)MarketInfo(symbol, MODE_DIGITS);
   #endif
}

/**
 * Get pip size (0.0001 for 5/4 digit forex, 0.01 for 3/2 digit JPY pairs, 1.0 for XAU/indices with 2 digits).
 */
double TMPipSize(string symbol)
{
   int digits = TMDigits(symbol);
   double point = TMPoint(symbol);
   if(digits == 5 || digits == 4) return point * 10.0;
   if(digits == 3 || digits == 2) return point * 10.0;
   return point;
}

/**
 * Convert price difference to pips.
 */
double TMPriceToPips(string symbol, double priceDiff)
{
   return priceDiff / TMPipSize(symbol);
}

/**
 * Get current spread in pips.
 */
double TMSpreadPips(string symbol)
{
   #ifdef __MQL5__
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   #else
   double ask = MarketInfo(symbol, MODE_ASK);
   double bid = MarketInfo(symbol, MODE_BID);
   #endif
   return TMPriceToPips(symbol, ask - bid);
}

/**
 * Get the broker's minimum price increment (tick size).
 */
double TMTickSize(string symbol)
{
   #ifdef __MQL5__
   return SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   #else
   return MarketInfo(symbol, MODE_TICKSIZE);
   #endif
}

/**
 * Normalize a price to the symbol's tick size.
 */
double TMNormalizePrice(string symbol, double price)
{
   double tickSize = TMTickSize(symbol);
   if(tickSize > 0)
      price = MathRound(price / tickSize) * tickSize;
   return NormalizeDouble(price, TMDigits(symbol));
}

/**
 * Adjust SL/TP so they respect the broker's SYMBOL_TRADE_STOPS_LEVEL.
 * Mutates sl and tp in place. Returns false if the levels are fundamentally invalid.
 */
bool TMNormalizeStopLevels(string symbol, double price, double &sl, double &tp, string side)
{
   #ifdef __MQL5__
   int stopsLevel = (int)SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   #else
   int stopsLevel = (int)MarketInfo(symbol, MODE_STOPLEVEL);
   #endif
   if(stopsLevel <= 0) return true;

   double point = TMPoint(symbol);
   double tickSize = TMTickSize(symbol);
   double minDist = stopsLevel * point;
   if(tickSize > 0)
      minDist = MathCeil(minDist / tickSize) * tickSize;

   bool isBuy = (side == "buy" || side == "BUY");

   if(sl > 0)
   {
      double minSl = isBuy ? price - minDist : price + minDist;
      if((isBuy && sl > minSl) || (!isBuy && sl < minSl))
      {
         TMLogWarn("SL too close to market (" + DoubleToString(sl, TMDigits(symbol)) +
                   "), normalizing to " + DoubleToString(minSl, TMDigits(symbol)));
         sl = minSl;
      }
   }
   if(tp > 0)
   {
      double minTp = isBuy ? price + minDist : price - minDist;
      if((isBuy && tp < minTp) || (!isBuy && tp > minTp))
      {
         TMLogWarn("TP too close to market (" + DoubleToString(tp, TMDigits(symbol)) +
                   "), normalizing to " + DoubleToString(minTp, TMDigits(symbol)));
         tp = minTp;
      }
   }

   sl = TMNormalizePrice(symbol, sl);
   tp = TMNormalizePrice(symbol, tp);
   return true;
}

#ifdef __MQL5__
/**
 * Attempt OrderSend with each allowed fill mode until one succeeds or
 * the broker rejects the request for a non-fill reason.
 */
bool TMTryOrderSend(MqlTradeRequest &req, MqlTradeResult &res, string symbol)
{
   uint allowed = (uint)SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);

   int modes[3];
   int modeCount = 0;
   if(req.action == TRADE_ACTION_PENDING)
   {
      // Pending orders normally use RETURN; fall back to FOK/IOC if required.
      modes[0] = ORDER_FILLING_RETURN;
      modes[1] = ORDER_FILLING_FOK;
      modes[2] = ORDER_FILLING_IOC;
      modeCount = 3;
   }
   else
   {
      // Market orders: prefer IOC, then FOK, then RETURN.
      modes[0] = ORDER_FILLING_IOC;
      modes[1] = ORDER_FILLING_FOK;
      modes[2] = ORDER_FILLING_RETURN;
      modeCount = 3;
   }

   for(int i = 0; i < modeCount; i++)
   {
      int mode = modes[i];
      uint flag = 0;
      if(mode == ORDER_FILLING_IOC) flag = SYMBOL_FILLING_IOC;
      else if(mode == ORDER_FILLING_FOK) flag = SYMBOL_FILLING_FOK;
      // There is no SYMBOL_FILLING_RETURN constant; ORDER_FILLING_RETURN is always attempted.
      else if(mode == ORDER_FILLING_RETURN) flag = 0;

      // If the broker advertises supported modes and this one is not listed, skip it.
      if(allowed != 0 && (allowed & flag) == 0) continue;

      req.type_filling = (ENUM_ORDER_TYPE_FILLING)mode;
      ZeroMemory(res);
      if(OrderSend(req, res)) return true;

      if(res.retcode != TRADE_RETCODE_INVALID_FILL)
         break;
   }
   return false;
}
#endif

/**
 * Get current price (ask for buy, bid for sell).
 */
double TMCurrentPrice(string symbol, bool isBuy)
{
   #ifdef __MQL5__
   return isBuy ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   #else
   return isBuy ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);
   #endif
}

/**
 * Get the actual open price of a filled position by ticket.
 */
double TMPositionOpenPrice(long ticket)
{
   #ifdef __MQL5__
   if(PositionSelectByTicket((ulong)ticket))
      return PositionGetDouble(POSITION_PRICE_OPEN);
   return 0.0;
   #else
   if(OrderSelect((int)ticket, SELECT_BY_TICKET))
      return OrderOpenPrice();
   return 0.0;
   #endif
}



//+------------------------------------------------------------------+
//| tradzfx Trade Execution Include                              |
//| Open/close/modify position abstractions for MT4/MT5               |
//+------------------------------------------------------------------+


//+------------------------------------------------------------------+
//| Open a market order                                                |
//| Returns ticket (>0) on success, 0 on failure                       |
//+------------------------------------------------------------------+
long TMOpenMarket(string symbol, string side, double lots, double sl, double tp,
                  int slippagePoints, string comment, ulong magic, int &retcodeOut)
{
   bool isBuy = (side == "buy" || side == "BUY");
   double price = TMCurrentPrice(symbol, isBuy);

   // Ensure SL/TP respect broker stop-level before sending.
   TMNormalizeStopLevels(symbol, price, sl, tp, side);

   #ifdef __MQL5__
   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_DEAL;
   req.symbol = symbol;
   req.volume = lots;
   req.type = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price = price;
   req.sl = sl;
   req.tp = tp;
   req.deviation = slippagePoints;
   req.magic = magic;
   req.comment = comment;

   if(TMTryOrderSend(req, res, symbol))
   {
      long ticket = (long)res.deal;
      if(ticket == 0) ticket = (long)res.order;
      retcodeOut = 0;
      return ticket;
   }
   retcodeOut = (int)res.retcode;
   TMLogError("OrderSend failed: " + IntegerToString(res.retcode));
   return 0;

   #else // __MQL4__
   double price = isBuy ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);
   int cmd = isBuy ? OP_BUY : OP_SELL;
   color clr = isBuy ? clrGreen : clrRed;
   int ticket = OrderSend(symbol, cmd, lots, price, slippagePoints, sl, tp, comment, (int)magic, 0, clr);
   if(ticket < 0)
   {
      retcodeOut = GetLastError();
      TMLogError("OrderSend failed: " + IntegerToString(retcodeOut));
      return 0;
   }
   retcodeOut = 0;
   return ticket;
   #endif
}

//+------------------------------------------------------------------+
//| Open a pending limit order (MT5) or market fallback (MT4)          |
//+------------------------------------------------------------------+
long TMOpenLimit(string symbol, string side, double lots, double limitPrice,
                 double sl, double tp, string comment, ulong magic,
                 string tif, datetime expiration, int &retcodeOut)
{
   bool isBuy = (side == "buy" || side == "BUY");

   // Normalize SL/TP to the limit entry price so they pass broker stop-level checks.
   TMNormalizeStopLevels(symbol, limitPrice, sl, tp, side);

   #ifdef __MQL5__
   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_PENDING;
   req.symbol = symbol;
   req.volume = lots;
   req.type = isBuy ? ORDER_TYPE_BUY_LIMIT : ORDER_TYPE_SELL_LIMIT;
   req.price = TMNormalizePrice(symbol, limitPrice);
   req.sl = sl;
   req.tp = tp;
   req.magic = magic;
   req.comment = comment;

   if(tif == "GTC")
      req.type_time = ORDER_TIME_GTC;
   else if(tif == "DAY")
      req.type_time = ORDER_TIME_DAY;
   else if(tif == "SPECIFIED")
   {
      req.type_time = ORDER_TIME_SPECIFIED;
      req.expiration = expiration;
   }
   else
      req.type_time = ORDER_TIME_GTC;

   if(TMTryOrderSend(req, res, symbol))
   {
      long ticket = (long)res.order;
      if(ticket == 0) ticket = (long)res.deal;
      retcodeOut = 0;
      return ticket;
   }
   retcodeOut = (int)res.retcode;
   TMLogError("OrderSend limit failed: " + IntegerToString(res.retcode));
   return 0;

   #else // __MQL4__
   // MT4: place a pending order. Expiration 0 means no expiration.
   int cmd = isBuy ? OP_BUYLIMIT : OP_SELLLIMIT;
   color clr = isBuy ? clrGreen : clrRed;
   datetime mt4Exp = (tif == "GTC" || tif == "DAY") ? 0 : expiration;
   int ticket = OrderSend(symbol, cmd, lots, limitPrice, 0, sl, tp, comment, (int)magic, mt4Exp, clr);
   if(ticket < 0)
   {
      retcodeOut = GetLastError();
      TMLogError("OrderSend limit failed: " + IntegerToString(retcodeOut));
      return 0;
   }
   retcodeOut = 0;
   return ticket;
   #endif
}

//+------------------------------------------------------------------+
//| Close a position by ticket (MT5) or by repeated OrderClose (MT4)   |
//+------------------------------------------------------------------+
bool TMClosePosition(long ticket, string symbol, double lots, int slippagePoints, string reason)
{
   #ifdef __MQL5__
   if(!PositionSelectByTicket((ulong)ticket))
   {
      TMLogError("Close: position ticket " + IntegerToString(ticket) + " not found");
      return false;
   }

   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_DEAL;
   req.position = ticket;
   req.symbol = symbol;
   req.volume = lots;
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   bool isLong = (posType == POSITION_TYPE_BUY);
   req.type = isLong ? ORDER_TYPE_SELL : ORDER_TYPE_BUY;
   req.price = isLong ? SymbolInfoDouble(symbol, SYMBOL_BID) : SymbolInfoDouble(symbol, SYMBOL_ASK);
   req.deviation = slippagePoints;
   req.comment = "Close " + reason;

   bool ok = TMTryOrderSend(req, res, symbol);
   if(!ok)
      TMLogError("Close failed: " + IntegerToString(res.retcode));
   return ok && (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);

   #else // __MQL4__
   if(!OrderSelect((int)ticket, SELECT_BY_TICKET))
   {
      TMLogError("Close: order ticket " + IntegerToString(ticket) + " not found");
      return false;
   }
   bool isLong = (OrderType() == OP_BUY);
   double price = isLong ? MarketInfo(symbol, MODE_BID) : MarketInfo(symbol, MODE_ASK);
   color clr = isLong ? clrRed : clrGreen;
   bool ok = OrderClose((int)ticket, lots, price, slippagePoints, clr);
   if(!ok)
      TMLogError("OrderClose failed: " + IntegerToString(GetLastError()));
   return ok;
   #endif
}

//+------------------------------------------------------------------+
//| Cancel a pending order by ticket (MT5) or OrderDelete (MT4)        |
//+------------------------------------------------------------------+
bool TMCancelPendingOrder(long ticket, int &retcodeOut)
{
   #ifdef __MQL5__
   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_REMOVE;
   req.order = (ulong)ticket;

   if(!OrderSend(req, res))
   {
      retcodeOut = (int)res.retcode;
      TMLogError("Cancel pending order failed: " + IntegerToString(res.retcode));
      return false;
   }
   retcodeOut = 0;
   return (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);

   #else // __MQL4__
   bool ok = OrderDelete((int)ticket);
   if(!ok)
   {
      retcodeOut = GetLastError();
      TMLogError("OrderDelete failed: " + IntegerToString(retcodeOut));
   }
   else
      retcodeOut = 0;
   return ok;
   #endif
}

//+------------------------------------------------------------------+
//| Modify stop loss / take profit                                     |
//+------------------------------------------------------------------+
bool TMModifySLTP(long ticket, double newSl, double newTp)
{
   #ifdef __MQL5__
   if(!PositionSelectByTicket((ulong)ticket)) return false;
   string symbol = PositionGetString(POSITION_SYMBOL);
   ENUM_POSITION_TYPE posType = (ENUM_POSITION_TYPE)PositionGetInteger(POSITION_TYPE);
   bool isBuy = (posType == POSITION_TYPE_BUY);
   double price = TMCurrentPrice(symbol, isBuy);
   string side = isBuy ? "buy" : "sell";

   // Validate/adjust new SL/TP against broker stop-level before sending.
   TMNormalizeStopLevels(symbol, price, newSl, newTp, side);

   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_SLTP;
   req.position = ticket;
   req.symbol = symbol;
   req.sl = newSl;
   req.tp = newTp;

   if(!OrderSend(req, res))
   {
      TMLogError("Modify SL/TP failed: " + IntegerToString(res.retcode));
      return false;
   }
   return true;

   #else // __MQL4__
   if(!OrderSelect((int)ticket, SELECT_BY_TICKET)) return false;
   bool ok = OrderModify((int)ticket, OrderOpenPrice(), newSl, newTp, 0, clrBlue);
   if(!ok)
      TMLogError("OrderModify failed: " + IntegerToString(GetLastError()));
   return ok;
   #endif
}

//+------------------------------------------------------------------+
//| Count open positions for a magic number                            |
//+------------------------------------------------------------------+
int TMCountPositions(ulong magic, string symbol = "")
{
   int count = 0;
   #ifdef __MQL5__
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != (long)magic) continue;
      if(StringLen(symbol) > 0 && PositionGetString(POSITION_SYMBOL) != symbol) continue;
      count++;
   }
   #else // __MQL4__
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      if(!OrderSelect(i, SELECT_BY_POS, MODE_TRADES)) continue;
      if(OrderMagicNumber() != (int)magic) continue;
      if(StringLen(symbol) > 0 && OrderSymbol() != symbol) continue;
      if(OrderType() != OP_BUY && OrderType() != OP_SELL) continue;
      count++;
   }
   #endif
   return count;
}

//+------------------------------------------------------------------+
//| Inputs                                                             |
//+------------------------------------------------------------------+
input string InpServerUrl = "http://127.0.0.1:3003"; // tradzfx V2 server URL
input string InpSymbols   = "";                      // Comma-separated symbols to sync (empty = use server config)
input string InpApiKey    = ""; // API key (auto-registered if blank)
input string InpApiKeyFile = "tz_api_key.txt";       // File used to cache the auto-registered API key
input bool   InpAutoRegister = true;                 // Allow EA to self-register and receive an API key from the server
input string InpTerminalLabel = "";                  // Friendly label for a newly registered terminal
input ulong  InpMagic     = 202633;                  // Magic number for orders
input string InpMode      = "primary";               // primary (write bars/exec) | verify (heartbeat/config only)
input bool   InpOpenCharts = true;                   // Open an M1 chart per symbol to force history load (disable to avoid extra chart windows)

string g_effectiveApiKeyFile = "";                   // Resolved key file (per-terminal when default is used)
string g_serverUrl = "";                              // Normalized server URL used at runtime
bool   g_primaryMode = true;                          // true when InpMode == "primary"

//+------------------------------------------------------------------+
//| Constants                                                          |
//+------------------------------------------------------------------+
#define EA_VERSION       "5.0.2"
#define HEARTBEAT_SEC    30
#define CONFIG_POLL_SEC  120
#define CONFIG_MAX_BACKOFF 600
#define STATUS_REPORT_SEC 120

//+------------------------------------------------------------------+
//| Manager config state (mirrors server config.manager)               |
//+------------------------------------------------------------------+
struct ManagerConfig
{
   bool     enabled;
   string   mode;
   string   symbols[50];
   int      symbolCount;

   bool     syncEnabled;
   int      syncIntervalSec;
   int      backfillDays;
   int      batchSize;

   bool     execEnabled;
   int      execPollSec;
   double   maxSpreadPips;
   int      maxSlippagePoints;
   double   maxSignalEntrySlippagePips;
   double   minEffectiveRiskReward;
   bool     allowLimitOrders;
   string   defaultTimeInForce;
   double   defaultLots;

   bool     commandsEnabled;
   int      commandsPollSec;
};

//+------------------------------------------------------------------+
//| Per-symbol sync state                                              |
//+------------------------------------------------------------------+
struct SymbolSyncState
{
   string   canonical;
   string   broker;
   datetime lastSyncTime;
   bool     backfillDone;
};

//+------------------------------------------------------------------+
//| Server-commanded targeted backfill request                         |
//+------------------------------------------------------------------+
struct BackfillRequest
{
   string   jobId;
   string   symbol;
   long     fromMs;
   long     toMs;
};

//+------------------------------------------------------------------+
//| Globals                                                            |
//+------------------------------------------------------------------+
ManagerConfig g_cfg;
SymbolSyncState g_syncState[50];
int g_syncSymbolCount = 0;

BackfillRequest g_backfillRequests[20];
int g_backfillRequestCount = 0;

long g_serverOffsetSec = 0; // broker time - UTC (updated each sync)

datetime g_lastHeartbeat = 0;
datetime g_lastConfigPoll = 0;
datetime g_lastSignalPoll = 0;
datetime g_lastCommandPoll = 0;
datetime g_lastStatusReport = 0;
int      g_configPollFailures = 0;
datetime g_lastSuccessfulServerContact = 0;
bool     g_serverReachable = true;
int      g_totalSignalsReceived = 0;
int      g_totalOrdersSent = 0;
int      g_totalOrdersRejected = 0;
string   g_lastError = "";
long     g_lastAckCommandSequence = 0;

string g_effectiveApiKey = "";

//+------------------------------------------------------------------+
//| Read API key from a file in the terminal Common folder             |
//+------------------------------------------------------------------+
string TmStringToLower(string s)
{
   for(int i = 0; i < StringLen(s); i++)
   {
      ushort c = StringGetCharacter(s, i);
      if(c >= 'A' && c <= 'Z')
      {
         c = c + ('a' - 'A');
         StringSetCharacter(s, i, c);
      }
   }
   return s;
}

string TmStringTrim(string s)
{
   int start = 0;
   int end = StringLen(s) - 1;
   while(start <= end)
   {
      ushort c = StringGetCharacter(s, start);
      if(c != ' ' && c != '\t' && c != '\n' && c != '\r')
         break;
      start++;
   }
   while(end >= start)
   {
      ushort c = StringGetCharacter(s, end);
      if(c != ' ' && c != '\t' && c != '\n' && c != '\r')
         break;
      end--;
   }
   if(start > end) return "";
   return StringSubstr(s, start, end - start + 1);
}

int ParseSymbolList(string csv, string &out[], int maxCount)
{
   int count = 0;
   string remaining = csv;
   while(StringLen(remaining) > 0 && count < maxCount)
   {
      int pos = StringFind(remaining, ",");
      string sym;
      if(pos < 0)
      {
         sym = remaining;
         remaining = "";
      }
      else
      {
         sym = StringSubstr(remaining, 0, pos);
         remaining = StringSubstr(remaining, pos + 1);
      }
      sym = TmStringTrim(sym);
      if(StringLen(sym) > 0)
      {
         out[count] = sym;
         count++;
      }
   }
   return count;
}

string NormalizeServerUrl(string url)
{
   int len = StringLen(url);
   while(len > 0)
   {
      ushort c = StringGetCharacter(url, len - 1);
      if(c == '/' || c == ' ' || c == '\t' || c == '\n' || c == '\r')
         url = StringSubstr(url, 0, len - 1);
      else
         break;
      len = StringLen(url);
   }

   // Preserve the port when normalizing localhost -> 127.0.0.1.
   // The previous implementation silently dropped :3003, breaking local dev.
   string lower = TmStringToLower(url);
   if(StringFind(lower, "http://localhost") == 0)
      url = "http://127.0.0.1" + StringSubstr(url, 16);
   else if(StringFind(lower, "https://localhost") == 0)
      url = "https://127.0.0.1" + StringSubstr(url, 17);

   return url;
}

//+------------------------------------------------------------------+
//| Read API key from a file in the terminal Common folder             |
//+------------------------------------------------------------------+
string ReadApiKeyFromFile(string filename)
{
   int handle = FileOpen(filename, FILE_READ|FILE_TXT|FILE_COMMON);
   if(handle == INVALID_HANDLE)
   {
      handle = FileOpen(filename, FILE_READ|FILE_TXT);
   }
   if(handle == INVALID_HANDLE) return "";
   string key = FileReadString(handle);
   FileClose(handle);
   // Strip UTF-8/UTF-16 BOM and leading whitespace that may have been written by older versions.
   while(StringLen(key) > 0)
   {
      ushort c = StringGetCharacter(key, 0);
      if(c == 0xFEFF || c == 0xFFFE || c == 0x200B || c == 0x200C || c == 0x200D || c <= 32)
         key = StringSubstr(key, 1);
      else
         break;
   }
   return key;
}

//+------------------------------------------------------------------+
//| Write API key to a file in the terminal Common folder              |
//+------------------------------------------------------------------+
bool WriteApiKeyToFile(string filename, string key)
{
   int handle = FileOpen(filename, FILE_WRITE|FILE_TXT|FILE_COMMON);
   if(handle == INVALID_HANDLE)
      handle = FileOpen(filename, FILE_WRITE|FILE_TXT);
   if(handle == INVALID_HANDLE) return false;
   FileWriteString(handle, key);
   FileClose(handle);
   return true;
}

//+------------------------------------------------------------------+
//| Auto-register this terminal with the server and obtain an API key  |
//+------------------------------------------------------------------+
string AutoRegister()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   long leverage  = AccountInfoInteger(ACCOUNT_LEVERAGE);
   long login     = AccountInfoInteger(ACCOUNT_LOGIN);
   string server  = AccountInfoString(ACCOUNT_SERVER);
   string broker  = AccountInfoString(ACCOUNT_COMPANY);
   string currency= AccountInfoString(ACCOUNT_CURRENCY);
   ENUM_ACCOUNT_TRADE_MODE tradeMode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string acctType = tradeMode == ACCOUNT_TRADE_MODE_DEMO ? "demo" : "real";

   string label = InpTerminalLabel;
   if(StringLen(label) == 0)
      label = "MT5 " + broker + " " + IntegerToString(login);

   string json = "{";
   json += "\"platform\":\"mt5\",";
   json += "\"accountNumber\":\"" + IntegerToString(login) + "\",";
   json += "\"broker\":\"" + broker + "\",";
   json += "\"brokerServer\":\"" + server + "\",";
   json += "\"accountType\":\"" + acctType + "\",";
   json += "\"currency\":\"" + currency + "\",";
   json += "\"leverage\":" + IntegerToString(leverage) + ",";
   json += "\"label\":\"" + label + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2);
   json += "}";

   string url = g_serverUrl + "/api/ingest/mt5/register";
   string body = TMHttpPost(url, "", json, 15000);
   if(StringLen(body) == 0)
   {
      TMLogError("Auto-registration failed: no response");
      return "";
   }

   if(StringFind(body, "\"ok\":true") < 0)
   {
      TMLogError("Auto-registration failed: " + body);
      return "";
   }

   string apiKey = TMJsonString(body, "apiKey");
   if(StringLen(apiKey) == 0)
   {
      TMLogError("Auto-registration returned empty apiKey");
      return "";
   }

   if(WriteApiKeyToFile(g_effectiveApiKeyFile, apiKey))
      TMLogInfo("API key cached to " + g_effectiveApiKeyFile);
   else
      TMLogWarn("Could not cache API key to file");

   return apiKey;
}

//+------------------------------------------------------------------+
//| Expert initialization function                                     |
//+------------------------------------------------------------------+
int OnInit()
{
   TMSetPrefix("tradzfxManager");

   // Refuse to run inside the Strategy Tester — WebRequest/time behave differently there
   // and the tester cannot push live market data to the server.
   if(MQLInfoInteger(MQL_TESTER))
   {
      Alert(EA_VERSION + ": This EA must be attached to a live chart, not the Strategy Tester.");
      return(INIT_FAILED);
   }

   // Use a per-terminal key file so multiple platforms/accounts don't clobber each other.
   g_effectiveApiKeyFile = InpApiKeyFile;
   if(g_effectiveApiKeyFile == "tz_api_key.txt")
   {
      long login = AccountInfoInteger(ACCOUNT_LOGIN);
      g_effectiveApiKeyFile = "tz_api_key_mt5_" + IntegerToString((int)login) + ".txt";
   }

   g_effectiveApiKey = InpApiKey;
   if(StringLen(g_effectiveApiKey) == 0 && StringLen(g_effectiveApiKeyFile) > 0)
   {
      g_effectiveApiKey = ReadApiKeyFromFile(g_effectiveApiKeyFile);
   }

   if(StringLen(g_effectiveApiKey) == 0 && InpAutoRegister)
   {
      TMLogInfo("No API key found; attempting auto-registration...");
      g_effectiveApiKey = AutoRegister();
   }

   string serverUrl = InpServerUrl;
   if(StringLen(serverUrl) == 0)
      serverUrl = "http://127.0.0.1:3003";
   g_serverUrl = NormalizeServerUrl(serverUrl);

   if(StringLen(g_serverUrl) == 0 || StringLen(g_effectiveApiKey) == 0)
   {
      Alert(EA_VERSION + ": InpServerUrl required. Provide InpApiKey, cached key file, or enable InpAutoRegister.");
      return INIT_PARAMETERS_INCORRECT;
   }

   string modeLower = TmStringToLower(InpMode);
   g_primaryMode = (modeLower == "primary");
   if(!g_primaryMode && modeLower != "verify")
   {
      Alert(EA_VERSION + ": InpMode must be 'primary' or 'verify'");
      return INIT_PARAMETERS_INCORRECT;
   }

   TMLogInfo("Starting v" + EA_VERSION + " — server " + g_serverUrl + " — mode " + (g_primaryMode ? "primary" : "verify"));

   ApplyDefaultConfig();
   g_lastSuccessfulServerContact = TimeCurrent();
   g_serverOffsetSec = (long)TimeCurrent() - (long)TimeGMT();
   EventSetTimer(1);

   // Bootstrap: send heartbeat and fetch config immediately
   SendHeartbeat();
   PollConfig();

   // If API key was loaded from file, do not expose it in input logs
   if(StringLen(InpApiKey) == 0 && StringLen(g_effectiveApiKeyFile) > 0)
      TMLogInfo("API key loaded from file: " + g_effectiveApiKeyFile);

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                   |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   TMLogInfo("Stopped (reason " + IntegerToString(reason) + ")");
}

//+------------------------------------------------------------------+
//| Timer handler — orchestrates all periodic work                     |
//+------------------------------------------------------------------+
#ifdef __MQL5__
/**
 * Cancel all pending orders placed by this EA so they cannot fill while the
 * server is unreachable and unable to track them.
 */
void TMCancelOwnPendingOrders()
{
   for(int i = OrdersTotal() - 1; i >= 0; i--)
   {
      ulong ticket = OrderGetTicket(i);
      if(ticket == 0) continue;
      if(OrderGetInteger(ORDER_MAGIC) != (long)InpMagic) continue;
      long type = OrderGetInteger(ORDER_TYPE);
      if(type != ORDER_TYPE_BUY_LIMIT && type != ORDER_TYPE_SELL_LIMIT &&
         type != ORDER_TYPE_BUY_STOP && type != ORDER_TYPE_SELL_STOP)
         continue;

      MqlTradeRequest req = {};
      MqlTradeResult res = {};
      req.action = TRADE_ACTION_REMOVE;
      req.order = ticket;
      if(!OrderSend(req, res))
         TMLogError("Watchdog cancel pending order " + IntegerToString(ticket) + " failed: " + IntegerToString(res.retcode));
   }
}
#endif

/**
 * Server-reachability watchdog. If no HTTP request has succeeded for 120
 * seconds, mark the server unreachable, cancel pending orders, and alert.
 * New signal execution is blocked until contact is restored.
 */
void TMCheckServerWatchdog()
{
   datetime now = TimeCurrent();
   if(g_lastSuccessfulServerContact == 0)
   {
      // No contact yet since startup; assume reachable until first failure window elapses.
      g_serverReachable = true;
      return;
   }

   const int WATCHDOG_TIMEOUT_SEC = 120;
   bool wasReachable = g_serverReachable;
   g_serverReachable = (now - g_lastSuccessfulServerContact) <= WATCHDOG_TIMEOUT_SEC;

   if(wasReachable && !g_serverReachable)
   {
      TMLogError("WATCHDOG: server unreachable for " + IntegerToString(WATCHDOG_TIMEOUT_SEC) +
                 "s. Cancelling pending orders and blocking new signals.");
      #ifdef __MQL5__
      TMCancelOwnPendingOrders();
      #endif
   }
}

void OnTimer()
{
   datetime now = TimeCurrent();

   if(now - g_lastHeartbeat >= HEARTBEAT_SEC)
   {
      SendHeartbeat();
      g_lastHeartbeat = now;
   }

   int configInterval = CONFIG_POLL_SEC;
   if(g_configPollFailures > 0)
      configInterval = MathMin(CONFIG_POLL_SEC * (int)MathPow(2, g_configPollFailures), CONFIG_MAX_BACKOFF);

   if(now - g_lastConfigPoll >= configInterval)
   {
      PollConfig();
      g_lastConfigPoll = now;
   }

   if(g_cfg.enabled)
   {
      if(g_primaryMode)
      {
         if(g_cfg.execEnabled && now - g_lastSignalPoll >= g_cfg.execPollSec)
         {
            PollSignals();
            g_lastSignalPoll = now;
         }

         if(g_cfg.commandsEnabled && now - g_lastCommandPoll >= g_cfg.commandsPollSec)
         {
            PollCommands();
            g_lastCommandPoll = now;
         }

         if(g_cfg.syncEnabled)
            SyncAllSymbols();

         ProcessBackfillRequests();
      }
   }

   if(now - g_lastStatusReport >= STATUS_REPORT_SEC)
   {
      ReportStatus();
      g_lastStatusReport = now;
   }

   TMCheckServerWatchdog();
   UpdateStatusComment();
}

//+------------------------------------------------------------------+
//| Apply safe default config                                          |
//+------------------------------------------------------------------+
void ApplyDefaultConfig()
{
   g_cfg.enabled = true;
   g_cfg.mode = "paper";
   g_cfg.symbolCount = 0;

   g_cfg.syncEnabled = true;
   g_cfg.syncIntervalSec = 60;
   g_cfg.backfillDays = 90;
   g_cfg.batchSize = 2000;

   g_cfg.execEnabled = true;
   g_cfg.execPollSec = 3;
   g_cfg.maxSpreadPips = 3.0;
   g_cfg.maxSlippagePoints = 20;
   g_cfg.maxSignalEntrySlippagePips = 2.0;
   g_cfg.minEffectiveRiskReward = 1.0;
   g_cfg.allowLimitOrders = true;
   g_cfg.defaultTimeInForce = "GTC";
   g_cfg.defaultLots = 0.01;

   g_cfg.commandsEnabled = true;
   g_cfg.commandsPollSec = 10;
}

//+------------------------------------------------------------------+
//| Heartbeat                                                          |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   long leverage  = AccountInfoInteger(ACCOUNT_LEVERAGE);
   long login     = AccountInfoInteger(ACCOUNT_LOGIN);
   string server  = AccountInfoString(ACCOUNT_SERVER);
   string broker  = AccountInfoString(ACCOUNT_COMPANY);
   string currency= AccountInfoString(ACCOUNT_CURRENCY);

   ENUM_ACCOUNT_TRADE_MODE tradeMode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string acctType = "unknown";
   if(tradeMode == ACCOUNT_TRADE_MODE_DEMO)   acctType = "demo";
   if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) acctType = "contest";
   if(tradeMode == ACCOUNT_TRADE_MODE_REAL)    acctType = "real";

   string symbolsJson = "[";
   for(int i = 0; i < g_cfg.symbolCount; i++)
   {
      if(i > 0) symbolsJson += ",";
      symbolsJson += "\"" + g_cfg.symbols[i] + "\"";
   }
   symbolsJson += "]";

   string json = "{";
   json += "\"platform\":\"mt5\",";
   json += "\"version\":\"" + EA_VERSION + "\",";
   json += "\"balance\":" + DoubleToString(balance, 2) + ",";
   json += "\"equity\":" + DoubleToString(equity, 2) + ",";
   json += "\"leverage\":" + IntegerToString(leverage) + ",";
   json += "\"accountNumber\":\"" + IntegerToString(login) + "\",";
   json += "\"brokerServer\":\"" + server + "\",";
   json += "\"broker\":\"" + broker + "\",";
   json += "\"accountType\":\"" + acctType + "\",";
   json += "\"currency\":\"" + currency + "\",";
   json += "\"symbolsActive\":" + symbolsJson + ",";
   json += "\"errors\":" + IntegerToString(g_lastError == "" ? 0 : 1);
   json += "}";

   string url = g_serverUrl + "/api/ingest/heartbeat";
   TMHttpPost(url, g_effectiveApiKey, json, 5000);
}

//+------------------------------------------------------------------+
//| Poll server config                                                 |
//+------------------------------------------------------------------+
void PollConfig()
{
   string url = g_serverUrl + "/api/ingest/config";
   string body = TMHttpGet(url, g_effectiveApiKey, 10000);
   if(StringLen(body) == 0)
   {
      g_configPollFailures++;
      return;
   }

   if(StringFind(body, "\"ok\":true") < 0)
   {
      g_configPollFailures++;
      return;
   }

   g_configPollFailures = 0;

   // Legacy top-level fields
   g_cfg.enabled = !TMJsonBool(body, "paused");

   // Manager config section
   string mgrJson = ExtractJsonObject(body, "manager");
   if(StringLen(mgrJson) > 0)
   {
      g_cfg.enabled = TMJsonBool(mgrJson, "enabled");
      string mode = TMJsonString(mgrJson, "mode");
      if(mode == "paper" || mode == "live") g_cfg.mode = mode;

      int symCount = TMJsonStringArray(mgrJson, "symbols", g_cfg.symbols, 50);
      g_cfg.symbolCount = symCount;

      if(StringLen(InpSymbols) > 0)
      {
         int overrideCount = ParseSymbolList(InpSymbols, g_cfg.symbols, 50);
         g_cfg.symbolCount = overrideCount;
         TMLogInfo("Symbol override: " + IntegerToString(overrideCount) + " symbol(s) from input");
      }

      TMLogInfo("Config loaded: " + IntegerToString(g_cfg.symbolCount) + " symbol(s), mode=" + g_cfg.mode +
                " sync=" + (g_cfg.syncEnabled ? "on" : "off") +
                " exec=" + (g_cfg.execEnabled ? "on" : "off"));

      string syncJson = ExtractJsonObject(mgrJson, "sync");
      if(StringLen(syncJson) > 0)
      {
         g_cfg.syncEnabled = TMJsonBool(syncJson, "enabled");
         long si = TMJsonLong(syncJson, "intervalSec");
         if(si >= 10 && si <= 3600) g_cfg.syncIntervalSec = (int)si;
         long bd = TMJsonLong(syncJson, "backfillDays");
         if(bd >= 1 && bd <= 365) g_cfg.backfillDays = (int)bd;
         long bs = TMJsonLong(syncJson, "batchSize");
         if(bs >= 100 && bs <= 10000) g_cfg.batchSize = (int)bs;
      }

      string execJson = ExtractJsonObject(mgrJson, "execution");
      if(StringLen(execJson) > 0)
      {
         g_cfg.execEnabled = TMJsonBool(execJson, "enabled");
         long ps = TMJsonLong(execJson, "pollSec");
         if(ps >= 1 && ps <= 60) g_cfg.execPollSec = (int)ps;
         double msp = TMJsonDouble(execJson, "maxSpreadPips");
         if(msp >= 0) g_cfg.maxSpreadPips = msp;
         long mspp = TMJsonLong(execJson, "maxSlippagePoints");
         if(mspp >= 0 && mspp <= 1000) g_cfg.maxSlippagePoints = (int)mspp;
         double msesp = TMJsonDouble(execJson, "maxSignalEntrySlippagePips");
         if(msesp >= 0) g_cfg.maxSignalEntrySlippagePips = msesp;
         double merr = TMJsonDouble(execJson, "minEffectiveRiskReward");
         if(merr >= 0) g_cfg.minEffectiveRiskReward = merr;
         g_cfg.allowLimitOrders = TMJsonBool(execJson, "allowLimitOrders");
         string tif = TMJsonString(execJson, "defaultTimeInForce");
         if(StringLen(tif) > 0) g_cfg.defaultTimeInForce = tif;
         double dl = TMJsonDouble(execJson, "defaultLots");
         if(dl > 0) g_cfg.defaultLots = dl;
      }

      string cmdJson = ExtractJsonObject(mgrJson, "commands");
      if(StringLen(cmdJson) > 0)
      {
         g_cfg.commandsEnabled = TMJsonBool(cmdJson, "enabled");
         long cps = TMJsonLong(cmdJson, "pollSec");
         if(cps >= 1 && cps <= 300) g_cfg.commandsPollSec = (int)cps;
      }
   }

   ParseBackfillRequests(body);
   RebuildSyncSymbols();
   EventKillTimer();
   int timerSec = MathMin(g_cfg.execPollSec, g_cfg.commandsPollSec);
   if(timerSec < 1) timerSec = 1;
   EventSetTimer(timerSec);

   TMLogInfo("Config updated: mode=" + g_cfg.mode +
             " symbols=" + IntegerToString(g_cfg.symbolCount) +
             " exec=" + (g_cfg.execEnabled ? "on" : "off") +
             " sync=" + (g_cfg.syncEnabled ? "on" : "off"));
}

//+------------------------------------------------------------------+
//| Extract a JSON object value: "key":{...}                           |
//+------------------------------------------------------------------+
string ExtractJsonObject(string json, string key)
{
   string searchKey = "\"" + key + "\":{";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return "";
   pos += StringLen(key) + 3; // skip "key":{

   int depth = 1;
   int i = pos;
   while(i < StringLen(json) && depth > 0)
   {
      ushort c = StringGetCharacter(json, i);
      if(c == '{') depth++;
      else if(c == '}') depth--;
      i++;
   }
   if(depth != 0) return "";
   return StringSubstr(json, pos, i - pos - 1);
}

//+------------------------------------------------------------------+
//| Parse server-commanded backfill requests from config JSON          |
//+------------------------------------------------------------------+
void ParseBackfillRequests(string json)
{
   g_backfillRequestCount = 0;

   int arrStart = StringFind(json, "\"backfillRequests\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(json, "[", arrStart) + 1;
   int arrEnd = StringFind(json, "]", arrStart);
   if(arrEnd < 0 || arrEnd <= arrStart) return;

   int searchPos = arrStart;
   while(searchPos < arrEnd && g_backfillRequestCount < 20)
   {
      int objStart = StringFind(json, "{", searchPos);
      if(objStart < 0 || objStart >= arrEnd) break;
      int objEnd = StringFind(json, "}", objStart);
      if(objEnd < 0 || objEnd > arrEnd) break;

      string objJson = StringSubstr(json, objStart, objEnd - objStart + 1);
      BackfillRequest req;
      req.jobId = TMJsonString(objJson, "jobId");
      req.symbol = TMJsonString(objJson, "symbol");
      req.fromMs = TMJsonLong(objJson, "fromMs");
      req.toMs = TMJsonLong(objJson, "toMs");

      if(StringLen(req.jobId) > 0 && StringLen(req.symbol) > 0 &&
         req.fromMs > 0 && req.toMs >= req.fromMs)
      {
         g_backfillRequests[g_backfillRequestCount] = req;
         g_backfillRequestCount++;
      }
      searchPos = objEnd + 1;
   }
}

//+------------------------------------------------------------------+
//| Rebuild per-symbol sync state after config change                  |
//+------------------------------------------------------------------+
void RebuildSyncSymbols()
{
   SymbolSyncState newState[50];
   int newCount = 0;

   for(int i = 0; i < g_cfg.symbolCount && newCount < 50; i++)
   {
      string canonical = g_cfg.symbols[i];
      string broker = TMFindBrokerSymbol(canonical);
      if(StringLen(broker) == 0)
      {
         TMLogWarn("Symbol '" + canonical + "' not found in Market Watch");
         continue;
      }

      // Preserve backfill/sync state for symbols that are already known.
      // This prevents a full re-backfill every time the config is refreshed.
      bool found = false;
      for(int j = 0; j < g_syncSymbolCount; j++)
      {
         if(g_syncState[j].canonical == canonical)
         {
            newState[newCount] = g_syncState[j];
            newState[newCount].broker = broker; // update broker mapping
            found = true;
            break;
         }
      }

      if(!found)
      {
         newState[newCount].canonical = canonical;
         newState[newCount].broker = broker;
         newState[newCount].lastSyncTime = 0;
         newState[newCount].backfillDone = false;
      }

      newCount++;
   }

   // Copy the rebuilt state back and clear any stale entries.
   for(int i = 0; i < newCount; i++)
      g_syncState[i] = newState[i];
   for(int i = newCount; i < 50; i++)
   {
      g_syncState[i].canonical = "";
      g_syncState[i].broker = "";
      g_syncState[i].lastSyncTime = 0;
      g_syncState[i].backfillDone = false;
   }
   g_syncSymbolCount = newCount;
}

//+------------------------------------------------------------------+
//| Poll and execute signals                                           |
//+------------------------------------------------------------------+
void PollSignals()
{
   string url = g_serverUrl + "/api/mt5/signals";
   string body = TMHttpGet(url, g_effectiveApiKey, 15000);
   if(StringLen(body) == 0) return;

   string serverMode = TMJsonString(body, "mode");
   bool effectivePaper = (serverMode == "paper") ? true : (serverMode == "live" ? false : (g_cfg.mode == "paper"));

   long count = TMJsonLong(body, "count");
   if(count <= 0) return;

   g_totalSignalsReceived += (int)count;

   int arrStart = StringFind(body, "\"signals\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   int searchPos = arrStart;
   for(int s = 0; s < (int)count && s < 20; s++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;

      string sigJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      ExecuteSignalJson(sigJson, effectivePaper);
   }
}

//+------------------------------------------------------------------+
//| Execute a single signal                                            |
//+------------------------------------------------------------------+
void ExecuteSignalJson(string sigJson, bool paperMode)
{
   if(!g_serverReachable)
   {
      string dbgId = TMJsonString(sigJson, "signalId");
      TMLogWarn("Signal " + StringSubstr(dbgId, 0, 8) + " ignored: server unreachable");
      return;
   }

   string signalId = TMJsonString(sigJson, "signalId");
   string symbol   = TMJsonString(sigJson, "symbol");
   string side     = TMJsonString(sigJson, "side");
   double entry    = TMJsonDouble(sigJson, "entryPrice");
   double sl       = TMJsonDouble(sigJson, "stopLoss");
   double tp       = TMJsonDouble(sigJson, "takeProfit");
   double lots     = TMJsonDouble(sigJson, "lotSize");
   if(lots <= 0) lots = g_cfg.defaultLots;

   // Server-provided execution instruction (new V2 fields)
   string executionStrategy = TMJsonString(sigJson, "executionStrategy");
   if(StringLen(executionStrategy) == 0) executionStrategy = "market";
   double limitPrice = TMJsonDouble(sigJson, "limitPrice");
   double maxDriftPips = TMJsonDouble(sigJson, "maxEntryDriftPips");
   if(maxDriftPips <= 0) maxDriftPips = g_cfg.maxSignalEntrySlippagePips;
   double minRR = TMJsonDouble(sigJson, "minEffectiveRR");
   if(minRR <= 0) minRR = g_cfg.minEffectiveRiskReward;
   string tif = TMJsonString(sigJson, "timeInForce");
   if(StringLen(tif) == 0) tif = g_cfg.defaultTimeInForce;
   long expiresInSec = TMJsonLong(sigJson, "expiresInSeconds");

   if(StringLen(signalId) == 0 || StringLen(symbol) == 0 || StringLen(side) == 0)
   {
      TMLogWarn("Skipping malformed signal");
      return;
   }

   double spreadPips = TMSpreadPips(symbol);
   if(g_cfg.maxSpreadPips > 0 && spreadPips > g_cfg.maxSpreadPips)
   {
      ReportFill(signalId, 0, 0.0, false, "Spread guard: " + DoubleToString(spreadPips, 1) + " pips");
      g_totalOrdersRejected++;
      return;
   }

   lots = TMNormalizeLots(symbol, lots);

   bool isBuy = (side == "buy");
   double currentPrice = TMCurrentPrice(symbol, isBuy);
   double entrySlipPips = TMPriceToPips(symbol, MathAbs(currentPrice - entry));
   double risk = isBuy ? (currentPrice - sl) : (sl - currentPrice);
   double reward = isBuy ? (tp - currentPrice) : (currentPrice - tp);
   double effectiveRR = (risk > 0) ? reward / risk : 0;

   // --- Decide execution style based on server instruction ------------------
   bool useMarket = false;
   bool useLimit = false;
   string reason = "";

   if(executionStrategy == "market")
   {
      if(maxDriftPips > 0 && entrySlipPips > maxDriftPips)
      {
         reason = "Entry drift " + DoubleToString(entrySlipPips, 1) +
                  " pips > max " + DoubleToString(maxDriftPips, 1);
      }
      else if(minRR > 0 && effectiveRR < minRR)
      {
         reason = "Effective R:R " + DoubleToString(effectiveRR, 2) +
                  " < min " + DoubleToString(minRR, 2);
      }
      else
      {
         useMarket = true;
      }
   }
   else if(executionStrategy == "limit")
   {
      if(limitPrice <= 0) limitPrice = entry;
      useLimit = true;
   }
   else // market_if_close_else_limit (default recommended behavior)
   {
      if(maxDriftPips > 0 && entrySlipPips <= maxDriftPips)
      {
         useMarket = true;
      }
      else if(minRR > 0 && effectiveRR >= minRR)
      {
         // Price moved in our favor; still acceptable as market order.
         useMarket = true;
      }
      else if(g_cfg.allowLimitOrders)
      {
         if(limitPrice <= 0) limitPrice = entry;
         useLimit = true;
      }
      else
      {
         reason = "Entry drift " + DoubleToString(entrySlipPips, 1) +
                  " pips and limit orders disabled";
      }
   }

   if(paperMode)
   {
      double paperPrice = useLimit ? limitPrice : currentPrice;
      string paperAction = useMarket ? "MARKET" : (useLimit ? "LIMIT" : "REJECT");
      TMLogTrade("PAPER " + paperAction + " " + side + " " + symbol + " @ " + DoubleToString(paperPrice, 5));
      if(StringLen(reason) > 0)
         ReportFill(signalId, 0, currentPrice, false, reason);
      else
         ReportFill(signalId, 0, paperPrice, true, "");
      return;
   }

   if(StringLen(reason) > 0)
   {
      ReportFill(signalId, 0, currentPrice, false, reason);
      g_totalOrdersRejected++;
      TMLogWarn(reason + " for " + symbol);
      return;
   }

   int retcode = 0;
   long ticket = 0;
   double fillPrice = 0;

   if(useMarket)
   {
      ticket = TMOpenMarket(symbol, side, lots, sl, tp, g_cfg.maxSlippagePoints,
                            "TM_" + StringSubstr(signalId, 0, 8), InpMagic, retcode);
      if(ticket > 0)
      {
         fillPrice = TMPositionOpenPrice(ticket);
         if(fillPrice <= 0) fillPrice = currentPrice;
      }
   }
   else if(useLimit)
   {
      datetime expiration = 0;
      if(tif == "SPECIFIED" && expiresInSec > 0)
         expiration = (datetime)(TimeCurrent() + expiresInSec);
      ticket = TMOpenLimit(symbol, side, lots, limitPrice, sl, tp,
                           "TM_" + StringSubstr(signalId, 0, 8), InpMagic,
                           tif, expiration, retcode);
      if(ticket > 0)
         fillPrice = limitPrice;
   }

   if(ticket > 0)
   {
      g_totalOrdersSent++;
      ReportFill(signalId, ticket, fillPrice, true, "");
   }
   else
   {
      g_totalOrdersRejected++;
      string failReason = "Order open failed (retcode " + IntegerToString(retcode) + ")";
      ReportFill(signalId, 0, 0.0, false, failReason);
   }
}

//+------------------------------------------------------------------+
//| Report fill or reject to server                                    |
//+------------------------------------------------------------------+
void ReportFill(string signalId, long ticket, double price, bool filled, string rejectReason)
{
   string json = "{";
   json += "\"signalId\":\"" + signalId + "\",";
   json += "\"mt5Ticket\":" + IntegerToString(ticket) + ",";
   json += "\"fillPrice\":" + DoubleToString(price, 5) + ",";
   if(filled)
      json += "\"status\":\"filled\"";
   else
      json += "\"status\":\"rejected\",\"rejectReason\":\"" + rejectReason + "\"";
   json += "}";

   string url = g_serverUrl + "/api/mt5/fills";
   TMHttpPostWithRetry(url, g_effectiveApiKey, json, 15000, 3);
}

//+------------------------------------------------------------------+
//| Poll and execute remote commands                                   |
//+------------------------------------------------------------------+
void PollCommands()
{
   string url = g_serverUrl + "/api/mt5/commands?last_ack_sequence=" + IntegerToString(g_lastAckCommandSequence);
   string body = TMHttpGet(url, g_effectiveApiKey, 10000);
   if(StringLen(body) == 0) return;

   long count = TMJsonLong(body, "count");
   if(count <= 0)
   {
      // Still advance the ack watermark if the server reports a higher one.
      long serverLastSeq = TMJsonLong(body, "lastSequence");
      if(serverLastSeq > g_lastAckCommandSequence)
         g_lastAckCommandSequence = serverLastSeq;
      return;
   }

   int arrStart = StringFind(body, "\"commands\":[");
   if(arrStart < 0) return;
   arrStart = StringFind(body, "[", arrStart) + 1;

   int searchPos = arrStart;
   for(int c = 0; c < (int)count && c < 20; c++)
   {
      int objStart = StringFind(body, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(body, "}", objStart);
      if(objEnd < 0) break;

      string cmdJson = StringSubstr(body, objStart, objEnd - objStart + 1);
      searchPos = objEnd + 1;

      long seq = TMJsonLong(cmdJson, "sequenceNumber");
      ExecuteCommandJson(cmdJson);
      if(seq > g_lastAckCommandSequence)
         g_lastAckCommandSequence = seq;
   }

   long serverLastSeq = TMJsonLong(body, "lastSequence");
   if(serverLastSeq > g_lastAckCommandSequence)
      g_lastAckCommandSequence = serverLastSeq;
}

//+------------------------------------------------------------------+
//| Execute a single command                                           |
//+------------------------------------------------------------------+
void ExecuteCommandJson(string cmdJson)
{
   string commandId   = TMJsonString(cmdJson, "commandId");
   string cmdType     = TMJsonString(cmdJson, "commandType");
   long   ticket      = TMJsonLong(cmdJson, "mt5Ticket");
   string symbol      = TMJsonString(cmdJson, "symbol");
   double newSl       = TMJsonDouble(cmdJson, "newSl");
   double newTp       = TMJsonDouble(cmdJson, "newTp");
   double closeLots   = TMJsonDouble(cmdJson, "closeLots");
   string closeReason = TMJsonString(cmdJson, "closeReason");

   if(StringLen(commandId) == 0 || ticket == 0) return;

   bool success = false;
   string failReason = "";

   if(cmdType == "MODIFY_SL")
   {
      success = TMModifySLTP(ticket, newSl, newTp);
      if(!success) failReason = "Modify SL/TP failed";
   }
   else if(cmdType == "CLOSE_POSITION")
   {
      double lots = closeLots > 0 ? TMNormalizeLots(symbol, closeLots) : 0; // 0 = full close in MT5
      string reason = (StringLen(closeReason) > 0) ? closeReason : "server";
      success = TMClosePosition(ticket, symbol, lots, g_cfg.maxSlippagePoints, reason);
      if(!success) failReason = "Close failed";
   }
   else if(cmdType == "PARTIAL_CLOSE")
   {
      double lots = closeLots > 0 ? TMNormalizeLots(symbol, closeLots) : 0;
      string reason = (StringLen(closeReason) > 0) ? closeReason : "partial";
      success = TMClosePosition(ticket, symbol, lots, g_cfg.maxSlippagePoints, reason);
      if(!success) failReason = "Partial close failed";
   }
   else if(cmdType == "CANCEL_PENDING_ORDER")
   {
      int cancelRetcode = 0;
      success = TMCancelPendingOrder(ticket, cancelRetcode);
      if(!success) failReason = "Cancel pending order failed (" + IntegerToString(cancelRetcode) + ")";
   }
   else
   {
      failReason = "Unknown command: " + cmdType;
   }

   string json = "{";
   json += "\"commandId\":\"" + commandId + "\",";
   json += "\"success\":" + (success ? "true" : "false");
   if(!success) json += ",\"error\":\"" + failReason + "\"";
   json += "}";

   string url = g_serverUrl + "/api/mt5/command-results";
   TMHttpPostWithRetry(url, g_effectiveApiKey, json, 10000, 3);
}

//+------------------------------------------------------------------+
//| Sync 1m candles for all configured symbols                         |
//+------------------------------------------------------------------+
void SyncAllSymbols()
{
   // Refresh broker/UTC offset in case DST changed.
   g_serverOffsetSec = (long)TimeCurrent() - (long)TimeGMT();

   for(int i = 0; i < g_syncSymbolCount; i++)
   {
      if(TimeCurrent() - g_syncState[i].lastSyncTime < g_cfg.syncIntervalSec)
         continue;

      SyncSymbol(i);
      g_syncState[i].lastSyncTime = TimeCurrent();

      // Small pause between symbols to avoid rate-limit storms
      if(i < g_syncSymbolCount - 1) Sleep(100);
   }
}

//+------------------------------------------------------------------+
//| Sync a single symbol's 1m candles                                  |
//+------------------------------------------------------------------+
void SyncSymbol(int idx)
{
   string brokerSym = g_syncState[idx].broker;

   // Backfill on first run
   if(!g_syncState[idx].backfillDone)
   {
      datetime startTime = TimeCurrent() - g_cfg.backfillDays * 24 * 60 * 60;
      PushBars(brokerSym, startTime, true);
      g_syncState[idx].backfillDone = true;
      return;
   }

   // Incremental sync: fetch bars newer than last known
   if(!SymbolSelect(brokerSym, true))
   {
      TMLogWarn("Cannot select symbol in Market Watch: " + brokerSym);
      return;
   }
   datetime lastKnown = iTime(brokerSym, PERIOD_M1, 0) - 5 * 60; // small overlap
   PushBars(brokerSym, lastKnown, false);
}

//+------------------------------------------------------------------+
//| Fetch and push bars to server                                      |
//+------------------------------------------------------------------+
void PushBars(string symbol, datetime fromTime, bool isBackfill)
{
   PushBarsWithJob(symbol, fromTime, TimeCurrent(), isBackfill, "");
}

//+------------------------------------------------------------------+
//| Fetch and push an exact [fromTime, toTime] window to the server.   |
//| Optionally attaches a backfillJobId for targeted backfill tracking.|
//+------------------------------------------------------------------+
int PushBarsWithJob(string symbol, datetime fromTime, datetime toTime, bool isBackfill, string jobId)
{
   if(!SymbolSelect(symbol, true))
   {
      TMLogWarn("Cannot select symbol in Market Watch: " + symbol);
      return 0;
   }

#ifdef __MQL5__
   // Ensure an M1 chart is open so the terminal loads/synchronizes history.
   if(InpOpenCharts)
      TMOpenChartForSymbol(symbol);
#endif

   MqlRates rates[];
   int copied = CopyRates(symbol, PERIOD_M1, fromTime, toTime, rates);
   if(copied <= 0)
   {
      int err = GetLastError();
      ResetLastError();
      // Some symbols (e.g. EURUSD on 1xserver) fail date-range CopyRates with
      // ERR_HISTORY_NOT_FOUND (4401) even though history exists. Fall back to
      // position-based copy, which forces the terminal to load/sync the series.
      int totalBars = Bars(symbol, PERIOD_M1);
      if(totalBars > 0)
      {
         int count = isBackfill ? MathMin(totalBars, 200000) : MathMin(totalBars, 30);
         copied = CopyRates(symbol, PERIOD_M1, 0, count, rates);
         if(copied > 0)
         {
            TMLogInfo("CopyRates fallback for " + symbol + " copied=" + IntegerToString(copied) +
                      " (original err=" + IntegerToString(err) + ")");
         }
      }
      if(copied <= 0)
      {
         TMLogWarn("No bars for " + symbol + " from=" + IntegerToString((long)fromTime) +
                   " to=" + IntegerToString((long)toTime) + " copied=" + IntegerToString(copied) +
                   " err=" + IntegerToString(err));
         return 0;
      }
   }

   ArraySetAsSeries(rates, false);

   int batchSize = g_cfg.batchSize;
   int totalSent = 0;
   for(int start = 0; start < copied; start += batchSize)
   {
      int end = MathMin(start + batchSize, copied);
      string json = BuildBarsJson(symbol, rates, start, end, jobId);

      string url = g_serverUrl + "/api/ingest";
      string res = TMHttpPost(url, g_effectiveApiKey, json, 15000);
      if(StringLen(res) > 0) totalSent += (end - start);
      else break;
   }

   string label = isBackfill ? "Backfill" : "Sync";
   if(StringLen(jobId) > 0) label = "TargetBackfill";
   TMLogInfo(label + " " + symbol + ": " + IntegerToString(totalSent) + " bars");
   return totalSent;
}

//+------------------------------------------------------------------+
//| Build JSON payload for a batch of bars                             |
//+------------------------------------------------------------------+
string BuildBarsJson(string symbol, const MqlRates &rates[], int start, int end, string jobId = "")
{
   string bars = "[";
   for(int i = start; i < end; i++)
   {
      if(i > start) bars += ",";
      bars += "{";
      bars += "\"ts\":" + IntegerToString(((long)rates[i].time - g_serverOffsetSec) * 1000) + ",";
      bars += "\"o\":" + DoubleToString(rates[i].open, 6) + ",";
      bars += "\"h\":" + DoubleToString(rates[i].high, 6) + ",";
      bars += "\"l\":" + DoubleToString(rates[i].low, 6) + ",";
      bars += "\"c\":" + DoubleToString(rates[i].close, 6) + ",";
      bars += "\"tickVol\":" + IntegerToString((long)rates[i].tick_volume) + ",";
      bars += "\"spread\":" + IntegerToString((int)rates[i].spread);
      bars += "}";
   }
   bars += "]";

   string platform = "mt5";
#ifdef __MQL4__
   platform = "mt4";
#endif

   string broker = AccountInfoString(ACCOUNT_COMPANY);
   ENUM_ACCOUNT_TRADE_MODE tradeMode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string acctType = "real";
   if(tradeMode == ACCOUNT_TRADE_MODE_DEMO)   acctType = "demo";
   if(tradeMode == ACCOUNT_TRADE_MODE_CONTEST) acctType = "contest";
   int digits = TMDigits(symbol);

   string sourceObj = "{\"platform\":\"" + platform + "\",\"broker\":\"" + broker + "\",\"accountType\":\"" + acctType + "\",\"digits\":" + IntegerToString(digits);
   if(StringLen(jobId) > 0)
      sourceObj += ",\"backfillJobId\":\"" + jobId + "\"";
   sourceObj += "}";

   string json = "{";
   json += "\"schemaVersion\":\"mt5-bars-v1\",";
   json += "\"symbol\":\"" + symbol + "\",";
   json += "\"timeframe\":\"M1\",";
   json += "\"source\":" + sourceObj + ",";
   json += "\"bars\":" + bars;
   json += "}";
   return json;
}

//+------------------------------------------------------------------+
//| Process server-commanded targeted backfill requests                |
//+------------------------------------------------------------------+
void ProcessBackfillRequests()
{
   if(g_backfillRequestCount == 0) return;

   for(int i = 0; i < g_backfillRequestCount; i++)
   {
      BackfillRequest req = g_backfillRequests[i];
      string brokerSym = TMResolveBrokerSymbol(req.symbol, "");
      if(StringLen(brokerSym) == 0)
      {
         TMLogWarn("Backfill request symbol '" + req.symbol + "' not found in Market Watch");
         continue;
      }

      datetime fromTime = (datetime)(req.fromMs / 1000 + g_serverOffsetSec);
      datetime toTime = (datetime)(req.toMs / 1000 + g_serverOffsetSec);

      int sent = PushBarsWithJob(brokerSym, fromTime, toTime, true, req.jobId);
      if(sent > 0)
         ReportBackfillComplete(req.jobId);
      else
         TMLogWarn("Target backfill " + req.jobId + " sent 0 bars; will retry");

      // Clear the request so we don't retry on the next timer tick
      if(sent > 0)
         g_backfillRequests[i].jobId = "";
   }

   // Compact the array
   int writePos = 0;
   for(int i = 0; i < g_backfillRequestCount; i++)
   {
      if(StringLen(g_backfillRequests[i].jobId) > 0)
      {
         if(i != writePos) g_backfillRequests[writePos] = g_backfillRequests[i];
         writePos++;
      }
   }
   g_backfillRequestCount = writePos;
}

//+------------------------------------------------------------------+
//| Report a targeted backfill job as completed                        |
//+------------------------------------------------------------------+
void ReportBackfillComplete(string jobId)
{
   string json = "{";
   json += "\"jobId\":\"" + jobId + "\"";
   json += "}";

   string url = g_serverUrl + "/api/ingest/backfill/complete";
   string res = TMHttpPost(url, g_effectiveApiKey, json, 10000);
   if(StringFind(res, "\"ok\":true") >= 0)
      TMLogInfo("Backfill complete reported: " + jobId);
   else
      TMLogWarn("Backfill complete failed for " + jobId + ": " + res);
}

//+------------------------------------------------------------------+
//| Report manager state snapshot to server                            |
//+------------------------------------------------------------------+
void ReportStatus()
{
   string symbolsJson = "[";
   for(int i = 0; i < g_cfg.symbolCount; i++)
   {
      if(i > 0) symbolsJson += ",";
      symbolsJson += "\"" + g_cfg.symbols[i] + "\"";
   }
   symbolsJson += "]";

   string json = "{";
   json += "\"platform\":\"mt5\",";
   json += "\"version\":\"" + EA_VERSION + "\",";
   json += "\"symbols\":" + symbolsJson + ",";
   json += "\"errors\":[" + (g_lastError == "" ? "" : "\"" + g_lastError + "\"") + "]";
   json += "}";

   string url = g_serverUrl + "/api/ingest/status";
   TMHttpPost(url, g_effectiveApiKey, json, 5000);
}

//+------------------------------------------------------------------+
//| Update chart comment overlay                                       |
//+------------------------------------------------------------------+
void UpdateStatusComment()
{
   string msg = EA_VERSION + "\n";
   msg += "Mode: " + g_cfg.mode + " | Enabled: " + (g_cfg.enabled ? "Y" : "N") + "\n";
   msg += "Symbols: " + IntegerToString(g_cfg.symbolCount) + "\n";
   msg += "Sig recv: " + IntegerToString(g_totalSignalsReceived) + "\n";
   msg += "Orders: " + IntegerToString(g_totalOrdersSent) + " / Rej: " + IntegerToString(g_totalOrdersRejected) + "\n";
   if(g_lastError != "") msg += "ERR: " + g_lastError + "\n";
   Comment(msg);
}

//+------------------------------------------------------------------+
//| OnTick — not used for primary work (timer-based)                   |
//+------------------------------------------------------------------+
void OnTick()
{
}
