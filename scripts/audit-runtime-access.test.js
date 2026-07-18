#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { comparePrivileges } = require("./audit-runtime-access.js");

const contract = {
  schemas: ["public"],
  relations: { "public.orders": ["SELECT"] },
  sequences: { "public.orders_id_seq": ["USAGE"] },
  functions: { "public.do_work(text)": ["EXECUTE"] },
};

test("exact effective privilege catalog passes", () => {
  const result = comparePrivileges("role", contract, {
    roleExists: true,
    relations: { "public.orders": ["SELECT"] },
    sequences: { "public.orders_id_seq": ["USAGE"] },
    functions: { "public.do_work(text)": ["EXECUTE"] },
  });
  assert.deepEqual(result.errors, []);
});

test("missing role fails clearly", () => {
  assert.deepEqual(comparePrivileges("role", contract, { roleExists: false }).errors, ["MISSING_ROLE role"]);
});

test("missing and extra relation privileges fail", () => {
  const result = comparePrivileges("role", contract, {
    roleExists: true,
    relations: { "public.orders": ["UPDATE"], "public.secret": ["SELECT"] },
    sequences: { "public.orders_id_seq": [] },
    functions: { "public.do_work(text)": [] },
  });
  assert.deepEqual(result.errors, [
    "MISSING_RELATION_PRIVILEGE role public.orders SELECT",
    "EXTRA_RELATION_PRIVILEGE role public.orders UPDATE",
    "EXTRA_RELATION_PRIVILEGE role public.secret SELECT",
    "MISSING_SEQUENCE_PRIVILEGE role public.orders_id_seq USAGE",
    "MISSING_FUNCTION_PRIVILEGE role public.do_work(text) EXECUTE",
  ]);
});

test("undeclared sequence and function privileges fail", () => {
  const result = comparePrivileges("role", contract, {
    roleExists: true,
    relations: { "public.orders": ["SELECT"] },
    sequences: { "public.orders_id_seq": ["USAGE"], "public.secret_seq": ["USAGE"] },
    functions: { "public.do_work(text)": ["EXECUTE"], "public.secret()": ["EXECUTE"] },
  });
  assert.deepEqual(result.errors, [
    "EXTRA_SEQUENCE_PRIVILEGE role public.secret_seq USAGE",
    "EXTRA_FUNCTION_PRIVILEGE role public.secret() EXECUTE",
  ]);
});
