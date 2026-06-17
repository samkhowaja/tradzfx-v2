//+------------------------------------------------------------------+
//| TradeMentor Trade Execution Include                              |
//| Open/close/modify position abstractions for MT4/MT5               |
//+------------------------------------------------------------------+
#ifndef TM_TRADE_MQH
#define TM_TRADE_MQH

#include "TMSymbol.mqh"

//+------------------------------------------------------------------+
//| Open a market order                                                |
//| Returns ticket (>0) on success, 0 on failure                       |
//+------------------------------------------------------------------+
long TMOpenMarket(string symbol, string side, double lots, double sl, double tp,
                  int slippagePoints, string comment, ulong magic)
{
   bool isBuy = (side == "buy" || side == "BUY");

   #ifdef __MQL5__
   MqlTradeRequest req = {};
   MqlTradeResult res = {};
   req.action = TRADE_ACTION_DEAL;
   req.symbol = symbol;
   req.volume = lots;
   req.type = isBuy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   req.price = isBuy ? SymbolInfoDouble(symbol, SYMBOL_ASK) : SymbolInfoDouble(symbol, SYMBOL_BID);
   req.sl = sl;
   req.tp = tp;
   req.deviation = slippagePoints;
   req.magic = magic;
   req.comment = comment;
   req.type_filling = ORDER_FILLING_IOC;

   if(!OrderSend(req, res))
   {
      // Retry with FOK if IOC fill policy rejected
      if(res.retcode == TRADE_RETCODE_INVALID_FILL)
      {
         req.type_filling = ORDER_FILLING_FOK;
         ZeroMemory(res);
         OrderSend(req, res);
      }
   }

   if(res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED)
   {
      long ticket = (long)res.deal;
      if(ticket == 0) ticket = (long)res.order;
      return ticket;
   }
   TMLogError("OrderSend failed: " + IntegerToString(res.retcode));
   return 0;

   #else // __MQL4__
   double price = isBuy ? MarketInfo(symbol, MODE_ASK) : MarketInfo(symbol, MODE_BID);
   int cmd = isBuy ? OP_BUY : OP_SELL;
   color clr = isBuy ? clrGreen : clrRed;
   int ticket = OrderSend(symbol, cmd, lots, price, slippagePoints, sl, tp, comment, (int)magic, 0, clr);
   if(ticket < 0)
   {
      TMLogError("OrderSend failed: " + IntegerToString(GetLastError()));
      return 0;
   }
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
   req.type_filling = ORDER_FILLING_IOC;

   if(!OrderSend(req, res) && res.retcode == TRADE_RETCODE_INVALID_FILL)
   {
      req.type_filling = ORDER_FILLING_FOK;
      ZeroMemory(res);
      OrderSend(req, res);
   }

   return (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_PLACED);

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
//| Modify stop loss / take profit                                     |
//+------------------------------------------------------------------+
bool TMModifySLTP(long ticket, double newSl, double newTp)
{
   #ifdef __MQL5__
   if(!PositionSelectByTicket((ulong)ticket)) return false;
   string symbol = PositionGetString(POSITION_SYMBOL);

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

#endif // TM_TRADE_MQH
