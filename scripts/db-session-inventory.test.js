"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  parseSnapshots,
  pruneSnapshots,
  summarizeSnapshots,
} = require("./db-session-inventory.js");

test("parseSnapshots ignores corrupt and structurally invalid lines", () => {
  const parsed = parseSnapshots([
    "not-json",
    JSON.stringify({ capturedAt: "2026-07-17T00:00:00.000Z" }),
    JSON.stringify({
      capturedAt: "2026-07-17T01:00:00.000Z",
      sessions: [{ application_name: "tradzfx-web", state: "idle", sessions: 2 }],
    }),
  ].join("\n"));
  assert.equal(parsed.length, 1);
});

test("pruneSnapshots retains only configured rolling window", () => {
  const now = Date.parse("2026-07-17T12:00:00.000Z");
  const retained = pruneSnapshots(
    [
      { capturedAt: "2026-07-08T11:59:59.000Z", sessions: [] },
      { capturedAt: "2026-07-10T12:00:00.000Z", sessions: [] },
    ],
    now,
    7
  );
  assert.deepEqual(retained.map((row) => row.capturedAt), ["2026-07-10T12:00:00.000Z"]);
});

test("summarizeSnapshots reports peak sessions and unattributed samples", () => {
  const summary = summarizeSnapshots([
    {
      capturedAt: "2026-07-17T00:00:00.000Z",
      sessions: [
        { application_name: "tradzfx-web", state: "idle", sessions: 3 },
        { application_name: "tradzfx-ingestion", state: "active", sessions: 2 },
      ],
    },
    {
      capturedAt: "2026-07-17T01:00:00.000Z",
      sessions: [
        { application_name: "tradzfx-web", state: "idle", sessions: 4 },
        { application_name: "(empty)", state: "idle", sessions: 1 },
      ],
    },
  ]);
  assert.deepEqual(summary, {
    samples: 2,
    maxSessions: 5,
    unattributedSamples: 1,
    applications: ["(empty)", "tradzfx-ingestion", "tradzfx-web"],
  });
});
