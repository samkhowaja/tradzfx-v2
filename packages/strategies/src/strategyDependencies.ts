import type { DxyDependency, StrategySpec, TimeFrame } from "@tm/shared";
import { extractRequiredFeatures } from "./compiler";
import { getFeatureContract } from "./featureRegistry";

export interface StrategyDependency {
  feature: string;
  timeframe: TimeFrame;
  lookbackBars: number;
  confirmationLookbackBars: number;
  closedBarRequired: boolean;
}

export interface StrategyDependencies {
  strategyId: string;
  dependencies: StrategyDependency[];
  maxLookbackBars: number;
  requiresDxy: boolean;
  dxyDependency: DxyDependency;
  sessions: string[];
}

export function resolveDxyDependency(spec: StrategySpec): DxyDependency {
  if (spec.dxyDependency) return spec.dxyDependency;
  if (spec.id === "watukushay_no1") return "not_required";
  const serialized = JSON.stringify(spec);
  return /\bDXY\b/i.test(serialized) ? "required" : "not_required";
}

export function extractStrategyDependencies(spec: StrategySpec): StrategyDependencies {
  const dependencies = [...extractRequiredFeatures(spec)].map((key) => {
    const at = key.lastIndexOf("@");
    const feature = key.slice(0, at);
    const timeframe = key.slice(at + 1) as TimeFrame;
    const contract = getFeatureContract(feature);
    const lookbackBars = contract.defaultLookbackBarsByTf?.[timeframe] ?? contract.defaultLookbackBars;
    const confirmationLookbackBars = contract.confirmationLookbackBarsByTf?.[timeframe]
      ?? contract.confirmationLookbackBars ?? 0;
    return {
      feature,
      timeframe,
      lookbackBars,
      confirmationLookbackBars,
      closedBarRequired: true,
    };
  }).sort((a, b) => a.feature.localeCompare(b.feature) || a.timeframe.localeCompare(b.timeframe));

  // watukushay_no1 uses SMA(250) at 1h; registry lookback is not enough to
  // prove slow-MA readiness, so retain the transitive strategy requirement.
  const maxLookbackBars = Math.max(
    spec.id === "watukushay_no1" ? 250 : 0,
    ...dependencies.map((item) => item.lookbackBars + item.confirmationLookbackBars),
    50,
  );
  const sessions = (spec.filters?.sessions ?? []).map(String);
  const dxyDependency = resolveDxyDependency(spec);
  return {
    strategyId: spec.id,
    dependencies,
    maxLookbackBars,
    requiresDxy: dxyDependency === "required",
    dxyDependency,
    sessions,
  };
}
