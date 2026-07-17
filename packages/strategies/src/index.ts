export * from "./compiler";
export * from "./riskCompiler";
export * from "./loader";
export * from "./dbLoader";

// Feature semantics contract — single source of truth for compiler, PIT backtest,
// live runner, and setup engine. Exported explicitly (not `export *`) to avoid
// collisions with the sqlBuilder re-exports below.
export {
  FEATURE_REGISTRY,
  getFeatureContract,
  listFeatureContracts,
  isEventFeature,
  isLevelFeature,
  isStateFeature,
  type FeatureContract,
  type FeatureSemanticType,
  type FeatureJoinPolicy,
  type FeatureValidityColumns,
} from "./featureRegistry";
export {
  getDefaultFreshnessMinutes,
  getDefaultLookbackBars,
  resolveOrbSession,
  buildOrbSessionScopedJoin,
  extractEqualityPushdowns,
} from "./sqlBuilder";
export { validateSpec, validateTemporalCoverage } from "./validate";
