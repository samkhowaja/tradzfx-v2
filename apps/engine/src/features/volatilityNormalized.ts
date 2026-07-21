import type {
  AtrOutput,
  Candle,
  FeatureDefinition,
  TimeFrame,
  VolatilityNormalizedOutput,
} from "@tm/shared";
import { getRegistryPipSize, getSession, sha256 } from "@tm/shared";

export interface VolatilityNormalizedInput {
  candles: Candle[];
  features_atr?: AtrOutput;
}

const PERIOD = 5;
const WINDOW_SIZE = 1_000;
const MIN_SAMPLE_COUNT = 100;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function regimeForRank(rank: number): VolatilityNormalizedOutput["values"][number]["regime"] {
  if (rank < 0.05) return "extreme_low";
  if (rank < 0.25) return "low";
  if (rank < 0.75) return "normal";
  if (rank < 0.95) return "high";
  return "extreme_high";
}

export async function computeVolatilityNormalized(
  input: VolatilityNormalizedInput,
  context?: { tf: TimeFrame; pool?: any; symbol?: string; endTs?: Date }
): Promise<VolatilityNormalizedOutput> {
  const candle = input.candles[input.candles.length - 1];
  const atr = input.features_atr?.values.find((value) => value.period === PERIOD);
  const symbol = context?.symbol ?? candle?.symbol;
  const endTs = context?.endTs ?? candle?.ts;
  const closePrice = candle?.c ?? 0;
  const atrRaw = Number(atr?.value);
  const atrEffective = Number(atr?.effectiveValue ?? atr?.value);
  const pipSize = symbol ? getRegistryPipSize(symbol) : 0;
  const session = getSession(endTs?.getUTCHours() ?? 0);

  if (
    !symbol ||
    !endTs ||
    !context?.pool ||
    !Number.isFinite(closePrice) || closePrice <= 0 ||
    !Number.isFinite(atrRaw) || atrRaw <= 0 ||
    !Number.isFinite(atrEffective) || atrEffective <= 0 ||
    !Number.isFinite(pipSize) || pipSize <= 0
  ) {
    return { values: [] };
  }

  const { rows } = await context.pool.query(
    `SELECT ts, value, effective_value, engine_ver
       FROM features_atr
      WHERE symbol = $1 AND tf = $2 AND period = $3 AND ts <= $4
      ORDER BY ts DESC
      LIMIT $5`,
    [symbol, context.tf, PERIOD, endTs, WINDOW_SIZE * 5]
  );

  const historical = rows
    .map((row: Record<string, unknown>) => ({
      ts: new Date(row.ts as string),
      value: Number(row.effective_value ?? row.value),
      engineVer: row.engine_ver as string | undefined,
    }))
    .filter((row: { ts: Date; value: number }) =>
      Number.isFinite(row.value) && row.value > 0 && getSession(row.ts.getUTCHours()) === session
    )
    .slice(0, WINDOW_SIZE);

  if (!historical.some((row: { ts: Date }) => row.ts.getTime() === endTs.getTime())) {
    historical.unshift({ ts: endTs, value: atrEffective, engineVer: undefined });
    if (historical.length > WINDOW_SIZE) historical.pop();
  }

  historical.sort((a: { ts: Date }, b: { ts: Date }) => a.ts.getTime() - b.ts.getTime());
  const atrPips = atrEffective / pipSize;
  const atrBps = (10_000 * atrEffective) / closePrice;
  const logs: number[] = historical.map((row: { value: number }) => Math.log(row.value / pipSize));
  const currentLog = Math.log(atrPips);
  const sampleCount = logs.length;
  const med = median(logs);
  const mad = median(logs.map((value: number) => Math.abs(value - med)));
  const percentileRank = sampleCount > 0
    ? logs.filter((value: number) => value <= currentLog).length / sampleCount
    : undefined;
  const robustZ = mad > 0 ? (0.67448975 * (currentLog - med)) / mad : 0;
  const warmup = sampleCount < MIN_SAMPLE_COUNT;

  return {
    values: [{
      period: PERIOD,
      session,
      atrRaw,
      atrEffective,
      pipSize,
      closePrice,
      atrPips,
      atrBps,
      percentileRank,
      robustZ,
      regime: percentileRank === undefined ? undefined : regimeForRank(percentileRank),
      sampleCount,
      sampleStart: historical[0]?.ts,
      sourceAtrEngineVer: historical[historical.length - 1]?.engineVer,
      isValid: !warmup,
      qualityReason: warmup ? "warmup" : mad === 0 ? "zero_mad" : atr?.qualityReason,
    }],
  };
}

export const volatilityNormalizedFeature: FeatureDefinition<
  VolatilityNormalizedInput,
  VolatilityNormalizedOutput
> = {
  name: "features_volatility_normalized",
  version: "1.0.0",
  dependencies: ["features_atr"],
  compute: computeVolatilityNormalized,
  hashInput(input): string {
    const candle = input.candles[input.candles.length - 1];
    const atr = input.features_atr?.values.find((value) => value.period === PERIOD);
    return sha256(
      `volatility_normalized:v1:${candle?.ts.toISOString() ?? ""}:${candle?.c ?? ""}:` +
      `${atr?.value ?? ""}:${atr?.effectiveValue ?? ""}:${atr?.qualityReason ?? ""}`
    );
  },
  hashOutput(output): string {
    return sha256(JSON.stringify(output));
  },
  serialize(output): Record<string, unknown>[] {
    return output.values.map((value) => ({
      period: value.period,
      session: value.session,
      atr_raw: value.atrRaw,
      atr_effective: value.atrEffective,
      pip_size: value.pipSize,
      close_price: value.closePrice,
      atr_pips: value.atrPips,
      atr_bps: value.atrBps,
      percentile_rank: value.percentileRank,
      robust_z: value.robustZ,
      regime: value.regime,
      sample_count: value.sampleCount,
      sample_start: value.sampleStart,
      source_atr_engine_ver: value.sourceAtrEngineVer,
      is_valid: value.isValid,
      quality_reason: value.qualityReason,
    }));
  },
  deserialize(rows): VolatilityNormalizedOutput {
    return { values: rows.map((row) => ({
      period: Number(row.period),
      session: row.session as VolatilityNormalizedOutput["values"][number]["session"],
      atrRaw: Number(row.atr_raw),
      atrEffective: Number(row.atr_effective),
      pipSize: Number(row.pip_size),
      closePrice: Number(row.close_price),
      atrPips: Number(row.atr_pips),
      atrBps: Number(row.atr_bps),
      percentileRank: row.percentile_rank == null ? undefined : Number(row.percentile_rank),
      robustZ: row.robust_z == null ? undefined : Number(row.robust_z),
      regime: row.regime as VolatilityNormalizedOutput["values"][number]["regime"],
      sampleCount: Number(row.sample_count),
      sampleStart: row.sample_start ? new Date(row.sample_start as string) : undefined,
      sourceAtrEngineVer: row.source_atr_engine_ver as string | undefined,
      isValid: Boolean(row.is_valid),
      qualityReason: row.quality_reason as string | undefined,
    })) };
  },
};
