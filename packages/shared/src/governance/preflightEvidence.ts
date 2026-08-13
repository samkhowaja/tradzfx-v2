import { createHash } from "node:crypto";
import type { PreflightEnvelope } from "./preflightEvaluator";

export const PREFLIGHT_EVIDENCE_VERSION = "preflight-evidence-v1" as const;

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "generatedAt")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, sort(item)]));
}

export function canonicalizePreflightEvidence(envelope: PreflightEnvelope): string {
  return JSON.stringify(sort(envelope));
}

export function hashPreflightEvidence(envelope: PreflightEnvelope): string {
  return createHash("sha256").update(canonicalizePreflightEvidence(envelope), "utf8").digest("hex");
}

export interface PreflightHistoryRecord {
  evidenceVersion: typeof PREFLIGHT_EVIDENCE_VERSION;
  evidenceHash: string;
  envelope: PreflightEnvelope;
  metadata?: Record<string, unknown>;
}

export function buildPreflightHistoryRecord(envelope: PreflightEnvelope, metadata?: Record<string, unknown>): PreflightHistoryRecord {
  return { evidenceVersion: PREFLIGHT_EVIDENCE_VERSION, evidenceHash: hashPreflightEvidence(envelope), envelope, ...(metadata ? { metadata } : {}) };
}