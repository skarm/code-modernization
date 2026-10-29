import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { prepareWorkflow, runWorkflow, validateGraph, measuredBuild } from '../runtime/workflows.mjs';
import * as S from '../runtime/schemas.mjs';
import { sample, workflowEngine, fixture } from './helpers.mjs';
import { Engine } from '../runtime/engine.mjs';
import { fakeCodex } from './helpers.mjs';

const rule = overrides => ({ ...sample(S.rule), name: 'Discount eligibility', source: 'main.go:1-2', priority: 'P1', ...overrides });
const goodRuleVote = { verdict: 'confirmed', reason: 'read the source', correctedSource: '', injectionSuspected: false };
const goodBuild = unit => ({ ...sample(S.migrated), unit, buildRan: true, built: true, buildCommand: 'go build ./...', filesChanged: ['main.go'],
  testsRan: true, testsPassed: true, testCommands: ['go test ./...'] });
const evidence = { commands: ['go build ./...', 'go test ./...'].map(command => ({ command, status: 'completed', exitCode: 0 })) };

for (const bad of [[], [{ name: 'empty', files: [] }], [{ name: 'escape', files: ['../main.go'] }],
  [{ name: 'duplicate', files: ['main.go'] }, { name: 'duplicate', files: ['main.go'] }]]) {
  test(`module validation fails before an agent for ${JSON.stringify(bad)}`, async t => {
    const f = await fixture(t); await assert.rejects(prepareWorkflow('extract-rules', { modules: bad }, f.layout));
  });
}
test('valid module paths and normalized inputs remain replayable', async t => {
  const f = await fixture(t), first = await prepareWorkflow('extract-rules', { modules: [{ name: 'main', files: ['main.go'] }] }, f.layout);
  const second = await prepareWorkflow('extract-rules', first.input, f.layout); assert.deepEqual(first, second);
});
test('empty module list never broadens to whole source', async t => {
  const f = await fixture(t); await assert.rejects(prepareWorkflow('extract-rules', { modules: [] }, f.layout), /non-empty/);
});
test('extract rules refs each rule and requires two P0 judges', async () => {
  const e = workflowEngine('extract-rules', async s => {
    if (s.id.startsWith('rules-')) return { result: { rules: [rule({ priority: 'P0' })], coveredAreas: ['main.go'], injectionSuspects: [] } };
    if (s.id.startsWith('rule-ref')) return { result: goodRuleVote };
    if (s.id.startsWith('p0-')) return { result: { p0Justified: true, faithful: true, reason: 'verified' } };
    return { result: { dataObjects: [] } };
  });
  const out = await runWorkflow(e, { modules: [{ name: 'main', files: ['main.go'] }], batchSize: 8, maxRounds: 2 });
  assert.equal(out.confirmedRules.length, 1); assert.equal(out.incomplete, false);
  assert.equal(e.calls.filter(s => s.id.startsWith('p0-')).length, 2);
  assert(e.calls.filter(s => s.id.startsWith('p0-')).every(s => s.independent));
});
test('P0 disagreement is unresolved rather than majority-passed', async () => {
  const e = workflowEngine('extract-rules', async s => {
    if (s.id.startsWith('rules-')) return { result: { rules: [rule({ priority: 'P0' })], coveredAreas: [], injectionSuspects: [] } };
    if (s.id.startsWith('rule-ref')) return { result: goodRuleVote };
    if (s.id.startsWith('p0-')) return { result: { p0Justified: true, faithful: !s.id.startsWith('p0-1'), reason: 'vote' } };
    return { result: { dataObjects: [] } };
  });
  const out = await runWorkflow(e, { modules: [{ name: 'main', files: ['main.go'] }], batchSize: 8 });
  assert.equal(out.confirmedRules.length, 0); assert.equal(out.unresolvedRules.length, 1); assert.equal(out.incomplete, true);
});
test('wrong source correction is checked in another task', async () => {
  const e = workflowEngine('extract-rules', async s => {
    if (s.id.startsWith('rules-')) return { result: { rules: [rule()], coveredAreas: [], injectionSuspects: [] } };
    if (s.id.startsWith('rule-ref')) return { result: { ...goodRuleVote, verdict: 'wrong-citation', correctedSource: 'main.go:3-4' } };
    if (s.id.startsWith('rule-recheck')) return { result: goodRuleVote };
    return { result: { dataObjects: [] } };
  });
  const out = await runWorkflow(e, { modules: [{ name: 'main', files: ['main.go'] }], batchSize: 8 });
  assert.equal(out.confirmedRules[0].source, 'main.go:3-4'); assert(e.calls.some(s => s.id.startsWith('rule-recheck')));
});
test('extractor failure remains explicit coverage gap', async () => {
  const e = workflowEngine('extract-rules', async s => s.id.startsWith('rules-') ? { ok: false, error: 'timeout' } : { result: { dataObjects: [] } });
  const out = await runWorkflow(e, { modules: [{ name: 'main', files: ['main.go'] }], batchSize: 8 });
  assert.equal(out.failures.length, 1); assert.equal(out.incomplete, true);
});
test('lens mode stops at the first diminishing-return round', async () => {
  const e = workflowEngine('extract-rules', async s => s.id.startsWith('rules-')
    ? { result: { rules: [], coveredAreas: [], injectionSuspects: [] } } : { result: { dataObjects: [] } });
  const out = await runWorkflow(e, { maxRounds: 8 });
  assert.equal(out.stats.rounds, 1); assert.equal(e.calls.filter(s => s.id.startsWith('rules-round')).length, 3);
});
test('security workflow uses five lenses plus independent high severity confirmation', async () => {
  const vulnerability = { ...sample(S.finding), name: 'Object authorization missing', cwe: 'CWE-862', severity: 'High', source: 'api.go:12' };
  const e = workflowEngine('harden-scan', async s => s.id.startsWith('harden-')
    ? { result: { findings: [vulnerability], coveredAreas: ['api.go'], injectionSuspects: [] } }
    : { result: { verdict: 'confirmed', reason: 'guards checked' } });
  const out = await runWorkflow(e, {});
  assert.equal(out.confirmed.length, 1); assert.equal(e.calls.filter(s => s.id.startsWith('harden-')).length, 5);
  assert.equal(e.calls.filter(s => s.id.startsWith('security-panel')).length, 1); assert.equal(out.patchApplied, false);
});
test('security missing second vote leaves finding unresolved', async () => {
  const vulnerability = { ...sample(S.finding), severity: 'Critical', source: 'api.go:1' };
  const e = workflowEngine('harden-scan', async s => s.id.startsWith('harden-')
    ? { result: { findings: [vulnerability], coveredAreas: [], injectionSuspects: [] } }
    : s.id.startsWith('security-panel') ? { ok: false, error: 'unavailable' } : { result: { verdict: 'confirmed', reason: 'yes' } });
  const out = await runWorkflow(e, {}); assert.equal(out.confirmed.length, 0); assert.equal(out.unresolved.length, 1);
});
test('deltas use four lenses and referee code applicability', async () => {
  const d = { ...sample(S.delta), source_site: 'main.go:4', name: 'API removed' };
  const e = workflowEngine('uplift-deltas', async s => s.id.startsWith('deltas-')
    ? { result: { deltas: [d], toolReport: [], injectionSuspects: [] } }
    : { result: { verdict: 'not-hit', reason: 'not actually used', correctedSite: '', fixClassCorrection: '' } });
  const out = await runWorkflow(e, { sourceVersion: '1.0', targetVersion: '2.0' });
  assert.equal(out.rejected.length, 1); assert.equal(out.confirmed.length, 0); assert.equal(e.calls.filter(s => s.id.startsWith('deltas-')).length, 4);
});
test('portfolio unknown LOC is null index, not fake zero measurement', async () => {
  const e = workflowEngine('portfolio-assess', async () => ({ result: { ...sample(S.assessment), locKnown: false, loc: 0 } }));
  const out = await runWorkflow(e, { systems: [{ name: 'billing', source: '/source' }] });
  assert.equal(out.systems[0].codex.relativeScaleIndex, null); assert.equal(out.systems[0].system, 'billing');
});
for (const units of [[{ name: 'a', deps: ['a'] }], [{ name: 'a', deps: ['missing'] }],
  [{ name: 'a', deps: ['b'] }, { name: 'b', deps: ['a'] }]]) {
  test(`migration rejects invalid graph ${JSON.stringify(units)}`, () => assert.throws(() => validateGraph(units)));
}
test('migration accepts explicitly evidenced external prerequisite', () => {
  validateGraph([{ name: 'a', deps: ['pilot'] }, { name: 'b', deps: ['a'] }], ['pilot']);
});
test('model build claim without completed command is not measured', () => {
  assert.equal(measuredBuild({ ok: true, result: goodBuild('a'), evidence: { commands: [] } }).built, false);
  assert.equal(measuredBuild({ ok: true, result: goodBuild('a'), evidence }).built, true);
  assert.equal(measuredBuild({ ok: true, result: { ...goodBuild('a'), buildRan: false }, evidence }).built, false);
});
test('migration processes dependency-ready batches only', async () => {
  const built = new Set();
  const units = [{ name: 'a', path: 'a', absolutePath: '/candidate/a', deps: [] },
    { name: 'b', path: 'b', absolutePath: '/candidate/b', deps: ['a'] }];
  const e = workflowEngine('uplift-migrate', async s => {
    const unit = units.find(u => u.absolutePath === s.workingDirectory);
    assert((unit.deps ?? []).every(d => built.has(d))); built.add(unit.name);
    return { result: goodBuild(unit.name), evidence };
  });
  const out = await runWorkflow(e, { units, externalBuilt: [], batchSize: 4 });
  assert.equal(out.totals.built, 2); assert.equal(out.incomplete, false);
});
test('migration circuit breaker reports failed, blocked and untouched separately', async () => {
  const units = ['a', 'b', 'c'].map(n => ({ name: n, path: n, absolutePath: `/candidate/${n}`, deps: [] }));
  units.push({ name: 'dependent', path: 'dependent', absolutePath: '/candidate/dependent', deps: ['a'] });
  units.push({ name: 'untouched', path: 'untouched', absolutePath: '/candidate/untouched', deps: [] });
  const e = workflowEngine('uplift-migrate', async s => ({ result: { ...goodBuild(s.workingDirectory.split('/').at(-1)), built: false },
    evidence: { commands: [{ command: 'go build ./...', status: 'completed', exitCode: 1 }] } }));
  const out = await runWorkflow(e, { units, externalBuilt: [], batchSize: 3 });
  assert.equal(out.abortedEarly, true); assert.equal(out.totals.attempted, 3); assert.equal(out.failedUnits.length, 3);
  assert.equal(out.blockedUnits[0].name, 'dependent'); assert.equal(out.remainingUnits[0].name, 'untouched');
});
test('migration allows exactly two thirds measurable success', async () => {
  const units = ['a', 'b', 'c'].map(n => ({ name: n, path: n, absolutePath: `/candidate/${n}`, deps: [] }));
  const e = workflowEngine('uplift-migrate', async s => ({ result: { ...goodBuild(path.basename(s.workingDirectory)), built: !s.workingDirectory.endsWith('/c') }, evidence }));
  const out = await runWorkflow(e, { units, externalBuilt: [], batchSize: 3 }); assert.equal(out.abortedEarly, false); assert.equal(out.incomplete, true);
});
test('zero measured builds trips breaker rather than division by zero or fake pass', async () => {
  const e = workflowEngine('uplift-migrate', async () => ({ result: goodBuild('a'), evidence: { commands: [] } }));
  const out = await runWorkflow(e, { units: [{ name: 'a', path: 'a', absolutePath: '/candidate/a', deps: [] }], externalBuilt: [], batchSize: 4 });
  assert.equal(out.abortedEarly, true); assert.equal(out.totals.measurable, 0);
});
test('scaffolding visits every service, not only first three', async () => {
  const services = Array.from({ length: 8 }, (_, i) => ({ name: `s${i}`, absolutePath: `/candidate/s${i}`, contract: 'approved contract' }));
  const e = workflowEngine('reimagine-scaffold', async () => ({ result: sample(S.scaffold) }));
  const out = await runWorkflow(e, { services }); assert.equal(out.services.length, 8); assert.equal(e.calls.length, 8); assert.equal(out.implementationComplete, false);
});
test('writes reject missing gate or allow-writes flag', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing-uplifted');
  await fs.mkdir(path.join(candidate, 'a'), { recursive: true });
  const input = { candidate, units: [{ name: 'a', path: 'a' }] };
  await assert.rejects(prepareWorkflow('uplift-migrate', input, f.layout), /allow-writes/);
  await assert.rejects(prepareWorkflow('uplift-migrate', input, f.layout, { allowWrites: true }), /gates/);
});
test('approved gate excerpts and unit scopes are validated and replayable', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing-uplifted');
  await fs.mkdir(path.join(candidate, 'a'), { recursive: true });
  const briefQuote = 'Approved by: Test human  Date: 2026-10-15', pilotQuote = 'Pilot build and tests succeeded in fixture', fanQuote = 'Test human approves fan-out of unit a only';
  await fs.writeFile(path.join(f.layout.analysis, 'MODERNIZATION_BRIEF.md'), briefQuote);
  await fs.writeFile(path.join(f.layout.analysis, 'PLAYBOOK.md'), `${pilotQuote}\n${fanQuote}`);
  const input = { candidate, contextFiles: ['PLAYBOOK.md'], units: [{ name: 'a', path: 'a', deps: [] }], gates: {
    brief: { file: 'MODERNIZATION_BRIEF.md', quote: briefQuote }, pilot: { file: 'PLAYBOOK.md', quote: pilotQuote }, fanout: { file: 'PLAYBOOK.md', quote: fanQuote },
  } };
  const prepared = await prepareWorkflow('uplift-migrate', input, f.layout, { allowWrites: true });
  assert.deepEqual(await prepareWorkflow('uplift-migrate', prepared.input, f.layout, { allowWrites: true }), prepared);
  input.gates.fanout.quote = 'This was never approved';
  await assert.rejects(prepareWorkflow('uplift-migrate', input, f.layout, { allowWrites: true }), /not present/);
});
test('overlapping writable unit directories are rejected', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing-reimagined');
  await fs.mkdir(path.join(candidate, 'a', 'child'), { recursive: true });
  const quote = 'Synthetic explicitly approved design for tests';
  await fs.writeFile(path.join(f.layout.analysis, 'APPROVAL.md'), quote);
  const gate = { file: 'APPROVAL.md', quote };
  await assert.rejects(prepareWorkflow('reimagine-scaffold', { candidate, gates: { brief: gate, spec: gate, architecture: gate },
    services: [{ name: 'a', path: 'a', contract: 'contract' }, { name: 'child', path: 'a/child', contract: 'contract' }] }, f.layout, { allowWrites: true }), /overlap/);
});
test('full extraction integration through engine and public SDK-shaped test double', async t => {
  const f = await fixture(t), prepared = await prepareWorkflow('extract-rules', { modules: [{ name: 'main', files: ['main.go'] }] }, f.layout);
  const client = fakeCodex(async c => {
    if (c.schema === S.rules) return { result: { ...sample(S.rules), rules: [rule()], coveredAreas: ['main.go'] } };
    if (c.schema === S.ruleVerdict) return { result: goodRuleVote };
    return { result: sample(S.dataObjects) };
  });
  const engine = await Engine.open({ layout: f.layout, workflow: 'extract-rules', ...prepared, factory: () => client });
  const out = await runWorkflow(engine, prepared.input), end = await engine.finish(out);
  assert.equal(out.confirmedRules.length, 1); assert.equal(end.status, 'completed'); assert.equal(client.calls.length, 3);
});
