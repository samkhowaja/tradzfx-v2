//+------------------------------------------------------------------+
//| tradzfx Logger Include                                       |
//| Shared logging helpers for MT4/MT5 manager EAs                    |
//+------------------------------------------------------------------+
#ifndef TM_LOGGER_MQH
#define TM_LOGGER_MQH

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

#endif // TM_LOGGER_MQH
