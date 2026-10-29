import test from 'node:test';
import assert from 'node:assert/strict';
import { hostInterface, terminalStatus } from '../runtime/interface.mjs';

test('unknown and terminal clients stay text even when inheriting the Desktop originator', () => {
  assert.equal(hostInterface({}), 'terminal');
  for (const key of ['TERM', 'TERM_PROGRAM', 'WT_SESSION'])
    assert.equal(hostInterface({ [key]: 'terminal', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }), 'terminal');
  assert.equal(hostInterface({ CODEX_MODERNIZATION_INTERFACE: 'terminal', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }), 'terminal');
});
test('SSH and noninteractive execution never enable GUI through an inherited override', () => {
  for (const [key, value] of Object.entries({ SSH_CONNECTION: 'remote', SSH_CLIENT: 'remote', SSH_TTY: '/dev/pts/1', CI: 'true', CODEX_MODERNIZATION_HEADLESS: '1', CODEX_MODERNIZATION_WORKER: '1' }))
    assert.equal(hostInterface({ [key]: value, CODEX_MODERNIZATION_INTERFACE: 'gui', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }), 'terminal');
});
test('local Desktop and an explicit local GUI choice retain browser presentation', () => {
  assert.equal(hostInterface({ CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' }), 'gui');
  assert.equal(hostInterface({ TERM: 'dumb', CODEX_MODERNIZATION_INTERFACE: 'gui' }), 'gui');
});
test('terminal status exposes actual SDK failures and pending decisions without terminal controls', () => {
  const text = terminalStatus({ system: 'billing', stages: [{ label: 'preflight', isDone: true }, { label: 'review', isDone: false }],
    estate: { granularity: 'file' }, totals: { modules: 9, done: 2 }, rules: [{ id: 'RULE-001' }], reviewQueue: ['RULE-001'],
    session: { runs: [{ id: 'run-1', status: 'partial', queue: { done: 1, failed: 1 } }], agents: [{ id: 'scan', error: '\u001b[31mPermission denied\u0007' }] },
    attention: ['P0 needs a human decision'], next: { text: '$modernize-review billing p0' } });
  assert.match(text, /Stage: review/); assert.match(text, /9 files; 2 marked complete/);
  assert.match(text, /review queue: 1/); assert.match(text, /SDK run-1: partial/);
  assert.match(text, /SDK error scan: .*Permission denied/); assert.match(text, /P0 needs a human decision/);
  assert.match(text, /Next: \$modernize-review billing p0/); assert.doesNotMatch(text, /[\x1b\x07]/);
});
