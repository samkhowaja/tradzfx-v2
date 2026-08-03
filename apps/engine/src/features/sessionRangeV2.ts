import type { Candle, FeatureDefinition, TimeFrame } from "@tm/shared";
import {
  MARKET_WINDOW_POLICIES,
  getTfMs,
  resolveWindowOccurrence,
  sha256,
} from "@tm/shared";

export type SessionRangeKind = "full_session";

export interface SessionRangeV2Row {
  sessionId: string;
  policyVersion: string;
  tradingDate: string;
  rangeKind: SessionRangeKind;
  startsAt: Date;
  scheduledEndsAt: Date;
  asOfTs: Date;
  completedAt: Date | null;
  isComplete: boolean;
  open: number;
  high: number;
  low: number;
  close: number;
  highFormedAt: Date;
  lowFormedAt: Date;
  barCount: number;
  expectedBarCount: number;
  coverageRatio: number;
}

export interface SessionRangeV2Input { candles: Candle[] }
export interface SessionRangeV2Output { ranges: SessionRangeV2Row[]; anchorTs: Date }

function localDateCandidates(candles: Candle[]): string[] {
  const dates = new Set<string>();
  for (const candle of candles) {
    const ms = candle.ts.getTime();
    for (const offset of [-86_400_000, 0, 86_400_000]) {
      dates.add(new Date(ms + offset).toISOString().slice(0, 10));
    }
  }
  return [...dates].sort();
}

export function computeSessionRanges(
  input: SessionRangeV2Input,
  symbol: string,
  tf: TimeFrame,
  endTs: Date
): SessionRangeV2Output {
  const tfMs = getTfMs(tf);
  const ranges: SessionRangeV2Row[] = [];
  if (input.candles.length === 0) return { ranges, anchorTs: endTs };

  const completedCandles = input.candles.filter((c) => c.ts.getTime() + tfMs <= endTs.getTime());
  for (const policy of MARKET_WINDOW_POLICIES) {
    for (const tradingDate of localDateCandidates(completedCandles)) {
      let occurrence;
      try { occurrence = resolveWindowOccurrence(policy.id, tradingDate, symbol); }
      catch { continue; }

      const included = completedCandles.filter((c) => {
        const completedAt = c.ts.getTime() + tfMs;
        return c.ts >= occurrence.startsAt && completedAt <= occurrence.endsAt.getTime() && completedAt <= endTs.getTime();
      });
      if (included.length === 0) continue;

      const last = included[included.length - 1];
      const asOfTs = new Date(last.ts.getTime() + tfMs);
      const isComplete = asOfTs >= occurrence.endsAt;
      let high = included[0].h, low = included[0].l;
      let highFormedAt = new Date(included[0].ts.getTime() + tfMs);
      let lowFormedAt = new Date(included[0].ts.getTime() + tfMs);
      for (const candle of included) {
        const knownAt = new Date(candle.ts.getTime() + tfMs);
        if (candle.h > high) { high = candle.h; highFormedAt = knownAt; }
        if (candle.l < low) { low = candle.l; lowFormedAt = knownAt; }
      }
      const expectedBarCount = Math.max(1, Math.round((occurrence.endsAt.getTime() - occurrence.startsAt.getTime()) / tfMs));
      ranges.push({
        sessionId: occurrence.id,
        policyVersion: occurrence.policyVersion,
        tradingDate,
        rangeKind: "full_session",
        startsAt: occurrence.startsAt,
        scheduledEndsAt: occurrence.endsAt,
        asOfTs,
        completedAt: isComplete ? occurrence.endsAt : null,
        isComplete,
        open: included[0].o,
        high,
        low,
        close: last.c,
        highFormedAt,
        lowFormedAt,
        barCount: included.length,
        expectedBarCount,
        coverageRatio: Math.min(1, included.length / expectedBarCount),
      });
    }
  }
  return {
    ranges: ranges.sort((a,b) => a.asOfTs.getTime() - b.asOfTs.getTime() || a.sessionId.localeCompare(b.sessionId)),
    anchorTs: endTs,
  };
}

export const sessionRangeV2Feature: FeatureDefinition<SessionRangeV2Input, SessionRangeV2Output> = {
  name: "features_session_range_v2",
  version: "1.0.0-shadow.1",
  dependencies: [],
  computePolicy: "onEvent",
  compute(input, context) {
    if (!context?.symbol || !context.endTs) throw new Error("features_session_range_v2 requires symbol and endTs context");
    return computeSessionRanges(input, context.symbol, context.tf, context.endTs);
  },
  hashInput(input) {
    return sha256(input.candles.map(c => `${c.ts.toISOString()}:${c.o}:${c.h}:${c.l}:${c.c}`).join("|"));
  },
  hashOutput(output) {
    return sha256(output.ranges.map(r => `${r.sessionId}:${r.tradingDate}:${r.asOfTs.toISOString()}:${r.high}:${r.low}:${r.isComplete}`).join("|"));
  },
  serialize(output) {
    return output.ranges
      .filter(r => r.asOfTs.getTime() === output.anchorTs.getTime())
      .map(r => ({
      ts: r.asOfTs,
      session_id: r.sessionId,
      policy_version: r.policyVersion,
      trading_date: r.tradingDate,
      range_kind: r.rangeKind,
      starts_at: r.startsAt,
      scheduled_ends_at: r.scheduledEndsAt,
      as_of_ts: r.asOfTs,
      completed_at: r.completedAt,
      is_complete: r.isComplete,
      open: r.open, high: r.high, low: r.low, close: r.close,
      high_formed_at: r.highFormedAt,
      low_formed_at: r.lowFormedAt,
      bar_count: r.barCount,
      expected_bar_count: r.expectedBarCount,
      coverage_ratio: r.coverageRatio,
    }));
  },
  deserialize(rows) {
    const ranges = rows.map(r => ({
      sessionId: String(r.session_id), policyVersion: String(r.policy_version), tradingDate: String(r.trading_date),
      rangeKind: "full_session" as const, startsAt: new Date(String(r.starts_at)), scheduledEndsAt: new Date(String(r.scheduled_ends_at)),
      asOfTs: new Date(String(r.as_of_ts)), completedAt: r.completed_at ? new Date(String(r.completed_at)) : null,
      isComplete: Boolean(r.is_complete), open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
      highFormedAt: new Date(String(r.high_formed_at)), lowFormedAt: new Date(String(r.low_formed_at)),
      barCount: Number(r.bar_count), expectedBarCount: Number(r.expected_bar_count), coverageRatio: Number(r.coverage_ratio),
    }));
    const anchorTs = ranges.reduce((max, r) => r.asOfTs > max ? r.asOfTs : max, new Date(0));
    return { ranges, anchorTs };
  },
};
