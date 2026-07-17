#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_PATH = path.resolve(
  process.env.TM_DB_SESSION_INVENTORY_PATH || path.join(ROOT, "logs", "db-session-inventory.jsonl")
);
const INTERVAL_MS = positiveInteger("TM_DB_SESSION_INVENTORY_INTERVAL_MS", 3_600_000);
const RETENTION_DAYS = positiveInteger("TM_DB_SESSION_INVENTORY_RETENTION_DAYS", 8);

function positiveInteger(name, fallback) {
  const raw = process.env[name] || String(fallback);
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}

function parseSnapshots(text) {
  const snapshots = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value.capturedAt && Array.isArray(value.sessions)) snapshots.push(value);
    } catch {
      // Corrupt lines stay excluded from analysis and disappear after retention rewrite.
    }
  }
  return snapshots;
}

function pruneSnapshots(snapshots, now = Date.now(), retentionDays = RETENTION_DAYS) {
  const cutoff = now - retentionDays * 86_400_000;
  return snapshots.filter((snapshot) => Date.parse(snapshot.capturedAt) >= cutoff);
}

function summarizeSnapshots(snapshots) {
  let maxSessions = 0;
  let unattributedSamples = 0;
  const applications = new Set();
  for (const snapshot of snapshots) {
    let total = 0;
    let unattributed = false;
    for (const group of snapshot.sessions) {
      total += Number(group.sessions) || 0;
      applications.add(group.application_name);
      if (group.application_name === "(empty)" || group.application_name === "tradzfx-unattributed") {
        unattributed = true;
      }
    }
    maxSessions = Math.max(maxSessions, total);
    if (unattributed) unattributedSamples += 1;
  }
  return {
    samples: snapshots.length,
    maxSessions,
    unattributedSamples,
    applications: [...applications].sort(),
  };
}

function pruneInventory() {
  if (!fs.existsSync(OUTPUT_PATH)) return [];
  const retained = pruneSnapshots(parseSnapshots(fs.readFileSync(OUTPUT_PATH, "utf8")));
  const content = retained.map((snapshot) => JSON.stringify(snapshot)).join("\n");
  fs.writeFileSync(OUTPUT_PATH, content ? `${content}\n` : "", "utf8");
  return retained;
}

function collect() {
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, "audit-db-sessions.js"), "--json", "--append", OUTPUT_PATH],
    { cwd: ROOT, env: process.env, encoding: "utf8" }
  );
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "session audit failed").trim());
  const retained = pruneInventory();
  console.log(JSON.stringify({ event: "db_session_inventory", ...summarizeSnapshots(retained) }));
}

function main() {
  const once = process.argv.slice(2).includes("--once");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--once");
  if (unknown.length > 0) throw new Error(`Unknown argument: ${unknown[0]}`);
  collect();
  if (once) return;
  const timer = setInterval(() => {
    try {
      collect();
    } catch (error) {
      console.error(`[db-session-inventory] ${error.message}`);
    }
  }, INTERVAL_MS);
  const shutdown = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[db-session-inventory] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parseSnapshots, pruneSnapshots, summarizeSnapshots };
