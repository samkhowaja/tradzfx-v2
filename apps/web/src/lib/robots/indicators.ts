// apps/web/src/lib/robots/indicators.ts
// Minimal indicator helpers for robot strategies (self-contained, no DB).

export interface Bar {
  t_ms: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** Aggregate 1m bars into higher-timeframe bars aligned to tfMs. */
export function aggregateBars(bars: readonly Bar[], tfMs: number): (Bar | null)[] {
  const out: (Bar | null)[] = new Array(bars.length).fill(null);
  if (bars.length === 0) return out;
  let current: Bar | null = null;
  let startBucket = Math.floor(bars[0].t_ms / tfMs) * tfMs;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const bucket = Math.floor(b.t_ms / tfMs) * tfMs;
    if (bucket !== startBucket || current === null) {
      if (current) {
        const closeIdx = i - 1;
        if (closeIdx >= 0) out[closeIdx] = current;
      }
      current = { ...b };
      startBucket = bucket;
    } else {
      current.h = Math.max(current.h, b.h);
      current.l = Math.min(current.l, b.l);
      current.c = b.c;
      current.v += b.v;
    }
  }
  if (current) out[bars.length - 1] = current;
  return out;
}

/** Donchian Channel (upper/lower) aligned to input length. */
export function donchianChannel(
  bars: Bar[],
  period: number
): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i + 1 < period) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let maxHigh = -Infinity;
    let minLow = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      maxHigh = Math.max(maxHigh, bars[j].h);
      minLow = Math.min(minLow, bars[j].l);
    }
    upper.push(maxHigh);
    lower.push(minLow);
  }
  return { upper, lower };
}

export function dayOpenMs(tMs: number): number {
  const d = new Date(tMs);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

export function hourOfDay(tMs: number): number {
  return new Date(tMs).getUTCHours();
}

export function minuteOfHour(tMs: number): number {
  return new Date(tMs).getUTCMinutes();
}
