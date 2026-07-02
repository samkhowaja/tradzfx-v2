//+------------------------------------------------------------------+
//|                                           CheckTimeOffsets.mq5   |
//|  Prints MT5 server, local, and GMT times so you can verify the   |
//|  timezone offset between the broker (1XTrade) and this PC.       |
//|                                                                  |
//|  Usage: drag this script onto any chart in MT5 and read the      |
//|  output in the Experts tab of the Toolbox.                       |
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "1.0"
#property strict
#property script_show_inputs

void OnStart()
{
   datetime serverTime = TimeCurrent();
   datetime localTime  = TimeLocal();
   datetime gmtTime    = TimeGMT();

   long serverOffsetSec = (long)serverTime - (long)gmtTime;
   long localOffsetSec  = (long)localTime - (long)gmtTime;

   string serverName = AccountInfoString(ACCOUNT_SERVER);
   string broker     = AccountInfoString(ACCOUNT_COMPANY);

   Print("=== Time offset check ===");
   Print("Broker/Server: ", broker, " / ", serverName);
   Print("Server time (TimeCurrent): ", TimeToString(serverTime, TIME_DATE|TIME_SECONDS));
   Print("Local time  (TimeLocal):   ", TimeToString(localTime,  TIME_DATE|TIME_SECONDS));
   Print("GMT/UTC     (TimeGMT):     ", TimeToString(gmtTime,    TIME_DATE|TIME_SECONDS));
   Print("Server offset from GMT: ", serverOffsetSec, " sec (", DoubleToString(serverOffsetSec/3600.0, 2), " h)");
   Print("Local offset from GMT:  ", localOffsetSec,  " sec (", DoubleToString(localOffsetSec/3600.0,  2), " h)");
   Print("=========================");
}
