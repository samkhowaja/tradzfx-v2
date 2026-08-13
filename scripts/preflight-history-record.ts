#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { buildPreflightHistoryRecord, type PreflightEnvelope } from "../packages/shared/src";

export function appendPreflightHistory(filePath: string, envelope: PreflightEnvelope, metadata?: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const record = buildPreflightHistoryRecord(envelope, metadata);
  // Windows append is atomic for one short write; keep one complete JSONL record per call.
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", flag: "a" });
}

function getArg(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=...`);
  return value.slice(name.length + 3);
}

if (process.argv[1]?.endsWith("preflight-history-record.ts")) {
  const envelope = JSON.parse(fs.readFileSync(getArg("input"), "utf8")) as PreflightEnvelope;
  appendPreflightHistory(getArg("output"), envelope);
}

export function readPreflightHistory(filePath: string): Array<ReturnType<typeof buildPreflightHistoryRecord>> {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function appendPreflightError(filePath: string, error: unknown, invocationId: string, metadata: Record<string, unknown> = {}): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const value = error instanceof Error ? error : new Error(String(error));
  fs.appendFileSync(filePath, `${JSON.stringify({
    evidenceVersion: "preflight-evidence-v1",
    invocationId,
    ...metadata,
    recorderStatus: "error_pre_envelope",
    status: { type: "ERROR", errorCode: value.name === "Error" ? "PREFLIGHT_ERROR" : value.name, message: value.message },
    errorType: value.name,
    errorMessage: value.message,
    phase: "pre_envelope",
    generatedAt: new Date().toISOString(),
  })}\n`, { encoding: "utf8", flag: "a" });
}