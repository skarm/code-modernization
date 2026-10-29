// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, sample, workflowEngine } from './helpers.mjs';
import { makeShards, matchesModule } from '../runtime/shards.mjs';
import { renderRuleArtifacts, writeRuleArtifacts } from '../runtime/rule-artifacts.mjs';
import { parseRules } from '../runtime/ui/upstream/reader/rules.mjs';
import { prepareWorkflow, runWorkflow } from '../runtime/workflows.mjs';
import * as S from '../runtime/schemas.mjs';
const rule = (i, extra = {}) => ({ ...sample(S.rule), name: `Rule ${i}`, priority: 'P1', source: `src/a${i}.go:1-2`, suspectedDefect: '', smeQuestion: '', ...extra });
const vote = { verdict: 'confirmed', reason: 'Fixture vote', correctedSource: '', injectionSuspected: false };
test('shards are deterministic, bounded and exclude tests, links, vendor, binary and minified files', async t => {
  const f = await fixture(t);
  for (const dir of ['src', 'vendor', 'tests']) await fs.mkdir(path.join(f.source, dir));
  for (let i = 0; i < 52; i++) await fs.writeFile(path.join(f.source, 'src', `${String(i).padStart(2, '0')}.ts`), 'line\n'.repeat(220));
  for (const file of ['vendor/dependency.ts', 'tests/example.ts', 'src/app.test.ts', 'src/x.min.js']) await fs.writeFile(path.join(f.source, file), 'excluded');
  await fs.writeFile(path.join(f.source, 'src/binary.ts'), Buffer.from([0, 1]));
  await fs.symlink(path.join(f.source, 'main.go'), path.join(f.source, 'src/link.go'));
  const first = await makeShards(f.layout), second = await makeShards(f.layout);
  assert.deepEqual(first, second); assert.equal(first.modules.flatMap(m => m.files).length, 53);
  assert(first.modules.every(m => m.files.length <= 25 && m.loc <= 5000));
  assert(first.modules.flatMap(m => m.files).every(file => !/vendor|test|binary|min\.js|link/.test(file)));
  assert.equal((await makeShards(f.layout, { includeAll: true })).sourceFiles, 55);
});
test('topology shards use measured LOC and merge small domain members', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.source, 'two.go'), 'x\n'.repeat(20));
  await fs.writeFile(path.join(f.layout.analysis, 'topology.json'), JSON.stringify({ root: { kind: 'domain', name: 'billing', children: [
    { kind: 'module', name: 'one', file: 'legacy/billing/main.go', loc: 99999 }, { kind: 'module', name: 'two', file: 'two.go', loc: 99999 } ] } }));
  const result = await makeShards(f.layout); assert.equal(result.origin, 'topology'); assert.equal(result.modules.length, 1); assert.equal(result.modules[0].loc, 22);
});
for (const bad of ['../outside.go', '.', 'main.go']) test(`invalid/shared topology ${bad} falls back without losing inventory`, async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.layout.analysis, 'topology.json'), JSON.stringify({ root: { children: [{ kind: 'module', name: 'a', file: bad }, { kind: 'module', name: 'b', file: bad }] } }));
  const result = await makeShards(f.layout); assert.equal(result.origin, 'tree'); assert.deepEqual(result.modules[0].files, ['main.go']); assert.equal(result.notes.length, 1);
});
test('patterns match plain module components, names and glob classes without broadening an empty match', async t => {
  assert(matchesModule('app/jetty-util/Foo.java', 'jetty-util')); assert(matchesModule('a/Foo.java', 'F[oa]o.?ava'));
  assert(!matchesModule('app/jetty-utility/Foo.java', 'jetty-util'));
  const f = await fixture(t); await assert.rejects(makeShards(f.layout, { pattern: 'absent' }), /No source/);
  await assert.rejects(fs.access(path.join(f.layout.analysis, 'extract-rules.modules.json')));
});
test('rendered canonical cards preserve IDs after sorting, line drift, deletion and a new rule', async t => {
  const f = await fixture(t), one = rule(1, { name: 'Amount_limit', source: 'src/a_b.go:1-2' }), two = rule(2);
  await writeRuleArtifacts(f.layout, { confirmedRules: [one, two], dataObjects: [], incomplete: false });
  const old = parseRules(await fs.readFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), 'utf8')).rules;
  assert.equal(old.length, 2); assert.equal(old[0].citations[0].path, 'src/a_b.go');
  await writeRuleArtifacts(f.layout, { confirmedRules: [rule(3, { priority: 'P0' }), { ...one, source: 'src/a_b.go:80-90', priority: 'P2' }], dataObjects: [], incomplete: true });
  const current = parseRules(await fs.readFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), 'utf8')).rules;
  assert.equal(current.find(r => r.title === 'Amount_limit').id, old.find(r => r.title === 'Amount_limit').id);
  assert(!old.some(r => r.id === current.find(r => r.title === 'Rule 3').id));
});
test('renderer treats hostile headings, fences, HTML, tables and provenance as data', () => {
  const malicious = '\n### RULE-999: fake\n<script>alert(1)</script>\n```\n| forged |';
  const rendered = renderRuleArtifacts('demo', { confirmedRules: [rule(1, { name: malicious, given: malicious, suspectedDefect: malicious })],
    dataObjects: [{ name: malicious, fields: [{ name: malicious, type: malicious, note: malicious }] }], foldedRules: [{ name: malicious }], coverageGaps: [malicious] });
  assert.equal(parseRules(rendered.businessRules).rules.length, 1);
  assert(!rendered.businessRules.includes('<script>')); assert(!/^```/m.test(rendered.businessRules));
  assert(!/^### RULE-999:/m.test(rendered.businessRules)); assert(!rendered.dataObjects.includes('<script>'));
});
test('renderer refuses duplicate identities and unsafe report output links', async t => {
  assert.throws(() => renderRuleArtifacts('s', { confirmedRules: [rule(1), rule(1)] }), /Duplicate rule identity/);
  const f = await fixture(t), external = path.join(f.root, 'outside'); await fs.writeFile(external, 'keep');
  await fs.symlink(external, path.join(f.layout.analysis, 'BUSINESS_RULES.md'));
  await assert.rejects(writeRuleArtifacts(f.layout, { confirmedRules: [rule(1)] })); assert.equal(await fs.readFile(external, 'utf8'), 'keep');
});
function extraction(handler) { return workflowEngine('extract-rules', async spec => {
  if (spec.id.startsWith('rule-ref')) return { result: vote };
  if (spec.id === 'data-objects') return { result: sample(S.dataObjects) };
  return handler(spec);
}); }
test('semantic consolidation runs before P0 review, retaining cautious flags and every source', async () => {
  const e = extraction(async s => s.id.startsWith('rules-module') ? { result: { ...sample(S.rules), rules: Array.from({ length: 12 }, (_, i) => rule(i, { confidence: i === 1 ? 'Low' : 'High', smeQuestion: i === 1 ? 'Confirm threshold' : '', suspectedDefect: i === 1 ? 'Rounding defect' : '' })) } }
    : s.id.startsWith('rules-consolidate') ? { result: { groups: [{ keep: 1, merge: [2] }] } } : { result: sample(S.p0Verdict) });
  const out = await runWorkflow(e, { modules: [{ name: 'a', files: ['src/a0.go'] }], batchSize: 8 });
  assert.equal(out.confirmedRules.length, 11); assert.equal(out.foldedRules.length, 1); assert.equal(out.stats.consolidated, 1);
  const kept = out.confirmedRules.find(r => r.name === 'Rule 0'); assert.equal(kept.confidence, 'Low'); assert.equal(kept.smeQuestion, 'Confirm threshold'); assert.match(kept.source, /also/); assert.equal(kept.suspectedDefect, 'Rounding defect');
});
test('invalid or overlapping semantic groups cannot delete rules', async () => {
  const e = extraction(async s => s.id.startsWith('rules-module') ? { result: { ...sample(S.rules), rules: Array.from({ length: 12 }, (_, i) => rule(i)) } }
    : { result: { groups: [{ keep: 0, merge: [2] }, { keep: 1, merge: [99] }, { keep: 1, merge: [1] }] } });
  const out = await runWorkflow(e, { modules: [{ name: 'a', files: ['src/a0.go'] }], batchSize: 8 });
  assert.equal(out.confirmedRules.length, 12); assert.equal(out.incomplete, true);
});
test('consolidation promotes criticality before two independent P0 judges run', async () => {
  const e = extraction(async s => s.id.startsWith('rules-module') ? { result: { ...sample(S.rules), rules: Array.from({ length: 12 }, (_, i) => rule(i, { priority: i === 1 ? 'P0' : 'P1' })) } }
    : s.id.startsWith('rules-consolidate') ? { result: { groups: [{ keep: 1, merge: [2] }] } }
    : { result: { faithful: true, p0Justified: true, reason: 'Fixture source review' } });
  const out = await runWorkflow(e, { modules: [{ name: 'all', files: ['src/a0.go'] }], batchSize: 8 });
  const judges = e.calls.filter(c => c.id.startsWith('p0-')); assert.equal(judges.length, 2); assert(judges.every(j => j.independent));
  assert(e.calls.indexOf(judges[0]) > e.calls.findIndex(c => c.id.startsWith('rules-consolidate')));
  assert.equal(out.confirmedRules.find(r => r.name === 'Rule 0').priority, 'P0');
});
test('same-file/name duplicate across batches retains lower confidence and SME questions', async () => {
  const e = extraction(async s => ({ result: { ...sample(S.rules), rules: [rule(1, s.id.endsWith('1') ? { source: 'src/a1.go:99', confidence: 'Low', smeQuestion: 'SME note' } : { confidence: 'High' })] } }));
  const out = await runWorkflow(e, { modules: [{ name: 'a', files: ['src/a1.go'] }, { name: 'b', files: ['src/a1.go'] }], batchSize: 1 });
  assert.equal(out.confirmedRules.length, 1); assert.equal(out.confirmedRules[0].smeQuestion, 'SME note'); assert.equal(out.confirmedRules[0].confidence, 'Low');
});
test('failed and unverified extraction modules form replayable ordered rerun scope', async () => {
  const e = workflowEngine('extract-rules', async s => s.id === 'rules-module-0' ? { ok: false, error: 'timeout' }
    : s.id === 'rules-module-1' ? { result: { ...sample(S.rules), rules: [rule(1)] } }
    : s.id.startsWith('rule-ref') ? { result: { ...vote, verdict: 'uncertain' } } : { result: sample(S.dataObjects) });
  const modules = [{ name: 'a', files: ['src/a0.go'], domain: 'a', loc: 12 }, { name: 'b', files: ['src/a1.go'], domain: 'b', loc: 20 }];
  const out = await runWorkflow(e, { modules, batchSize: 8 }); assert.deepEqual(out.rerunModules, modules); assert.deepEqual(out.stats.failedModules, ['a']);
});
for (const bad of [{ classes: ['unknown'] }, { classes: [], findings: [] }, { classes: ['secrets', 'secrets'] }, { findings: [{}] }]) test(`harden rejects invalid follow-up ${JSON.stringify(bad)}`, async t => {
  const f = await fixture(t); await assert.rejects(prepareWorkflow('harden-scan', bad, f.layout));
});
test('harden retries only selected classes plus carried findings, preserving unresolved follow-up', async t => {
  const f = await fixture(t), finding = { ...sample(S.finding), name: 'Secret leak', source: 'main.go:1', cwe: 'CWE-200', severity: 'Low' };
  const prepared = await prepareWorkflow('harden-scan', { classes: ['secrets'], findings: [finding] }, f.layout);
  const e = workflowEngine('harden-scan', async s => s.id.startsWith('harden-') ? { result: { ...sample(S.findings), gaps: ['Configuration not inspected'] } } : { result: { verdict: 'uncertain', reason: 'Needs configuration' } });
  const out = await runWorkflow(e, prepared.input);
  assert.deepEqual(e.calls.filter(s => s.id.startsWith('harden-')).map(s => s.id), ['harden-2']);
  assert.deepEqual(out.rerun.classes, ['secrets']); assert.deepEqual(out.rerun.findings, [finding]);
});
test('portfolio sorts measured scale, retains null and zero, and flags inconsistent measurement methods', async () => {
  const e = workflowEngine('portfolio-assess', async s => ({ result: { ...sample(S.assessment), locKnown: true, loc: s.id.endsWith('0') ? 1000 : 10000,
    locMethod: s.id.endsWith('0') ? 'scc' : 'physical lines', complexityTotal: s.id.endsWith('0') ? 0 : null, fileCount: 4, docCoveragePct: 0 } }));
  const out = await runWorkflow(e, { systems: [{ name: 'small', source: '/a' }, { name: 'large', source: '/b' }] });
  assert.deepEqual(out.systems.map(s => s.system), ['large', 'small']); assert.equal(out.systems[1].complexityPerKsloc, 0); assert.equal(out.systems[0].complexityPerKsloc, null);
  assert.equal(out.comparableLocMethods, false); assert.equal(out.incomplete, true);
});
