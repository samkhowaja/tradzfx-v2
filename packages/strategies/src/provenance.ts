/**
 * Manually bumped compatibility contracts for immutable compiled artifacts.
 *
 * Bump COMPILER_CONTRACT_VERSION when generated SQL shape, parameter semantics,
 * or compilation behavior changes. Bump FEATURE_REGISTRY_CONTRACT_VERSION when
 * feature join, lifecycle, freshness, or required-column semantics change.
 */
export const COMPILER_CONTRACT_VERSION = "pit-sql-v1";
export const FEATURE_REGISTRY_CONTRACT_VERSION = "feature-registry-v1";

export function resolveSourceRevision(): string {
  const revision = process.env.GIT_COMMIT?.trim()
    || process.env.SOURCE_REVISION?.trim()
    || process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  return revision || "unversioned-working-tree";
}
