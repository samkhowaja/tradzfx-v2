import type { MarketWindowPolicy } from "./types";

const WEEKDAYS = [1, 2, 3, 4, 5] as const;

/**
 * Canonical market-window policy. Local times deliberately preserve market
 * opens across DST. Policy version is stored with every resolved occurrence.
 */
export const MARKET_WINDOW_POLICY_VERSION = "1.0.0";

export const MARKET_WINDOW_POLICIES: readonly MarketWindowPolicy[] = [
  {
    id: "ASIA_KILLZONE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "Asia Killzone",
    timezone: "Asia/Tokyo",
    localStart: "09:00",
    localEnd: "12:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: ["FX_CROSS", "CRYPTO"],
    effectiveFrom: "2020-01-01",
    expectedActivity: "LOW",
  },
  {
    id: "LONDON_KILLZONE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "London Killzone",
    timezone: "Europe/London",
    localStart: "07:00",
    localEnd: "11:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: ["FX_MAJOR", "FX_CROSS", "GOLD", "INDICES_EU"],
    effectiveFrom: "2020-01-01",
    expectedActivity: "HIGH",
  },
  {
    id: "NY_KILLZONE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "New York Killzone",
    timezone: "America/New_York",
    localStart: "08:00",
    localEnd: "11:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: ["FX_MAJOR", "FX_CROSS", "GOLD", "INDICES_US", "OIL"],
    effectiveFrom: "2020-01-01",
    expectedActivity: "HIGH",
  },
  {
    id: "LONDON_CLOSE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "London Close",
    timezone: "Europe/London",
    localStart: "14:00",
    localEnd: "16:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: ["FX_MAJOR", "FX_CROSS", "GOLD", "INDICES_EU"],
    effectiveFrom: "2020-01-01",
    expectedActivity: "MODERATE",
  },
  {
    id: "LATE_NY_KILLZONE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "New York Afternoon",
    timezone: "America/New_York",
    localStart: "13:00",
    localEnd: "16:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: ["GOLD", "INDICES_US"],
    effectiveFrom: "2020-01-01",
    expectedActivity: "MODERATE",
  },
  {
    id: "DEAD_ZONE",
    version: MARKET_WINDOW_POLICY_VERSION,
    label: "New York Rollover Dead Zone",
    timezone: "America/New_York",
    localStart: "17:00",
    localEnd: "20:00",
    daysOfWeek: WEEKDAYS,
    symbolClasses: [],
    effectiveFrom: "2020-01-01",
    expectedActivity: "LOW",
  },
] as const;
