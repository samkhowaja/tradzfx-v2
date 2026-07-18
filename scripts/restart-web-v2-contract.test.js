"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const script = fs.readFileSync(
  path.resolve(__dirname, "..", "ops", "restart-web-v2.ps1"),
  "utf8"
);

test("web restart resolves exact PM2 processes instead of matching status table rows", () => {
  assert.match(script, /pm2 pid tz-ingestion/);
  assert.match(script, /\$ingestPid -match '\^\\d\+\$'/);
  assert.doesNotMatch(script, /pm2 status tz-ingestion/);
});

test("web restart removes legacy and canonical web names before binding port 3003", () => {
  assert.match(script, /@\('tm-web-v2', 'tz-web-v2'\)/);
  assert.match(script, /pm2 delete \$name/);
  assert.match(script, /pm2 start ecosystem\.config\.js --only tz-web-v2/);
});

test("web restart keeps ingestion health gates around web replacement", () => {
  const firstGate = script.indexOf("http://127.0.0.1:3004/health");
  const webDelete = script.indexOf("pm2 delete $name");
  const secondGate = script.lastIndexOf("http://127.0.0.1:3004/health");
  assert.ok(firstGate >= 0 && firstGate < webDelete);
  assert.ok(secondGate > webDelete);
  assert.match(script, /This script never restarts Postgres/);
});
