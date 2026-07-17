"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TEXT_EXTENSIONS = new Set([
  ".cjs", ".js", ".json", ".jsx", ".mjs", ".ps1", ".ts", ".tsx", ".yaml", ".yml",
]);

const RULES = [
  {
    name: "PostgreSQL URL with embedded password",
    pattern: /postgres(?:ql)?:\/\/[^\s:'"/]+:(?![^\s@'"/]*\$\{)[^\s@'"/]+@/gi,
  },
  {
    name: "literal DB password property",
    pattern: /\bpassword\s*:\s*["'`](?!\s*(?:process\.env|\$\{|<|REDACTED|CHANGE_ME|example))[^"'`\r\n]+["'`]/gi,
  },
  {
    name: "literal TM_DB_PASSWORD assignment",
    pattern: /\bTM_DB_PASSWORD\s*=\s*(?!\s*(?:\.\.\.|["']?[<%$]|process\.env|REDACTED|CHANGE_ME|example))[^\s#;]+/gi,
  },
];

function trackedFiles() {
  const output = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return output.split("\0").filter(Boolean);
}

function main() {
  const findings = [];

  for (const relativePath of trackedFiles()) {
    if (!TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;

    const absolutePath = path.join(ROOT, relativePath);
    const content = fs.readFileSync(absolutePath, "utf8");

    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of content.matchAll(rule.pattern)) {
        const line = content.slice(0, match.index).split(/\r?\n/).length;
        findings.push(`${relativePath}:${line}: ${rule.name}`);
      }
    }
  }

  if (findings.length) {
    console.error("Hardcoded DB credential patterns found:");
    for (const finding of findings) console.error(`- ${finding}`);
    process.exitCode = 1;
    return;
  }

  console.log("No hardcoded DB credential patterns found in tracked text files.");
}

main();
