import { classifySymbol } from "../pairs/pairCharacteristics";
import type { KillzoneId, SymbolClass } from "../utils/time";
import { MARKET_WINDOW_POLICIES } from "./policies";
import type { MarketTimezone, MarketWindowPolicy, ResolvedMarketWindow } from "./types";

const DAY_MS = 86_400_000;

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<MarketTimezone, Intl.DateTimeFormat>();

function formatter(timezone: MarketTimezone): Intl.DateTimeFormat {
  let value = formatterCache.get(timezone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timezone, value);
  }
  return value;
}

function localParts(ts: Date, timezone: MarketTimezone): LocalParts {
  const parts = formatter(timezone).formatToParts(ts);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find((part) => part.type === type)?.value;
    if (value == null) throw new Error(`Missing ${type} for timezone ${timezone}`);
    return Number(value);
  };
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

function parseDate(date: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid ISO date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Invalid local time: ${time}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error(`Invalid local time: ${time}`);
  return { hour, minute };
}

function dateString(parts: Pick<LocalParts, "year" | "month" | "day">): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addLocalDays(date: string, days: number): string {
  const { year, month, day } = parseDate(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Convert local wall-clock time to UTC using Intl timezone rules, including DST. */
export function localDateTimeToUtc(date: string, time: string, timezone: MarketTimezone): Date {
  const d = parseDate(date);
  const t = parseTime(time);
  const wantedAsUtc = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute, 0);
  let candidate = wantedAsUtc;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(candidate), timezone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second
    );
    const correction = wantedAsUtc - actualAsUtc;
    candidate += correction;
    if (correction === 0) break;
  }

  const result = new Date(candidate);
  const actual = localParts(result, timezone);
  if (
    actual.year !== d.year || actual.month !== d.month || actual.day !== d.day ||
    actual.hour !== t.hour || actual.minute !== t.minute
  ) {
    throw new Error(`Local time ${date} ${time} does not resolve in ${timezone}`);
  }
  return result;
}

function isoWeekday(date: string): number {
  const { year, month, day } = parseDate(date);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return utcDay === 0 ? 7 : utcDay;
}

function effective(policy: MarketWindowPolicy, date: string): boolean {
  return date >= policy.effectiveFrom && (!policy.effectiveTo || date <= policy.effectiveTo);
}

function preferred(policy: MarketWindowPolicy, symbolClass: SymbolClass): boolean {
  return policy.symbolClasses.includes(symbolClass);
}

export function resolveWindowOccurrence(
  id: KillzoneId,
  tradingDate: string,
  symbol: string
): ResolvedMarketWindow {
  const policy = MARKET_WINDOW_POLICIES.find((item) => item.id === id && effective(item, tradingDate));
  if (!policy) throw new Error(`No effective market-window policy for ${id} on ${tradingDate}`);
  if (!policy.daysOfWeek.includes(isoWeekday(tradingDate))) {
    throw new Error(`${id} is closed on ${tradingDate}`);
  }

  const startsAt = localDateTimeToUtc(tradingDate, policy.localStart, policy.timezone);
  const wraps = policy.localEnd <= policy.localStart;
  const endDate = wraps ? addLocalDays(tradingDate, 1) : tradingDate;
  const endsAt = localDateTimeToUtc(endDate, policy.localEnd, policy.timezone);
  const symbolClass = classifySymbol(symbol);

  return {
    id: policy.id,
    policyVersion: policy.version,
    label: policy.label,
    tradingDate,
    startsAt,
    endsAt,
    timezone: policy.timezone,
    localStart: policy.localStart,
    localEnd: policy.localEnd,
    symbolClass,
    preferredForSymbol: preferred(policy, symbolClass),
    expectedActivity: policy.expectedActivity,
  };
}

/** Return every active window. Boundaries use [startsAt, endsAt). */
export function resolveMarketWindows(ts: Date, symbol: string): ResolvedMarketWindow[] {
  if (!Number.isFinite(ts.getTime())) throw new Error("Invalid market timestamp");
  const occurrences: ResolvedMarketWindow[] = [];

  for (const policy of MARKET_WINDOW_POLICIES) {
    const localDate = dateString(localParts(ts, policy.timezone));
    for (const candidateDate of [localDate, addLocalDays(localDate, -1)]) {
      if (!effective(policy, candidateDate) || !policy.daysOfWeek.includes(isoWeekday(candidateDate))) continue;
      const occurrence = resolveWindowOccurrence(policy.id, candidateDate, symbol);
      if (ts >= occurrence.startsAt && ts < occurrence.endsAt) occurrences.push(occurrence);
    }
  }

  return occurrences.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
}

export function isInMarketWindow(ts: Date, symbol: string, allowed: readonly KillzoneId[]): boolean {
  const allowedSet = new Set(allowed);
  return resolveMarketWindows(ts, symbol).some((window) => allowedSet.has(window.id));
}
