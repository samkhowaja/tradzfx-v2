/**
 * Migration linter.
 *
 * Enforces idempotency conventions for SQL migrations:
 * - CREATE TABLE / INDEX / EXTENSION / MATERIALIZED VIEW → IF NOT EXISTS
 * - CREATE FUNCTION / VIEW / TRIGGER → OR REPLACE
 * - ALTER TABLE ADD COLUMN / ADD CONSTRAINT → IF NOT EXISTS
 * - ALTER TABLE DROP COLUMN / DROP CONSTRAINT → IF EXISTS
 * - INSERT INTO → ON CONFLICT
 * - No bare ADD PRIMARY KEY (use an idempotent guard)
 * - No bare DROP TABLE / INDEX (use IF EXISTS)
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

interface Rule {
  name: string;
  pattern: RegExp;
  message: string;
}

const rules: Rule[] = [
  {
    name: "CREATE TABLE without IF NOT EXISTS",
    pattern: /^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use CREATE TABLE IF NOT EXISTS",
  },
  {
    name: "CREATE INDEX without IF NOT EXISTS",
    pattern: /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use CREATE INDEX IF NOT EXISTS / CREATE UNIQUE INDEX IF NOT EXISTS",
  },
  {
    name: "CREATE EXTENSION without IF NOT EXISTS",
    pattern: /^CREATE\s+EXTENSION\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use CREATE EXTENSION IF NOT EXISTS",
  },
  {
    name: "CREATE MATERIALIZED VIEW without IF NOT EXISTS",
    pattern: /^CREATE\s+MATERIALIZED\s+VIEW\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use CREATE MATERIALIZED VIEW IF NOT EXISTS",
  },
  {
    name: "CREATE FUNCTION without OR REPLACE",
    pattern: /^CREATE\s+FUNCTION\s+(?!OR\s+REPLACE\b)/im,
    message: "Use CREATE OR REPLACE FUNCTION",
  },
  {
    name: "CREATE VIEW without OR REPLACE",
    pattern: /^CREATE\s+VIEW\s+(?!OR\s+REPLACE\b)/im,
    message: "Use CREATE OR REPLACE VIEW",
  },
  {
    name: "CREATE TRIGGER without OR REPLACE",
    pattern: /^CREATE\s+TRIGGER\s+(?!OR\s+REPLACE\b)/im,
    message: "Use CREATE OR REPLACE TRIGGER",
  },
  {
    name: "ALTER TABLE ADD COLUMN without IF NOT EXISTS",
    pattern: /ALTER\s+TABLE\s+\w+\s+ADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use ALTER TABLE ... ADD COLUMN IF NOT EXISTS",
  },
  {
    name: "ALTER TABLE ADD CONSTRAINT without IF NOT EXISTS",
    pattern: /ALTER\s+TABLE\s+\w+\s+ADD\s+CONSTRAINT\s+(?!IF\s+NOT\s+EXISTS\b)/im,
    message: "Use ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS",
  },
  {
    name: "Bare ADD PRIMARY KEY",
    pattern: /^ALTER\s+TABLE\s+\w+\s+ADD\s+PRIMARY\s+KEY/im,
    message: "Wrap ADD PRIMARY KEY in an idempotent guard (DO block checking pg_constraint)",
  },
  {
    name: "ALTER TABLE DROP COLUMN without IF EXISTS",
    pattern: /ALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN\s+(?!IF\s+EXISTS\b)/im,
    message: "Use ALTER TABLE ... DROP COLUMN IF EXISTS",
  },
  {
    name: "ALTER TABLE DROP CONSTRAINT without IF EXISTS",
    pattern: /ALTER\s+TABLE\s+\w+\s+DROP\s+CONSTRAINT\s+(?!IF\s+EXISTS\b)/im,
    message: "Use ALTER TABLE ... DROP CONSTRAINT IF EXISTS",
  },
  {
    name: "DROP TABLE without IF EXISTS",
    pattern: /^DROP\s+TABLE\s+(?!IF\s+EXISTS\b)/im,
    message: "Use DROP TABLE IF EXISTS",
  },
  {
    name: "DROP INDEX without IF EXISTS",
    pattern: /^DROP\s+INDEX\s+(?!IF\s+EXISTS\b)/im,
    message: "Use DROP INDEX IF EXISTS",
  },
  {
    name: "INSERT INTO without ON CONFLICT",
    pattern: /^INSERT\s+INTO\s+\w+\b(?![\s\S]*?ON\s+CONFLICT)/im,
    message: "Use INSERT ... ON CONFLICT DO NOTHING/UPDATE",
  },
];

function lintFile(path: string): string[] {
  const sql = readFileSync(path, "utf-8");
  const issues: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(sql)) {
      issues.push(`${rule.name}: ${rule.message}`);
    }
  }
  return issues;
}

function main() {
  const migrationsDir = join(process.cwd(), "infra", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  let totalIssues = 0;
  for (const file of files) {
    const issues = lintFile(join(migrationsDir, file));
    if (issues.length > 0) {
      totalIssues += issues.length;
      console.log(`\n${file}:`);
      for (const issue of issues) {
        console.log(`  - ${issue}`);
      }
    }
  }

  if (totalIssues === 0) {
    console.log(`[lint-migrations] ✓ All ${files.length} migrations are idempotent.`);
    process.exit(0);
  } else {
    console.log(
      `\n[lint-migrations] ✗ ${totalIssues} issue(s) in ${files.length} migration files.`
    );
    process.exit(1);
  }
}

main();
