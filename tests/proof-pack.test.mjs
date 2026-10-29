// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { buildProofPack, renderProofMarkdown, sourceCheck, writeProofPack } from '../runtime/proof-pack.mjs';
import { EvidenceIO } from '../runtime/proof-io.mjs';
import { parseResultXML, parseRunnerLog, parseResultsJSON, readResults } from '../runtime/proof-results.mjs';
import { compareCases } from '../runtime/compare.mjs';
import { regexSpans } from '../runtime/regex-mask.mjs';
import { deltaCoverage, parseDeltas } from '../runtime/proof-uplift.mjs';
import { corpus, rewriteFixture, put } from './proof-fixtures.mjs';

const run = promisify(execFile), PLUGIN = fileURLToPath(new URL('../', import.meta.url));
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const states = pack => Object.fromEntries(pack.modules[0].checks.map(c => [c.id, c.state]));

test('Finder metadata is neither proof evidence nor a source modification', t => {
  const root = rewriteFixture(t), before = sourceCheck(new EvidenceIO(root), 's', path.join(root, 'analysis/s'));
  put(root, 'legacy/s/.DS_Store', 'Finder metadata', 1900000000);
  put(root, 'analysis/s/.DS_Store', 'Finder metadata', 1);
  assert.deepEqual(sourceCheck(new EvidenceIO(root), 's', path.join(root, 'analysis/s')), before);
  const io = new EvidenceIO(root), walked = io.walk(root, { hidden: false });
  assert(!walked.files.some(([file]) => file.split('/').includes('.DS_Store')));
  assert.throws(() => io.read('analysis/s/.DS_Store'), /Finder metadata/);
});

test('proof freshness ignores Finder changes and still detects added evidence', t => {
  const root = rewriteFixture(t), io = new EvidenceIO(root);
  io.watch(root); io.walk(root, { hidden: false });
  put(root, '.DS_Store', 'Finder metadata');
  put(root, 'analysis/s/.DS_Store', 'Finder metadata');
  assert.equal(io.unchanged(), true, io.problems.join('\n'));
  put(root, 'analysis/s/new-evidence.txt', 'new evidence');
  assert.equal(io.unchanged(), false);
  assert(io.problems.some(message => /directory changed/.test(message)));
});
for (const [runner, log, expected] of corpus.runnerLogs) test('upstream runner log: ' + runner, () => assert.deepEqual(parseRunnerLog(log)?.slice(0, 3), expected));
async function cli(args) {
  try { const r = await run(process.execPath, args, { cwd: PLUGIN, env: { ...process.env, CODEX_MODERNIZATION_SDK_DIR: '/unavailable-sdk', CODEX_PATH: '/unavailable-cli' } }); return { ...r, code: 0 }; }
  catch (e) { return { stdout: e.stdout, stderr: e.stderr, code: e.code }; }
}
test('proof-pack CLI computes PROVEN and publishes both evidence reports without SDK/model calls', async t => {
  const root = rewriteFixture(t), result = await cli(['scripts/proof-pack.mjs', 's', '--workspace', root]);
  assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /s: PROVEN/);
  const pack = readJSON(path.join(root, 'analysis/s/VERIFICATION.json'));
  assert.equal(pack.evaluator, 'codex-node-proof-pack'); assert.deepEqual(pack.signoff, { name: '', role: '', date: '', decision: '' });
  assert.equal(pack.modules[0].checks.length, 6); assert.ok(pack.evidenceFiles.length > 20);
  assert.match(fs.readFileSync(path.join(root, 'analysis/s/VERIFICATION.md'), 'utf8'), /Sign-off/);
});
test('verify CLI exposes the same deterministic evaluator and returns 1 for a real failed test', async t => {
  const root = rewriteFixture(t), file = path.join(root, 'modernized/s/mod/target/surefire-reports/TEST-CalcTest.xml');
  put(root, path.relative(root, file), '<testsuite><testcase classname="CalcTest" name="RULE_001"><failure/></testcase></testsuite>', 1700000030);
  const r = await cli(['scripts/modernize.mjs', 'verify', '--workspace', root, '--system', 's']);
  assert.equal(r.code, 1, r.stderr); assert.equal(JSON.parse(r.stdout).verdict, 'NOT PROVEN');
});
test('both CLIs reject unusable scope/options with exit 2 and preserve an existing report', async t => {
  const root = rewriteFixture(t), sentinel = put(root, 'analysis/s/VERIFICATION.json', 'previous report');
  fs.rmSync(path.join(root, 'modernized'), { recursive: true });
  for (const args of [['scripts/proof-pack.mjs', 's', '--workspace', root], ['scripts/proof-pack.mjs', '..', '--workspace', root], ['scripts/modernize.mjs', 'verify', '--workspace', root, '--system', 's', '--allow-writes']]) {
    const r = await cli(args); assert.equal(r.code, 2); assert.equal(fs.readFileSync(sentinel, 'utf8'), 'previous report');
  }
});
test('PARTLY PROVEN exits 1 and does not manufacture human sign-off', async t => {
  const root = rewriteFixture(t), file = path.join(root, 'analysis/s/equivalence/test-runs.json'), doc = readJSON(file); doc.legacy = { ran: false, why: 'runtime unavailable' }; fs.writeFileSync(file, JSON.stringify(doc));
  const r = await cli(['scripts/proof-pack.mjs', 's', 'mod', '--workspace', root]);
  assert.equal(r.code, 1); assert.match(r.stdout, /PARTLY PROVEN/);
});
for (const form of ['output-symlink', 'output-hardlink', 'analysis-symlink', 'candidate-ancestor-symlink']) test('proof filesystem boundary: ' + form, async t => {
  const root = rewriteFixture(t), outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-outside-'))); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const sentinel = put(outside, 'sentinel.json', 'must remain unchanged');
  if (form === 'output-symlink' || form === 'output-hardlink') {
    const target = path.join(root, 'analysis/s/VERIFICATION.json'); if (form === 'output-symlink') fs.symlinkSync(sentinel, target); else fs.linkSync(sentinel, target);
    const pack = await buildProofPack('s', root); await assert.rejects(writeProofPack(pack, root), /link|regular|private/i);
  } else {
    const dir = form === 'analysis-symlink' ? 'analysis' : 'modernized'; fs.renameSync(path.join(root, dir), path.join(outside, dir)); fs.symlinkSync(path.join(outside, dir), path.join(root, dir));
    await assert.rejects(buildProofPack('s', root), /link|built/i);
  }
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'must remain unchanged');
});
test('the layout can reference an external read-only legacy checkout', async t => {
  const root = rewriteFixture(t), outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-source-'))); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'legacy/s'), outside, { recursive: true, preserveTimestamps: true }); fs.rmSync(path.join(root, 'legacy/s'), { recursive: true }); fs.symlinkSync(outside, path.join(root, 'legacy/s'));
  const pack = await buildProofPack('s', root); assert.equal(pack.overall.verdict, 'PROVEN'); assert.equal(pack.legacy.target, outside);
});
test('a nested legacy source link leaves a completeness gap', async t => {
  const root = rewriteFixture(t); fs.symlinkSync('app/mod.cbl', path.join(root, 'legacy/s/source-link'));
  const pack = await buildProofPack('s', root); assert.equal(states(pack).source, 'gap'); assert.notEqual(pack.overall.verdict, 'PROVEN');
});
test('unreadable XML mixed with passing results cannot be silently omitted', async t => {
  const root = rewriteFixture(t); put(root, 'modernized/s/mod/target/surefire-reports/TEST-Bad.xml', '<testsuite><testcase>', 1700000030);
  const pack = await buildProofPack('s', root); assert.equal(pack.overall.verdict, 'PARTLY PROVEN'); assert.equal(states(pack).tests, 'gap'); assert.ok(pack.problems.some(p => /XML/i.test(p)));
});
test('a damaged named TEST report is not lost by XML-root sniffing', async t => {
  const root = rewriteFixture(t); put(root, 'modernized/s/mod/target/surefire-reports/TEST-Broken.xml', 'not XML at all', 1700000030);
  const pack = await buildProofPack('s', root); assert.equal(states(pack).tests, 'gap'); assert.notEqual(pack.overall.verdict, 'PROVEN');
});
for (const mutation of ['changed-file', 'added-file', 'new-module', 'preflight']) test('report publication refuses evidence mutation: ' + mutation, async t => {
  const root = rewriteFixture(t), pack = await buildProofPack('s', root);
  const files = { 'changed-file': 'modernized/s/mod/src/main/Calc.java', 'added-file': 'modernized/s/mod/src/main/New.java', 'new-module': 'modernized/s/new-module/Main.java', preflight: 'analysis/s/PREFLIGHT.md' };
  put(root, files[mutation], 'changed');
  await assert.rejects(writeProofPack(pack, root), /Evidence changed/);
  assert.equal(fs.existsSync(path.join(root, 'analysis/s/VERIFICATION.json')), false);
});
test('repeated scans retain the first metadata snapshot', async t => {
  const root = rewriteFixture(t), io = new EvidenceIO(root), dir = path.join(root, 'modernized/s/mod');
  io.walk(dir); io.watch(dir); put(root, 'modernized/s/mod/New.java', 'new code'); io.walk(dir); io.watch(dir);
  assert.equal(io.unchanged(), false);
});
test('report publication refuses modification of comparison bytes', async t => {
  const root = rewriteFixture(t), pack = await buildProofPack('s', root); put(root, 'analysis/s/equivalence/dev/new/0.out', 'changed after comparison');
  await assert.rejects(writeProofPack(pack, root), /Evidence changed/);
});
test('generated Markdown escapes project-controlled HTML, links, tables and directives', async t => {
  const root = rewriteFixture(t), pack = await buildProofPack('s', root); pack.modules[0].caveats.push('<img src=x onerror=alert(1)> [click](javascript:alert(1)) | x\n## injected ::code-comment{file="x"}');
  const markdown = renderProofMarkdown(pack); assert.ok(!markdown.includes('<img')); assert.ok(!markdown.includes('[click](javascript:')); assert.ok(!markdown.includes('\n## injected')); assert.ok(!markdown.includes('::code-comment{'));
});
for (const [label, xml] of [
  ['DTD', '<!DOCTYPE testsuite [<!ENTITY x "boom">]><testsuite/>'],
  ['external entity', '<!DOCTYPE testsuite SYSTEM "file:///etc/passwd"><testsuite/>'],
  ['malformed XML', '<testsuite><testcase></testsuite>'],
  ['nested testcases', '<testsuite><testcase><testcase/></testcase></testsuite>'],
  ['depth cap', '<x>'.repeat(61) + '</x>'.repeat(61)],
]) test('strict result parser refuses ' + label, () => assert.throws(() => parseResultXML(Buffer.from(xml))));
test('TRX namespace, nested JUnit suites, skip reasons and failing/skip precedence are parsed', () => {
  assert.deepEqual(parseResultXML(Buffer.from('<TestRun xmlns="urn:trx"><Results><UnitTestResult testName="App.T.case(1)" outcome="Timeout"/></Results></TestRun>')), [['App.T', 'case(1)', 'ERROR', false, '']]);
  assert.deepEqual(parseResultXML(Buffer.from('<testsuites><testsuite name="outer"><testsuite name="inner"><testcase name="one"><skipped message="reason"/></testcase><testcase name="two"><failure/><skipped/></testcase></testsuite></testsuite></testsuites>')), [['inner', 'one', 'SKIP', true, 'inner'], ['inner', 'two', 'FAIL', false, 'inner']]);
});
test('UTF-16 result reports are accepted and malformed UTF-8 is rejected', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<testsuite><testcase name="ok"/></testsuite>', 'utf16le')]); assert.equal(parseResultXML(utf16)[0][2], 'PASS');
  assert.throws(() => parseResultXML(Buffer.from([0xc0, 0xaf])));
});
test('untrusted names cannot use Object.prototype to forge tests or baseline statuses', async t => {
  const root = rewriteFixture(t), file = put(root, 'analysis/s/prototype.xml', '<testsuite name="__proto__"><testcase classname="constructor" name="toString"/></testsuite>');
  const result = readResults(new EvidenceIO(root), [file]); assert.equal(result.tests['constructor#toString'], 'PASS'); assert.equal(result.classes.constructor.pass, 1);
  assert.deepEqual({ ...parseResultsJSON(JSON.parse('{"__proto__":"PASS","constructor":"FAIL"}')) }, { ['__proto__']: 'PASS', constructor: 'FAIL' });
});
test('delta cards preserve numeric-ID order and Python Unicode word semantics', t => {
  const root = rewriteFixture(t), catalog = '| # | Category | Site |\n|---|---|---|\n| 10 | Behavioral-silent | src/Accént.java:3 |\n| 2 | API-removed | src/Other.java:4 |\n';
  put(root, 'modernized/s/mod/src/test/UnicodeTest.java', 'class UnicodeTest { Accént value; }');
  assert.deepEqual(parseDeltas(catalog).map(d => d.id), ['10', '2']);
  const result = deltaCoverage(new EvidenceIO(root), catalog, path.join(root, 'modernized/s/mod')); assert.equal(result.covered[0].id, '10'); assert.equal(result.gap, false);
});
test('a runner cannot forge an infinite or imprecise executed count', () => assert.equal(parseRunnerLog('Tests run: ' + '9'.repeat(80) + ', Failures: 0, Errors: 0, Skipped: 0'), null));
for (const [source, bytes, expected] of [
  ['\\d{4}-\\d\\d-\\d\\d', '2026-10-15 result', [[0, 10]]],
  ['.', '\r\n', [[0, 1]]],
  ['(?s).+', '\r\n', [[0, 2]]],
  ['(?m)^x$', 'x\rx\nx\n', [[4, 5]]],
  ['\\w+', 'é_½!', [[0, 3]]],
  ['(?a)\\w+', 'é_½!', [[1, 2]]],
  ['\\s', '\x85\xa0\x1cX', [[0, 1], [1, 2], [2, 3]]],
  ['(?x) a \\d+ # clock', 'a12!', [[0, 3]]],
  ['[\\w]+', 'é_½!', [[0, 3]]],
  ['(?P<clock>run=\\d+)', 'run=12!', [[0, 6]]],
  ['(?<=run=)\\d+', 'run=12!', [[4, 6]]],
]) test('Python-compatible regex byte spans: ' + source + ' / ' + JSON.stringify(bytes), async () => assert.deepEqual(await regexSpans(Buffer.from(bytes, 'latin1'), source), expected));
test('regex time limit terminates catastrophic backtracking', async () => {
  const started = Date.now(); await assert.rejects(regexSpans(Buffer.from('a'.repeat(50000) + '!'), '(a+)+$', { timeoutMs: 150 }), /time limit/); assert.ok(Date.now() - started < 3000);
});
test('regex masking compares the two independently located spans and detects remaining changes', async t => {
  const root = rewriteFixture(t), base = 'analysis/s/equivalence';
  put(root, base + '/clock-old.out', 'run=12 result=7'); put(root, base + '/clock-new.out', 'run=12345 result=7');
  const file = put(root, base + '/clock-cases.json', JSON.stringify({ cases: [{ id: 'clock', legacy: 'clock-old.out', new: 'clock-new.out', mask: [{ regex: 'run=\\d+', why: 'run id' }] }] }));
  const first = await compareCases(file); assert.equal(first.report.passed, true); assert.deepEqual(first.report.cases[0].maskedBytes, { legacy: 6, new: 9 });
  put(root, base + '/clock-new.out', 'run=12345 result=8'); assert.equal((await compareCases(file)).report.passed, false);
});
test('an invalid conditional group and zero-length matches remain explicit coverage gaps', async t => {
  const root = rewriteFixture(t), file = put(root, 'analysis/s/equivalence/unsupported.json', JSON.stringify({ cases: [{ id: 'unsupported', legacy: 'dev/legacy/0.out', new: 'dev/new/0.out', mask: [{ regex: '(?(1)yes|no)', why: 'unsupported conditional group' }] }] }));
  const r = await compareCases(file); assert.equal(r.report.passed, false); assert.match(r.report.coverageGaps[0], /Unknown conditional group/);
  await assert.rejects(regexSpans(Buffer.from('data'), '^'), /Zero-length/);
  await assert.rejects(regexSpans(Buffer.from('aaab'), '(?<=a+)b'), /lookbehind/);
});
