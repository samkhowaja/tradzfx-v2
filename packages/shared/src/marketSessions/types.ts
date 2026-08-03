import type { KillzoneId, SymbolClass } from "../utils/time";

export type MarketTimezone =
  | "UTC"
  | "Europe/London"
  | "America/New_York"
  | "Asia/Tokyo";

export interface MarketWindowPolicy {
  id: KillzoneId;
  version: string;
  label: string;
  timezone: MarketTimezone;
  /** Local wall-clock HH:mm. */
  localStart: string;
  /** Local wall-clock HH:mm; end is exclusive. */
  localEnd: string;
  /** ISO weekday: Monday=1 through Sunday=7. */
  daysOfWeek: readonly number[];
  symbolClasses: readonly SymbolClass[];
  effectiveFrom: string;
  effectiveTo?: string;
  expectedActivity: "HIGH" | "MODERATE" | "LOW";
}

export interface ResolvedMarketWindow {
  id: KillzoneId;
  policyVersion: string;
  label: string;
  tradingDate: string;
  startsAt: Date;
  endsAt: Date;
  timezone: MarketTimezone;
  localStart: string;
  localEnd: string;
  symbolClass: SymbolClass;
  preferredForSymbol: boolean;
  expectedActivity: "HIGH" | "MODERATE" | "LOW";
}
