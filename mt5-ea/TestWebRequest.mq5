//+------------------------------------------------------------------+
//|                                            TestWebRequest.mq5    |
//|  Minimal script to verify MT5 WebRequest can reach the server.   |
//+------------------------------------------------------------------+
#property copyright "TradeMentor"
#property version   "1.0"
#property strict
#property script_show_inputs

input string InpTestUrl = "http://127.0.0.1:3003/api/ingest/mt5/config";
input string InpApiKey  = "tm_mt5_93b214780ae6fdd83a726629535213b94e64bc3d4c0294ef";

void OnStart()
{
   string headers = "X-API-Key: " + InpApiKey + "\r\n";
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
