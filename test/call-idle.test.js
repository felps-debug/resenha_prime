import test from 'node:test';
import assert from 'node:assert/strict';
import { aloneTick, isQuotaError, ALONE_LIMIT_MS } from '../src/call-idle.js';

test('com gente na call, nunca sai e zera o contador', () => {
  assert.deepEqual(aloneTick(1000, 2, 10_000_000), { aloneSince: null, leave: false });
});

test('sozinho começa a contar e só sai depois do limite', () => {
  let s = aloneTick(null, 0, 0);
  assert.deepEqual(s, { aloneSince: 0, leave: false });
  s = aloneTick(s.aloneSince, 0, ALONE_LIMIT_MS - 1);
  assert.equal(s.leave, false);
  s = aloneTick(s.aloneSince, 0, ALONE_LIMIT_MS);
  assert.equal(s.leave, true);
});

test('alguém entra no meio e o contador recomeça', () => {
  let s = aloneTick(null, 0, 0);
  s = aloneTick(s.aloneSince, 1, 200_000);
  s = aloneTick(s.aloneSince, 0, 250_000);
  assert.equal(s.aloneSince, 250_000);
  assert.equal(aloneTick(s.aloneSince, 0, 250_000 + ALONE_LIMIT_MS - 1).leave, false);
});

test('reconhece o erro de limite de minutos da LiveKit', () => {
  assert.ok(isQuotaError('connection minutes limit exceeded. please contact the project owner.'));
  assert.ok(isQuotaError('unexpected status 429'));
  assert.ok(isQuotaError('Could not fetch region settings: Too Many Requests'));
  assert.ok(!isQuotaError('could not establish signal connection'));
});
