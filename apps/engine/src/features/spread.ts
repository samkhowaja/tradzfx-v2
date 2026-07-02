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

interface SpreadSample {
  spreadPips: number;
}

async function fetchLatest1mSpreads(
  pool: Pool,
  symbol: string,
  endTs: Date,
  limit: number
): Promise<SpreadSample[]> {
  const { rows } = await pool.query(
    `SELECT spread, digits
       FROM candles_1m
      WHERE symbol = $1 AND ts <= $2 AND spread IS NOT NULL
      ORDER BY ts DESC
      LIMIT $3`,
    [symbol, endTs, limit]
  );

  return rows
    .map((r): SpreadSample | null => {
      const spread = r.spread == null ? null : Number(r.spread);
      if (spread == null || !Number.isFinite(spread)) return null;
      return { spreadPips: spread };
    })
    .filter((s): s is SpreadSample => s != null)
    .reverse();
}

function computeSpread(samples: SpreadSample[]): SpreadOutput {
  if (samples.length === 0) {
    return { spread: null, samples: 0 };
  }

  const avgPips =
    samples.reduce((sum, s) => sum + s.spreadPips, 0) / samples.length;

  return { spread: avgPips, samples: samples.length };
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
    // v1.2.0: candles_1m.spread is already in pips, so we average directly.
    return sha256("spread:v1.2.0");
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
