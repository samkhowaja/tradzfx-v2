const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTradableInstant,
  unexpectedGap,
  robustJumpThreshold,
  isRobustJump,
} = require('./detect-candle-anomalies.js');

test('calendar accepts FX weekend closure', () => {
  const prev = new Date('2026-07-03T20:59:00Z');
  const next = new Date('2026-07-05T21:00:00Z');
  assert.equal(unexpectedGap(prev, next, 'EURUSD'), false);
});

test('calendar accepts XAUUSD daily break', () => {
  const prev = new Date('2026-07-06T20:59:00Z');
  const next = new Date('2026-07-06T22:00:00Z');
  assert.equal(unexpectedGap(prev, next, 'XAUUSD'), false);
});

test('calendar flags tradable-session gap', () => {
  const prev = new Date('2026-07-06T10:00:00Z');
  const next = new Date('2026-07-06T13:01:00Z');
  assert.equal(unexpectedGap(prev, next, 'EURUSD'), true);
});

test('robust threshold preserves non-DXY hard floor', () => {
  assert.equal(robustJumpThreshold('AUDUSD', 0.0002, 0.0001), 0.005);
});

test('robust threshold keeps severe jumps blocked', () => {
  assert.equal(isRobustJump('XAUUSD', 0.10, 0.002, 0.001), true);
  assert.equal(isRobustJump('USDJPY', 0.024, 0.001, 0.0005), true);
});

test('robust threshold rejects ordinary return', () => {
  assert.equal(isRobustJump('AUDUSD', 0.004, 0.001, 0.0002), false);
});
