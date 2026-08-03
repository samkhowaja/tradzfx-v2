import { createHash } from "node:crypto";

export function stableProgressiveJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableProgressiveJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableProgressiveJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashProgressiveValue(value: unknown): string {
  return createHash("sha256").update(stableProgressiveJson(value)).digest("hex");
}
