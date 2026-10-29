import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { compareCases, writeComparison } from '../runtime/compare.mjs';
import { fixture } from './helpers.mjs';

async function inputs(t, legacy = 'result=42\n', current = legacy, extra = {}, root = {}) {
  const f = await fixture(t), directory = path.join(f.layout.analysis, 'equivalence');
  await fs.mkdir(directory); await fs.writeFile(path.join(directory, 'old.txt'), legacy);
  await fs.writeFile(path.join(directory, 'new.txt'), current);
  const casesFile = path.join(directory, 'cases.json');
  const spec = { system: 'billing', ...root, cases: [{ id: 'case-1', input: 'input-1', legacy: 'old.txt', new: 'new.txt', ...extra }] };
  await fs.writeFile(casesFile, JSON.stringify(spec));
  return { ...f, directory, casesFile, spec };
}
test('byte equality and a real in-memory mutation are checked without claiming behavior proof', async t => {
  const f = await inputs(t), compared = await compareCases(f.casesFile);
  assert.equal(compared.report.passed, true); assert.equal(compared.report.selfCheck.checkedCases, 1);
  assert.equal(compared.report.behaviorEquivalenceProven, false);
  assert.equal(compared.report.inputGroups.comparedNonempty, 1);
  const output = await writeComparison(compared);
  assert.equal(JSON.parse(await fs.readFile(output)).evaluator, 'codex-node-comparator');
  assert.equal(await fs.readFile(path.join(f.directory, 'old.txt'), 'utf8'), 'result=42\n');
});
test('changed observations produce a different hash and fail comparison', async t => {
  const f = await inputs(t), first = await compareCases(f.casesFile);
  await fs.writeFile(path.join(f.directory, 'new.txt'), 'result=43\n');
  const second = await compareCases(f.casesFile);
  assert.notEqual(first.report.cases[0].sha256.new, second.report.cases[0].sha256.new);
  assert.equal(second.report.passed, false); assert.equal(second.report.cases[0].status, 'differs');
});
test('approved differences remain differences and preserve the actual recorded reason', async t => {
  const reason = 'Synthetic human acceptance of this exact input difference';
  const f = await inputs(t, 'old', 'new', {}, { approvedInputs: { 'input-1': reason } });
  const { report } = await compareCases(f.casesFile);
  assert.equal(report.cases[0].status, 'differs-approved'); assert.equal(report.cases[0].approvedDifference, reason);
  assert.equal(report.passed, true); assert.equal(report.behaviorEquivalenceProven, false);
});
test('byte masks merge overlapping inclusive ranges and preserve unmasked UTF-8 bytes', async t => {
  const f = await inputs(t, 'ЯabcdefZ', 'ЯABCDefZ', { mask: [{ bytes: '2-4,4-5', why: 'Synthetic varying bytes' }] });
  const { report } = await compareCases(f.casesFile);
  assert.equal(report.passed, true); assert.equal(report.cases[0].maskedBytes.legacy, 4);
});
for (const [label, legacy, current, tolerance, expected] of [
  ['absolute boundary', '1.000000', '1.000001', { abs: 1e-6 }, 'same'],
  ['outside absolute boundary', '1.000000', '1.0000010000000001', { abs: 1e-6 }, 'differs'],
  ['relative rounding', '100.00000000', '100.00000005', { rel: 1e-9 }, 'same'],
  ['opposite signs', '-0.0000005', '0.0000005', { abs: 1e-6 }, 'same'],
  ['large exact decimals', '9007199254740992.00', '9007199254740993.00', { abs: 1e-6 }, 'differs'],
  ['integers stay exact', '1000000000', '1000000001', { rel: 0.01 }, 'differs'],
  ['dotted identifiers stay exact', 'v1.2.3', 'v1.2.4', { rel: 0.01 }, 'differs'],
  ['extra text after a number stays exact', 'value=1.0', 'value=1.0extra', { rel: 0.01 }, 'differs'],
  ['text around a tolerated number stays exact', 'value=1.000000;end', 'value=1.000001;end', { abs: 1e-6 }, 'same'],
]) {
  test(`decimal comparison: ${label}`, async t => {
    const f = await inputs(t, legacy, current, { tolerance: { ...tolerance, why: 'Synthetic rounding allowance' } });
    const { report } = await compareCases(f.casesFile);
    assert.equal(report.cases[0].status, expected); assert.equal(report.passed, expected === 'same');
  });
}
for (const extra of [
  { mask: [{ bytes: '0-100', why: 'Masks all the evidence' }] },
  { mask: [{ bytes: '0-1' }] },
  { mask: [{ regex: '(?(1)yes|no)', why: 'Unsupported Python conditional' }] },
  { tolerance: { rel: 0.02, why: 'Too loose' } },
  { tolerance: { abs: 1e-5, why: 'Too loose' } },
  { tolerance: { abs: 1e-6 } },
]) {
  test(`unsupported or ineffective normalization cannot pass: ${JSON.stringify(extra)}`, async t => {
    const f = await inputs(t, '42.000000', '42.000000', extra);
    const { report } = await compareCases(f.casesFile);
    assert.equal(report.passed, false); assert.equal(report.incomplete, true); assert(report.coverageGaps.length > 0);
  });
}
test('empty observations are not counted as successful proof', async t => {
  const f = await inputs(t, '', ''), { report } = await compareCases(f.casesFile);
  assert.equal(report.passed, false); assert.equal(report.inputGroups.comparedNonempty, 0);
});
for (const kind of ['traversal', 'outside-symlink', 'missing', 'oversized']) {
  test(`observation boundary: ${kind}`, async t => {
    const f = await inputs(t);
    if (kind === 'traversal') f.spec.cases[0].new = '../outside.txt';
    if (kind === 'outside-symlink') {
      const outside = path.join(f.root, 'outside.txt'); await fs.writeFile(outside, 'outside evidence');
      await fs.unlink(path.join(f.directory, 'new.txt')); await fs.symlink(outside, path.join(f.directory, 'new.txt'));
    }
    if (kind === 'missing') await fs.unlink(path.join(f.directory, 'new.txt'));
    if (kind === 'oversized') await fs.truncate(path.join(f.directory, 'new.txt'), 33 * 1024 * 1024);
    await fs.writeFile(f.casesFile, JSON.stringify(f.spec));
    const { report } = await compareCases(f.casesFile);
    assert.equal(report.cases[0].status, 'missing'); assert.equal(report.passed, false);
  });
}
test('the report cannot overwrite the manifest, observations, or a missing observation path', async t => {
  const f = await inputs(t), comparison = await compareCases(f.casesFile);
  for (const output of ['cases.json', 'old.txt', 'new.txt', '../escape.json']) await assert.rejects(writeComparison(comparison, output), /overwrite|stay/);
  await fs.unlink(path.join(f.directory, 'new.txt'));
  await assert.rejects(writeComparison(await compareCases(f.casesFile), 'new.txt'), /overwrite/);
  assert.equal(await fs.readFile(path.join(f.directory, 'old.txt'), 'utf8'), 'result=42\n');
});
test('duplicate IDs are rejected before a report is published', async t => {
  const f = await inputs(t); f.spec.cases.push({ ...f.spec.cases[0] });
  await fs.writeFile(f.casesFile, JSON.stringify(f.spec));
  await assert.rejects(compareCases(f.casesFile), /Duplicate case id/);
});
test('input IDs do not inherit approval through Object.prototype', async t => {
  const f = await inputs(t, 'old', 'new', { input: 'constructor' });
  assert.equal((await compareCases(f.casesFile)).report.cases[0].status, 'differs');
});
test('compare CLI executes without SDK resolution and returns nonzero on a real difference', async t => {
  const f = await inputs(t), exec = promisify(execFile), cli = fileURLToPath(new URL('../scripts/modernize.mjs', import.meta.url));
  const env = { ...process.env, CODEX_MODERNIZATION_SDK_DIR: path.join(f.root, 'sdk-does-not-exist') };
  const first = await exec(process.execPath, [cli, 'compare', '--cases', f.casesFile], { env });
  assert.equal(JSON.parse(first.stdout).passed, true);
  await fs.writeFile(path.join(f.directory, 'new.txt'), 'changed');
  await assert.rejects(exec(process.execPath, [cli, 'compare', '--cases', f.casesFile], { env }),
    error => error.code === 1 && JSON.parse(error.stdout).passed === false);
});
