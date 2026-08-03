/**
 * Helper to read an env-var override for any numeric param.
 * Falls back to `defaultVal` when unset or unparseable.
 */
export function envNum(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return defaultVal;
  const n = Number(raw);
  return Number.isFinite(n) ? n : defaultVal;
}
