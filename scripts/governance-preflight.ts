#!/usr/bin/env node
import { closePool, getPool } from "../packages/shared/src";
import dotenv from "dotenv";
import {
  buildReadOnlyPreflightChecks,
  buildPreflightEnvelope,
  evaluatePreflight,
  type CandidateContext,
} from "../packages/shared/src";
import { appendPreflightError, appendPreflightHistory } from "./preflight-history-record";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { loadStrategyFromYaml, extractStrategyDependencies } from "../packages/strategies/src";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const invocationId = randomUUID();

function historyPath(): string {
  return process.argv.find((item) => item.startsWith("--history-file="))?.slice(15)
    ?? process.env.PREFLIGHT_HISTORY_FILE
    ?? path.resolve(process.cwd(), "reports", "preflight-history.jsonl");
}

function invocationMetadata(): Record<string, unknown> {
  const value = (name: string) => process.argv.find((item) => item.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  let commit: string | null = null;
  let branch: string | null = null;
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* evidence remains explicit */ }
  try { branch = execFileSync("git", ["branch", "--show-current"], { encoding: "utf8" }).trim() || null; } catch { /* evidence remains explicit */ }
  return {
    invocation: { strategy: value("strategy"), symbol: value("symbol"), timeframe: value("timeframe"), from: value("from"), to: value("to") },
    environment: { nodeEnv: process.env.NODE_ENV ?? null, tmEnv: process.env.TM_ENV ?? null },
    git: { commit, branch },
    status: { type: "PREFLIGHT_ATTEMPT" },
    dbConnected: false,
    writesAttempted: false,
  };
}

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=...`);
  return value.slice(name.length + 3);
}

function interval(name: string): string {
  const value = argument(name);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid --${name} interval timestamp`);
  return date.toISOString();
}

function optionalArgument(name: string): string | undefined {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  return value?.slice(name.length + 3);
}

async function main(): Promise<void> {
  console.log(`[preflight] starting cwd=${process.cwd()}`);
  const historyFile = historyPath();
  console.log(`[preflight] history=${historyFile}`);
  const candidate: CandidateContext = {
    strategyId: argument("strategy"),
    symbol: argument("symbol"),
    timeframe: argument("timeframe"),
    fromTs: interval("from"),
    toTs: interval("to"),
  };
  const specPath = path.resolve(process.cwd(), "packages", "strategies", "src", "specs", `${candidate.strategyId}.yaml`);
  const dependencies = extractStrategyDependencies(loadStrategyFromYaml(specPath));
  candidate.maxLookbackBars = dependencies.maxLookbackBars;
  candidate.dependencies = dependencies.dependencies;
  candidate.requiresDxy = dependencies.requiresDxy;
  candidate.lookbackTimeframe = dependencies.dependencies.some((item) => item.timeframe === "1h") ? "1h" : candidate.timeframe;

  const pool = getPool();
  console.log("[preflight] connecting to DB");
  const client = await pool.connect();
  console.log("[preflight] DB connection acquired");
  try {
    await client.query("BEGIN READ ONLY");
    const checks = await buildReadOnlyPreflightChecks(client, candidate);
    console.log("[preflight] read-only checks complete");
    const result = evaluatePreflight(candidate, checks);
    await client.query("ROLLBACK");
    const envelope = buildPreflightEnvelope(result);
    appendPreflightHistory(historyFile, envelope, { ...invocationMetadata(), dbConnected: true, status: { type: "PREFLIGHT_COMPLETE" } });
    console.log("[preflight] history record appended");
    console.log(JSON.stringify({ envelope, recordedTo: historyFile, invocationId }, null, 2));
    process.exitCode = result.verdict === "PROMOTION_ELIGIBLE_READONLY" ? 0 : 2;
  } finally {
    client.release();
    await closePool();
  }
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  try { appendPreflightError(historyPath(), error, invocationId, invocationMetadata()); }
  catch (recordingError) { console.error(recordingError instanceof Error ? recordingError.message : String(recordingError)); }
  await closePool();
  process.exitCode = 1;
});

process.on("uncaughtException", (error) => {
  console.error("[preflight] uncaught exception", error.message);
  process.exitCode = 1;
});
process.on("unhandledRejection", (reason) => {
  console.error("[preflight] unhandled rejection", reason instanceof Error ? reason.message : String(reason));
  process.exitCode = 1;
});
process.on("exit", (code) => console.log(`[preflight] process exit code=${code}`));