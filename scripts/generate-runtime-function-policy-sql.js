#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function parseIdentity(identity) {
  const match = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\((.*)\)$/.exec(identity);
  if (!match) throw new Error(`Invalid function identity: ${identity}`);
  return `${quoteIdentifier(match[1])}.${quoteIdentifier(match[2])}(${match[3]})`;
}

function parseArgs(argv) {
  const args = { mode: "apply", reviewBlocked: false };
  for (const arg of argv) {
    if (arg === "--rollback") args.mode = "rollback";
    else if (arg === "--review-blocked") args.reviewBlocked = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function validatePolicy(policy, roleContract) {
  const errors = [];
  const knownRoles = new Set(Object.keys(roleContract.runtimeRoles ?? {}));
  for (const [identity, entry] of Object.entries(policy.functions ?? {})) {
    try { parseIdentity(identity); } catch (error) { errors.push(error.message); }
    if (!Array.isArray(entry.evidence) || entry.evidence.length === 0) errors.push(`${identity}: evidence required`);
    if (!new Set([undefined, "FUNCTION", "PROCEDURE"]).has(entry.objectKind)) errors.push(`${identity}: invalid objectKind ${entry.objectKind}`);
    if (!Array.isArray(entry.grantRoles)) errors.push(`${identity}: grantRoles must be an array`);
    for (const role of entry.grantRoles ?? []) if (!knownRoles.has(role)) errors.push(`${identity}: unknown role ${role}`);
    if (!new Set(["approved", "blocked"]).has(entry.status)) errors.push(`${identity}: invalid status ${entry.status}`);
    if (entry.status === "blocked" && !entry.blocker) errors.push(`${identity}: blocked entry requires blocker`);
    if (entry.status === "approved" && entry.blocker) errors.push(`${identity}: approved entry cannot have blocker`);
  }
  return errors;
}

function generatePlan(policy, mode, reviewBlocked) {
  const entries = Object.entries(policy.functions).sort(([a], [b]) => a.localeCompare(b));
  const blocked = entries.filter(([, entry]) => entry.status === "blocked");
  if (blocked.length && !reviewBlocked) {
    throw new Error(`Function policy has ${blocked.length} blocker(s); use --review-blocked for commented review output`);
  }
  const lines = [
    `-- DRY-RUN ${mode.toUpperCase()} PLAN: runtime function policy`,
    "-- Print-only. Review and execute manually only after every blocker is resolved.",
  ];
  for (const [identity, entry] of entries) {
    const routine = parseIdentity(identity);
    const objectKind = entry.objectKind ?? "FUNCTION";
    const statements = mode === "apply"
      ? [`REVOKE EXECUTE ON ${objectKind} ${routine} FROM PUBLIC;`, ...entry.grantRoles.map((role) => `GRANT EXECUTE ON ${objectKind} ${routine} TO ${quoteIdentifier(role)};`)]
      : [...entry.grantRoles.map((role) => `REVOKE EXECUTE ON ${objectKind} ${routine} FROM ${quoteIdentifier(role)};`), `GRANT EXECUTE ON ${objectKind} ${routine} TO PUBLIC;`];
    if (entry.status === "blocked") {
      lines.push(`-- BLOCKED ${identity}: ${entry.blocker}`);
      for (const statement of statements) lines.push(`-- ${statement}`);
    } else {
      lines.push(...statements);
    }
  }
  lines.push("-- Authentication material intentionally omitted.");
  return `${lines.join("\n")}\n`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const policy = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-function-policy.json"), "utf8"));
  const roles = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-role-contract.json"), "utf8"));
  const errors = validatePolicy(policy, roles);
  if (errors.length) throw new Error(errors.join("\n"));
  process.stdout.write(generatePlan(policy, args.mode, args.reviewBlocked));
}

module.exports = { generatePlan, parseArgs, parseIdentity, validatePolicy };
if (require.main === module) {
  try { main(); } catch (error) { console.error(`Function policy plan failed: ${error.message}`); process.exit(2); }
}
