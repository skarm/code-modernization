// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EvidenceIO } from '../runtime/proof-io.mjs';
import { evidencePaths, parseRunnerLog, readBaselineEvidence, readLogs } from '../runtime/proof-results.mjs';
import { deltaCoverage, parseDeltas } from '../runtime/proof-uplift.mjs';
import { rewriteFixture, put } from './proof-fixtures.mjs';

const run = promisify(execFile);
const passing = `TAP version 13
# Subtest: passes
ok 1 - passes
1..1
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1.25
`;

for (const id of ['DELTA-001', 'D-001', '1']) test('delta heading maps silent behavior to real test sites: ' + id, t => {
  const root = rewriteFixture(t), work = path.join(root, 'modernized/s/mod');
  const catalog = `### ${id}: rounding\n**Category:** Behavioral-silent\n**Source:** src/Calc.java:3\n`;
  put(root, 'modernized/s/mod/src/test/RoundingTest.java', 'class RoundingTest { void rounds() { assertEquals(2, Calc.round(1.5)); } }');
  assert.equal(parseDeltas(catalog)[0]?.id, id);
  const before = deltaCoverage(new EvidenceIO(root), catalog, work);
  assert.equal(before.parsed, 1); assert.equal(before.silent, 1); assert.equal(before.covered.length, 1);
  const missing = deltaCoverage(new EvidenceIO(root), catalog.replace('Calc.java', 'Uncovered.java'), work);
  assert.equal(missing.uncovered.length, 1);
});
test('a canonical DELTA table and bold heading merge their evidence without duplicating the card', () => {
  const catalog = '| ID | Category | Site |\n|---|---|---|\n| DELTA-001 | Behavioral-silent | src/One.java:1 |\n\n' +
    '### **DELTA-001**: rounding\n**Category:** Behavioral-silent\n**Source:** src/Two.java:2\n';
  const deltas = parseDeltas(catalog);
  assert.equal(deltas.length, 1); assert.equal(deltas[0].title, 'rounding');
  assert.deepEqual(deltas[0].sites.map(s => s.path), ['src/One.java', 'src/Two.java']);
});

test('complete Node TAP is recognized, including npm preambles and CRLF', () => {
  assert.deepEqual(parseRunnerLog('> npm test\n' + passing.replaceAll('\n', '\r\n')), [1, 0, 0, ['node --test (TAP)']]);
});
test('a completed empty Node TAP stream records zero executed tests', () => {
  assert.deepEqual(parseRunnerLog(passing.replace('# Subtest: passes\nok 1 - passes\n', '').replace('1..1', '1..0').replace('# tests 1', '# tests 0').replace('# pass 1', '# pass 0')), [0, 0, 0, ['node --test (TAP)']]);
});

for (const [name, log] of [
  ['missing summary', passing.slice(0, passing.indexOf('# tests'))],
  ['missing duration', passing.replace('# duration_ms 1.25\n', '')],
  ['missing plan', passing.replace('1..1\n', '')],
  ['mismatched plan', passing.replace('1..1', '1..2')],
  ['duplicate plan', passing.replace('1..1', '1..1\n1..1')],
  ['inconsistent totals', passing.replace('# tests 1', '# tests 2')],
  ['inconsistent test points', passing.replace('# tests 1', '# tests 2').replace('# pass 1', '# pass 2')],
  ['duplicate summary', passing.replace('# pass 1', '# pass 1\n# pass 1')],
  ['negative count', passing.replace('# pass 1', '# pass -1')],
  ['huge count', passing.replace('# tests 1', '# tests 999999999999999999999')],
  ['bailout', passing + 'Bail out! worker died\n'],
  ['multiple streams', passing + passing],
  ['missing diagnostic end', passing.replace('1..1', '  ---\n  duration_ms: 2\n1..1')],
  ['nonsequential points', passing.replace('ok 1 -', 'ok 2 -')],
  ['failure hidden by passing totals', passing.replace('ok 1 -', 'not ok 1 -')],
  ['test point after plan', passing.replace('1..1\n', '1..1\nok 2 - late\n')],
  ['nested point after root plan', passing.replace('1..1\n', '1..1\n    ok 1 - late\n    1..1\n')],
  ['no fallback to an unrelated passing runner', passing.slice(0, passing.indexOf('# tests')) + 'OK (5 tests, 10 assertions)\n'],
]) test('Node TAP refuses ' + name, () => assert.equal(parseRunnerLog(log), null));

async function realTAP(t, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proof-node-tap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cases.test.mjs');
  fs.writeFileSync(file, "import {test, describe, it} from 'node:test';\n" + body);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  try { return { ...(await run(process.execPath, ['--test', '--test-reporter=tap', file], { env, timeout: 15000 })), code: 0 }; }
  catch (e) { if (typeof e.code !== 'number') throw e; return { stdout: e.stdout, stderr: e.stderr, code: e.code }; }
}
test('actual Node TAP counts nested tests, excludes suites and treats SKIP/TODO as unexecuted', async t => {
  const r = await realTAP(t, `
test('pass', () => {});
test('skip', {skip: true}, () => {});
test('todo', {todo: true}, () => {throw Error('later')});
test('fail', () => {throw Error('bad')});
describe('suite', () => {
  it('pass', () => {});
  it('skip', {skip: true}, () => {});
  it('fail', () => {throw Error('not ok 99 - misleading diagnostic\\n1..99')});
});
test('parent', async t => {await t.test('child', () => {})});
`);
  assert.equal(r.code, 1);
  assert.deepEqual(parseRunnerLog(r.stdout), [6, 2, 3, ['node --test (TAP)']], r.stdout);
  assert.equal(parseRunnerLog(r.stdout.replace('    1..3\n', '')), null, 'a missing nested plan is incomplete');
});
test('actual Node TAP cancellations count as failed execution', async t => {
  const r = await realTAP(t, "test('cancelled', {timeout: 10}, () => new Promise(() => {}));\n");
  assert.equal(r.code, 1);
  assert.deepEqual(parseRunnerLog(r.stdout), [1, 1, 0, ['node --test (TAP)']], r.stdout);
});
test('actual Node TAP handles empty, skipped and TODO suites without treating them as passing tests', async t => {
  const r = await realTAP(t, `describe('empty', () => {});
describe.skip('skipped', () => {it('never runs', () => {})});
describe.todo('todo', () => {it('pending', () => {})});\n`);
  assert.equal(r.code, 0);
  assert.deepEqual(parseRunnerLog(r.stdout), [0, 0, 1, ['node --test (TAP)']], r.stdout);
});
test('baseline discovers .tap files both by Recorded references and directory, and keeps counts distinct from per-test proof', t => {
  const root = rewriteFixture(t), baselinePath = path.join(root, 'analysis/s/BASELINE.md');
  const tap = put(root, 'analysis/s/raw/node.tap', passing);
  const io = new EvidenceIO(root), paths = evidencePaths(io, baselinePath, 'Recorded: raw/node.tap');
  assert.ok(paths.includes(tap));
  const got = readBaselineEvidence(io, [path.dirname(tap)]);
  assert.equal(got.measured, true); assert.equal(got.tests, null);
  assert.deepEqual(got.counts, { executed: 1, failed: 0, skipped: 0 });
  assert.equal(readLogs(io, [tap]).executed, 1);
  put(root, 'analysis/s/raw/tests.json', '{"a":"FAIL"}');
  assert.equal(readBaselineEvidence(new EvidenceIO(root), [path.dirname(tap)]).conflicts.length, 1);
});
