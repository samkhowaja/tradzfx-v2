//+------------------------------------------------------------------+
//| tradzfx Symbol Helpers Include                               |
//| Broker symbol resolution, lot/pip/point helpers for MT4/MT5       |
//+------------------------------------------------------------------+
#ifndef TM_SYMBOL_MQH
#define TM_SYMBOL_MQH

#include "TMLogger.mqh"

/**
 * Find the broker-specific symbol name from a canonical base symbol.
 * Tries exact match, common suffixes, then substring scan of Market Watch.
 */
string TMFindBrokerSymbol(string baseSym)
{
   if(StringLen(baseSym) == 0) return "";

   // Exact match
   if(SymbolSelect(baseSym, true)) return baseSym;

   // Common broker suffixes
   string suffixes[];
   ArrayResize(suffixes, 15);
   suffixes[0] = "m";
   suffixes[1] = "M";
   suffixes[2] = ".r";
   suffixes[3] = ".i";
   suffixes[4] = ".pro";
   suffixes[5] = "_SB";
   suffixes[6] = ".s";
   suffixes[7] = ".a";
   suffixes[8] = ".b";
   suffixes[9] = "micro";
   suffixes[10] = ".";
   suffixes[11] = "-";
   suffixes[12] = "c";
   suffixes[13] = "f";
   suffixes[14] = "ecn";

   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string candidate = baseSym + suffixes[i];
      if(SymbolSelect(candidate, true)) return candidate;
   }

   // Substring scan
   int total = SymbolsTotal(false);
   for(int i = 0; i < total; i++)
   {
      string name = SymbolName(i, false);
      if(StringFind(name, baseSym) == 0 && SymbolSelect(name, true))
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

#endif // TM_SYMBOL_MQH
