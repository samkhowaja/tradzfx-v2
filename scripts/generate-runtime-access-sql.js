#!/usr/bin/env node
"use strict";

/**
 * Deterministic SQL plan generator for runtime roles and exact access grants.
 * Prints SQL only. Never connects to PostgreSQL or executes generated SQL.
 */
const fs = require("node:fs");
const path = require("node:path");

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;
const PRIVILEGE_ORDER = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "USAGE", "EXECUTE"];

function quoteIdentifier(value) {
  if (!IDENTIFIER.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function quoteQualified(value) {
  return value.split(".").map(quoteIdentifier).join(".");
}

function sortPrivileges(privileges) {
  return [...privileges].sort((a, b) => PRIVILEGE_ORDER.indexOf(a) - PRIVILEGE_ORDER.indexOf(b));
}

function parseFunctionSignature(signature) {
  const match = signature.match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\((.*)\)$/i);
  if (!match) throw new Error(`Unsafe function signature: ${signature}`);
  return `${quoteIdentifier(match[1])}.${quoteIdentifier(match[2])}(${match[3]})`;
}

function generateRolePlan(roleName, roleContract, accessContract, options = {}) {
  const role = quoteIdentifier(roleName);
  if (!roleContract) throw new Error(`Unknown runtime role: ${roleName}`);
  if (!accessContract) throw new Error(`Missing access contract for: ${roleName}`);
  if (!accessContract.activationReady && !options.includeBlocked) {
    throw new Error(`${roleName} is not activation-ready: ${accessContract.blockers.join("; ")}`);
  }

  const lines = [
    `-- DRY-RUN PLAN: ${roleName}`,
    "-- Review, back up grants/ownership, and execute manually as an approved DBA change.",
    `CREATE ROLE ${role} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;`,
  ];

  for (const schema of [...accessContract.schemas].sort()) {
    lines.push(`GRANT USAGE ON SCHEMA ${quoteIdentifier(schema)} TO ${role};`);
  }
  for (const [relation, privileges] of Object.entries(accessContract.relations).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`GRANT ${sortPrivileges(privileges).join(", ")} ON TABLE ${quoteQualified(relation)} TO ${role};`);
  }
  for (const [sequence, privileges] of Object.entries(accessContract.sequences).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`GRANT ${sortPrivileges(privileges).join(", ")} ON SEQUENCE ${quoteQualified(sequence)} TO ${role};`);
  }
  for (const [fn, privileges] of Object.entries(accessContract.functions).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`GRANT ${sortPrivileges(privileges).join(", ")} ON FUNCTION ${parseFunctionSignature(fn)} TO ${role};`);
  }
  lines.push(`ALTER ROLE ${role} SET default_transaction_read_only = ${roleName === "tradzfx_web_read" ? "on" : "off"};`);
  lines.push("-- Authentication material intentionally omitted; provision through approved secret channel.");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const args = { role: null, includeBlocked: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--role") args.role = argv[++i];
    else if (argv[i] === "--include-blocked") args.includeBlocked = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!args.role) throw new Error("--role is required");
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, "..");
  const roles = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-role-contract.json"), "utf8"));
  const access = JSON.parse(fs.readFileSync(path.join(root, "infra/db/runtime-access-contract.json"), "utf8"));
  process.stdout.write(generateRolePlan(args.role, roles.runtimeRoles[args.role], access.roles[args.role], args));
}

module.exports = { generateRolePlan, parseArgs, quoteIdentifier, quoteQualified };
if (require.main === module) {
  try { main(); } catch (error) { console.error(`Runtime access plan failed: ${error.message}`); process.exit(2); }
}
