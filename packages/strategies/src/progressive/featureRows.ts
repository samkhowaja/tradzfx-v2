import type { Side } from "@tm/shared";
import { hashProgressiveValue } from "./hash";
import type { ProgressiveFeatureCandidate } from "./eventAdapter";
import type { ProgressivePlanNode } from "./types";

export type ProgressiveFeatureRow = Readonly<Record<string, unknown>>;

function text(row: ProgressiveFeatureRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Progressive feature row requires ${key}`);
  return value;
}

function timestamp(row: ProgressiveFeatureRow, key: string): string {
  const value = row[key];
  const parsed = value instanceof Date ? value : new Date(String(value ?? ""));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Progressive feature row requires valid ${key}`);
  return parsed.toISOString();
}

function nullableTimestamp(row: ProgressiveFeatureRow, key: string): string | null {
  return row[key] == null ? null : timestamp(row, key);
}

function tradeSide(direction: unknown, map: ProgressivePlanNode["directionMap"]): Side | null {
  if (map === "none") return null;
  if (direction !== "bullish" && direction !== "bearish") return null;
  const same: Side = direction === "bullish" ? "buy" : "sell";
  if (map === "same" || map === "liquidity_to_trade") return same;
  return same === "buy" ? "sell" : "buy";
}

function predicateMatches(node: ProgressivePlanNode, row: ProgressiveFeatureRow): boolean {
  switch (node.feature) {
    case "features_direction_state":
      return row.direction !== "neutral" && row.agreement === true;
    case "features_sweep":
      return row.direction === "bullish" || row.direction === "bearish";
    case "features_structure":
      if (node.predicate === "event_type IN ('mss','choch')") {
        return row.event_type === "mss" || row.event_type === "choch";
      }
      if (node.predicate === "event_type = 'bos' AND confirmed = true") {
        return row.event_type === "bos" && row.confirmed === true;
      }
      throw new Error(`Unsupported progressive structure predicate: ${node.predicate}`);
    default:
      throw new Error(`No progressive feature adapter for ${node.feature}`);
  }
}

/** Stable source cursor, including rows rejected by predicate adapters. */
export function progressiveFeatureRowCursor(
  node: ProgressivePlanNode,
  row: ProgressiveFeatureRow,
): { sourceTs: string; sourceKey: string } {
  const sourceTs = timestamp(row, "ts");
  const identityValues: Record<string, unknown> = {};
  for (const column of node.identityColumns) {
    if (!(column in row)) throw new Error(`Progressive feature row requires identity column ${column}`);
    identityValues[column] = row[column] instanceof Date ? timestamp(row, column) : row[column];
  }
  return { sourceTs, sourceKey: hashProgressiveValue(identityValues) };
}

/** Exact adapter for first shadow plan. Unknown feature/predicate contracts fail closed. */
export function adaptProgressiveFeatureRow(
  node: ProgressivePlanNode,
  row: ProgressiveFeatureRow,
): ProgressiveFeatureCandidate | null {
  if (!predicateMatches(node, row)) return null;
  const symbol = text(row, "symbol");
  const tf = text(row, "tf");
  const { sourceTs, sourceKey } = progressiveFeatureRowCursor(node, row);
  if (tf !== node.tf) throw new Error(`Progressive feature row tf ${tf} does not match ${node.id}@${node.tf}`);
  const confirmedBos = node.feature === "features_structure"
    && node.predicate === "event_type = 'bos' AND confirmed = true";
  const occurredAt = confirmedBos ? timestamp(row, "confirmation_ts") : sourceTs;
  if (confirmedBos && Date.parse(occurredAt) <= Date.parse(sourceTs)) {
    throw new Error("Confirmed BOS confirmation_ts must be after source ts");
  }
  const validTo = node.feature === "features_structure"
    ? nullableTimestamp(row, "invalidated_at")
    : node.feature === "features_sweep"
      ? nullableTimestamp(row, "mitigated_at")
      : null;
  if (confirmedBos && validTo && Date.parse(validTo) < Date.parse(occurredAt)) return null;
  const values = { ...row, ts: sourceTs, occurred_at: occurredAt };
  return {
    feature: node.feature,
    symbol,
    tf,
    sourceTs,
    sourceKey,
    occurredAt,
    validFrom: occurredAt,
    validTo,
    side: tradeSide(row.direction, node.directionMap),
    values,
  };
}
