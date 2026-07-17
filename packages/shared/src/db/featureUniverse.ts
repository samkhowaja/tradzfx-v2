import type { Pool } from "pg";
import type { TimeFrame } from "../types/feature";

export const FEATURE_PIPELINE_TIMEFRAMES: readonly TimeFrame[] = [
  "1m", "5m", "15m", "1h", "4h", "1d",
];

export interface FeaturePipelineSymbol {
  symbol: string;
  enabled: boolean;
  canonicalBrokerId: string | null;
  requiredTimeframes: TimeFrame[];
  requiredFeatureProfile: string;
  profileVersion: number;
  expectedDataClockLagSeconds: number;
  changedAt: Date;
  changedBy: string;
}

interface FeaturePipelineSymbolRow {
  symbol: string;
  enabled: boolean;
  canonical_broker_id: string | null;
  required_timeframes: string[];
  required_feature_profile: string;
  profile_version: number;
  expected_data_clock_lag_seconds: number;
  changed_at: Date;
  changed_by: string;
}

const VALID_TIMEFRAMES = new Set<string>(FEATURE_PIPELINE_TIMEFRAMES);

function mapRow(row: FeaturePipelineSymbolRow): FeaturePipelineSymbol {
  const invalid = row.required_timeframes.filter((tf) => !VALID_TIMEFRAMES.has(tf));
  if (invalid.length > 0) {
    throw new Error(`Invalid feature-universe timeframes for ${row.symbol}: ${invalid.join(",")}`);
  }
  if (row.required_timeframes.length === 0) {
    throw new Error(`Feature universe has no timeframes for ${row.symbol}`);
  }

  return {
    symbol: row.symbol,
    enabled: row.enabled,
    canonicalBrokerId: row.canonical_broker_id,
    requiredTimeframes: row.required_timeframes as TimeFrame[],
    requiredFeatureProfile: row.required_feature_profile,
    profileVersion: row.profile_version,
    expectedDataClockLagSeconds: row.expected_data_clock_lag_seconds,
    changedAt: new Date(row.changed_at),
    changedBy: row.changed_by,
  };
}

const SELECT_COLUMNS = `
  symbol, enabled, canonical_broker_id, required_timeframes,
  required_feature_profile, profile_version,
  expected_data_clock_lag_seconds, changed_at, changed_by
`;

export async function listEnabledFeaturePipelineSymbols(
  pool: Pick<Pool, "query">
): Promise<FeaturePipelineSymbol[]> {
  const { rows } = await pool.query<FeaturePipelineSymbolRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM ops.feature_pipeline_symbols
     WHERE enabled = true
     ORDER BY symbol`
  );
  return rows.map(mapRow);
}

export async function getFeaturePipelineSymbol(
  pool: Pick<Pool, "query">,
  symbol: string
): Promise<FeaturePipelineSymbol | null> {
  const normalized = symbol.trim().toUpperCase();
  const { rows } = await pool.query<FeaturePipelineSymbolRow>(
    `SELECT ${SELECT_COLUMNS}
     FROM ops.feature_pipeline_symbols
     WHERE symbol = $1`,
    [normalized]
  );
  return rows[0] ? mapRow(rows[0]) : null;
}
