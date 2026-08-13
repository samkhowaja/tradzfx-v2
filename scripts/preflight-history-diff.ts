#!/usr/bin/env node
import fs from "node:fs";
import { hashPreflightEvidence, type PreflightEnvelope } from "../packages/shared/src";

function arg(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=...`);
  return value.slice(name.length + 3);
}

function load(path: string): PreflightEnvelope {
  const text = fs.readFileSync(path, "utf8").trim();
  const line = text.split(/\r?\n/).filter(Boolean).at(-1);
  const record = JSON.parse(line ?? text) as { envelope?: PreflightEnvelope } | PreflightEnvelope;
  return "envelope" in record && record.envelope ? record.envelope : record;
}

const from = load(arg("from-file"));
const to = load(arg("to-file"));
const fromCodes = new Set(from.blockers.map((item) => item.code));
const toCodes = new Set(to.blockers.map((item) => item.code));
console.log(JSON.stringify({
  mode: "READ_ONLY_PREFLIGHT_DIFF",
  from: { verdict: from.verdict, evidenceHash: hashPreflightEvidence(from) },
  to: { verdict: to.verdict, evidenceHash: hashPreflightEvidence(to) },
  changed: hashPreflightEvidence(from) !== hashPreflightEvidence(to),
  resolvedBlockers: [...fromCodes].filter((code) => !toCodes.has(code)),
  newBlockers: [...toCodes].filter((code) => !fromCodes.has(code)),
}, null, 2));