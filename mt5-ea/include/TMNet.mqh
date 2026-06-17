//+------------------------------------------------------------------+
//| TradeMentor Network / JSON Include                               |
//| Shared HTTP request and JSON extraction helpers for MT4/MT5       |
//+------------------------------------------------------------------+
#ifndef TM_NET_MQH
#define TM_NET_MQH

#include "TMLogger.mqh"

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
   string headers = "X-API-Key: " + apiKey + "\r\n";
   char   data[];
   char   result[];
   string resultHeaders;

   int res = WebRequest("GET", url, headers, timeoutMs, data, result, resultHeaders);
   if(res != 200)
   {
      TMLogError("GET " + url + " failed HTTP " + IntegerToString(res) + " err " + IntegerToString(GetLastError()));
      return "";
   }
   return CharArrayToString(result);
}

/**
 * Perform HTTP POST with JSON body and return body as string.
 */
string TMHttpPost(string url, string apiKey, string jsonBody, int timeoutMs = 10000)
{
   string headers = "Content-Type: application/json\r\nX-API-Key: " + apiKey + "\r\n";
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
   return CharArrayToString(result);
}

/**
 * Extract a string value from JSON: "key":"value"
 */
string TMJsonString(string json, string key)
{
   string searchKey = "\"" + key + "\":\"";
   int pos = StringFind(json, searchKey);
   if(pos < 0) return "";
   pos += StringLen(searchKey);
   int endPos = StringFind(json, "\"", pos);
   if(endPos < 0) return "";
   return StringSubstr(json, pos, endPos - pos);
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

#endif // TM_NET_MQH
