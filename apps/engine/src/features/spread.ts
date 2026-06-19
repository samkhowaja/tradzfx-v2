/**
 * Spread feature.
 *
 * Computes the average spread over the most recent 1m candles. Spread is only
 * available at the 1m level, so this feature queries candles_1m directly via
 * the runner-provided pool/context regardless of the requested timeframe.
 */

import type { Pool } from "@tm/shared";
import type { Candle, FeatureDefinition } from "@tm/shared";
import { sha256 } from "@tm/shared";

export interface SpreadInput {
  candles: Candle[];
}

export interface SpreadOutput {
  spread: number | null;
  samples: number;
}

async function fetchLatest1mSpreads(
  pool: Pool,
  symbol: string,
  endTs: Date,
  limit: number
): Promise<Candle[]> {
  const { rows } = await pool.query(
    `SELECT ts, o, h, l, c, v, spread
     FROM candles_1m
     WHERE symbol = $1 AND ts <= $2 AND spread IS NOT NULL
     ORDER BY ts DESC
     LIMIT $3`,
    [symbol, endTs, limit]
  );

  return rows
    .map(
      (r): Candle => ({
        symbol: r.symbol,
        ts: new Date(r.ts),
        o: parseFloat(r.o),
        h: parseFloat(r.h),
        l: parseFloat(r.l),
        c: parseFloat(r.c),
        v: r.v ? parseInt(r.v, 10) : undefined,
        spread: r.spread ? parseFloat(r.spread) : undefined,
      })
    )
    .reverse();
}

function computeSpread(candles: Candle[]): SpreadOutput {
  const withSpread = candles.filter(
    (c) => typeof c.spread === "number" && Number.isFinite(c.spread)
  );

  if (withSpread.length === 0) {
    return { spread: null, samples: 0 };
  }

  const avg =
    withSpread.reduce((sum, c) => sum + (c.spread ?? 0), 0) / withSpread.length;

  return { spread: avg, samples: withSpread.length };
}

export const spreadFeature: FeatureDefinition<SpreadInput, SpreadOutput> = {
  name: "features_spread",
  version: "1.0.0",
  dependencies: [],

  compute(_input, context): SpreadOutput | Promise<SpreadOutput> {
    const pool = context?.pool as Pool | undefined;
    const symbol = context?.symbol;
    const endTs = context?.endTs;

    if (!pool || !symbol || !endTs) {
      return { spread: null, samples: 0 };
    }

    return fetchLatest1mSpreads(pool, symbol, endTs, 20).then(computeSpread);
  },

  hashInput(): string {
    // Runner appends symbol/tf/endTs to the input hash.
    return sha256("spread");
  },

  hashOutput(output): string {
    return sha256(`${output.spread ?? "null"}:${output.samples}`);
  },

  serialize(output): Record<string, unknown>[] {
    return [
      {
        spread: output.spread ?? null,
        samples: output.samples,
      },
    ];
  },

  deserialize(rows): SpreadOutput {
    const r = rows[0];
    if (!r) return { spread: null, samples: 0 };
    return {
      spread: r.spread === null ? null : (r.spread as number),
      samples: r.samples as number,
    };
  },
};
