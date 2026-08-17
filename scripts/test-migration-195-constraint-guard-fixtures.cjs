#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const migrationSql = fs.readFileSync(path.resolve(__dirname, '..', 'infra/migrations/195_pending_raw_candle_evidence.sql'), 'utf8');

const TARGET_RELATION_OID = 'market.pending_raw_candle_evidence';
const TARGET_NAME = 'pending_raw_candle_evidence_source_key_nonempty';
const EXPECTED_TYPE = 'c';
const EXPECTED_DEFINITION = "CHECK (btrim(source_key) <> ''::text)";

function extractGuardContract(sql) {
  const relationMatch = sql.match(/conrelid\s*=\s*'([^']+)'::regclass/i);
  const nameMatch = sql.match(/conname\s*=\s*'([^']+)'/i);
  assert.ok(relationMatch && nameMatch, 'migration guard contract not found');
  return { relation: relationMatch[1], name: nameMatch[1] };
}

const guardContract = extractGuardContract(migrationSql);

function guardMatches(constraint) {
  return constraint.conrelid === guardContract.relation && constraint.conname === guardContract.name;
}

function contractMatches(constraint) {
  return guardMatches(constraint) && constraint.contype === EXPECTED_TYPE && constraint.convalidated === true && constraint.definition === EXPECTED_DEFINITION;
}

const fixtures = [
  {
    name: 'same name on another relation',
    constraint: { conrelid: 'market.other_relation', conname: TARGET_NAME, contype: 'c', convalidated: true, definition: EXPECTED_DEFINITION },
    guard: false,
    contract: false,
    planned: 'create',
  },
  {
    name: 'correct constraint on exact target relation',
    constraint: { conrelid: TARGET_RELATION_OID, conname: TARGET_NAME, contype: 'c', convalidated: true, definition: EXPECTED_DEFINITION },
    guard: true,
    contract: true,
    planned: 'skip',
  },
  {
    name: 'same name on target with wrong definition',
    constraint: { conrelid: TARGET_RELATION_OID, conname: TARGET_NAME, contype: 'c', convalidated: true, definition: "CHECK (source_key <> ''::text)" },
    guard: true,
    contract: false,
    planned: 'fail',
  },
  {
    name: 'correct expression under different name',
    constraint: { conrelid: TARGET_RELATION_OID, conname: 'wrong_constraint_name', contype: 'c', convalidated: true, definition: EXPECTED_DEFINITION },
    guard: false,
    contract: false,
    planned: 'create',
  },
  {
    name: 'schema-identical relation same name',
    constraint: { conrelid: 'market.pending_raw_candle_evidence_shadow', conname: TARGET_NAME, contype: 'c', convalidated: true, definition: EXPECTED_DEFINITION },
    guard: false,
    contract: false,
    planned: 'create',
  },
  {
    name: 'target constraint wrong type',
    constraint: { conrelid: TARGET_RELATION_OID, conname: TARGET_NAME, contype: 'u', convalidated: true, definition: EXPECTED_DEFINITION },
    guard: true,
    contract: false,
    planned: 'fail',
  },
];

for (const fixture of fixtures) {
  assert.equal(guardMatches(fixture.constraint), fixture.guard, `${fixture.name}: guard result`);
  assert.equal(contractMatches(fixture.constraint), fixture.contract, `${fixture.name}: contract result`);
  const planned = contractMatches(fixture.constraint) ? 'skip' : guardMatches(fixture.constraint) ? 'fail' : 'create';
  assert.equal(planned, fixture.planned, `${fixture.name}: migration plan`);
}

console.log(JSON.stringify({
  status: 'STATIC_MIGRATION_195_CONSTRAINT_FIXTURES_PASS',
  database_writes: 0,
  migration_executed: false,
  migration_guard_extracted: guardContract,
  fixtures: fixtures.map(({ name, planned }) => ({ name, planned })),
  target_relation: guardContract.relation,
  target_constraint: guardContract.name,
}, null, 2));
