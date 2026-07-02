//+------------------------------------------------------------------+
//|                                            TestWebRequest.mq5    |
//|  Minimal script to verify MT5 WebRequest can reach the server.   |
//+------------------------------------------------------------------+
#property copyright "tradzfx"
#property version   "1.1"
#property strict
#property script_show_inputs

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

input string InpTestUrl = "http://127.0.0.1:3003/api/ingest/mt5/config";
input string InpApiKey  = "";

void OnStart()
{
   string headers = "X-API-Key: " + InpApiKey + "\r\n" + TMGetTerminalHeaders();
   char   data[], result[];
   string resultHeaders;

   int res = WebRequest("GET", InpTestUrl, headers, 10000, data, result, resultHeaders);
   int err = GetLastError();

   Print("Testing URL: ", InpTestUrl);
   Print("WebRequest result code: ", res);
   Print("GetLastError: ", err);

   if(res == 200)
   {
      string body = CharArrayToString(result);
      Print("Body preview: ", StringSubstr(body, 0, 200));
   }
   else
   {
      Print("FAILED. If err=5200, the URL is not in Tools->Options->Expert Advisors allowed list.");
   }
}
