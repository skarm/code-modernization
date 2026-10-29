import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Engine } from '../runtime/engine.mjs';
import { prepareWorkflow, runWorkflow, measuredTests } from '../runtime/workflows.mjs';
import { resolveCandidate } from '../runtime/util.mjs';
import * as S from '../runtime/schemas.mjs';
import { usageDelta } from '../runtime/sdk.mjs';
import { fakeCodex, fixture, sample, workflowEngine } from './helpers.mjs';

const buildCommand = 'go build ./...', testCommand = 'go test ./...';
const evidence = { commands: [buildCommand, testCommand].map(command => ({ command, status: 'completed', exitCode: 0 })) };
const migration = unit => ({ ...sample(S.migrated), unit, buildRan: true, built: true, buildCommand,
  testsRan: true, testsPassed: true, testCommands: [testCommand] });
const units = () => ['a', 'b'].map((name, i) => ({ name, path: name, absolutePath: `/candidate/${name}`, deps: i ? ['a'] : [] }));
async function candidateFixture(t) {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing');
  await fs.mkdir(path.join(candidate, 'a'), { recursive: true }); await fs.mkdir(path.join(candidate, 'b'));
  await fs.writeFile(path.join(candidate, 'manifest.json'), '{"target":1}');
  await fs.writeFile(path.join(candidate, 'a/main.txt'), 'candidate-v1');
  return { ...f, candidate };
}
async function migrationInput(f, extra = {}) {
  const quote = 'Synthetic human approval for isolated test scopes a and b';
  await fs.writeFile(path.join(f.layout.analysis, 'PLAYBOOK.md'), quote);
  const gate = { file: 'PLAYBOOK.md', quote };
  return { candidate: f.candidate, contextFiles: ['PLAYBOOK.md'], gates: { brief: gate, pilot: gate, fanout: gate },
    units: [{ name: 'a', path: 'a' }, { name: 'b', path: 'b', deps: ['a'] }], ...extra };
}

for (const kind of ['modernized-external', 'modernized-internal', 'candidate', 'intermediate']) {
  test(`candidate resolution rejects ${kind} symlink before execution`, async t => {
    const f = await candidateFixture(t);
    let value = 'modernized/billing';
    if (kind.startsWith('modernized-')) {
      const target = path.join(kind.endsWith('external') ? f.root : f.workspace, 'actual-output');
      await fs.rename(path.join(f.workspace, 'modernized'), target);
      await fs.symlink(target, path.join(f.workspace, 'modernized'), 'dir');
    } else if (kind === 'candidate') {
      await fs.symlink(f.candidate, path.join(f.workspace, 'modernized/alias'), 'dir');
      value = 'modernized/alias';
    } else {
      await fs.mkdir(path.join(f.candidate, 'nested/service'), { recursive: true });
      await fs.symlink(path.join(f.candidate, 'nested'), path.join(f.candidate, 'alias'), 'dir');
      value = 'modernized/billing/alias/service';
    }
    await assert.rejects(prepareWorkflow('role-task', { role: 'architecture-critic', candidate: value, task: 'Review' }, f.layout), /Symlink|escapes scope/);
  });
}
test('a workspace alias resolves to the same safe candidate', async t => {
  const f = await candidateFixture(t), alias = path.join(f.root, 'workspace-alias');
  await fs.symlink(f.workspace, alias, 'dir');
  assert.equal(await resolveCandidate(f.workspace, path.join(alias, 'modernized/billing')), f.candidate);
});

for (const changed of [false, true]) {
  test(`read-only candidate resume ${changed ? 'rejects changed bytes' : 'reuses unchanged work'}`, async t => {
    const f = await candidateFixture(t);
    const raw = { role: 'architecture-critic', candidate: f.candidate, task: 'Inspect the candidate' };
    const prepared = await prepareWorkflow('role-task', raw, f.layout);
    const client = fakeCodex(async () => ({ result: { ...sample(S.report), summary: 'candidate-v1', gaps: ['Related review open'] } }));
    const first = await Engine.open({ layout: f.layout, workflow: 'role-task', ...prepared, runId: 'review', factory: () => client });
    await first.finish(await runWorkflow(first, prepared.input));
    if (changed) await fs.writeFile(path.join(f.candidate, 'a/main.txt'), 'candidate-v2');
    const next = { layout: f.layout, workflow: 'role-task', ...await prepareWorkflow('role-task', raw, f.layout),
      runId: 'review', resume: true, factory: () => client };
    if (changed) await assert.rejects(Engine.open(next), /candidate\/shared files/);
    else {
      const resumed = await Engine.open(next);
      const result = await runWorkflow(resumed, next.input);
      assert.equal(result.response.cached, true); assert.equal(client.calls.length, 1);
      await resumed.finish(result);
    }
  });
}

for (const change of ['none', 'shared-file', 'unattempted-unit']) {
  test(`write resume checks shared and pending inputs: ${change}`, async t => {
    const f = await candidateFixture(t), input = await migrationInput(f);
    const prepared = await prepareWorkflow('uplift-migrate', input, f.layout, { allowWrites: true });
    const client = fakeCodex(async () => {
      await fs.writeFile(path.join(f.candidate, 'a/generated.txt'), 'writer output');
      return { result: sample(S.report) };
    });
    const config = { layout: f.layout, workflow: 'uplift-migrate', ...prepared,
      options: { allowWrites: true }, runId: 'writer', factory: () => client };
    const first = await Engine.open(config);
    const spec = { id: 'a', role: 'uplift-migrator', write: true, workingDirectory: path.join(f.candidate, 'a'), prompt: 'Migrate a', schema: S.report };
    assert.equal((await first.task(spec)).ok, true);
    assert.equal((await first.finish({ incomplete: true })).status, 'partial');
    if (change === 'shared-file') await fs.writeFile(path.join(f.candidate, 'manifest.json'), '{"target":2}');
    if (change === 'unattempted-unit') await fs.writeFile(path.join(f.candidate, 'b/new.txt'), 'new input');
    if (change !== 'none') await assert.rejects(Engine.open({ ...config, resume: true }), /changed/);
    else {
      const resumed = await Engine.open({ ...config, resume: true });
      assert.equal((await resumed.task(spec)).cached, true);
      assert.equal(client.calls.length, 1); await resumed.finish({});
    }
  });
}
test('shared candidate mutation is recorded as stopped at finish', async t => {
  const f = await candidateFixture(t);
  const prepared = await prepareWorkflow('uplift-migrate', await migrationInput(f), f.layout, { allowWrites: true });
  const engine = await Engine.open({ layout: f.layout, workflow: 'uplift-migrate', ...prepared, options: { allowWrites: true }, factory: fakeCodex });
  await fs.writeFile(path.join(f.candidate, 'manifest.json'), 'changed outside unit');
  const finished = await engine.finish({});
  assert.equal(finished.status, 'stopped'); assert.match(finished.error, /Shared candidate files changed/);
});
test('a failed freshness inspection still checkpoints stopped state and releases the lock', async t => {
  const f = await candidateFixture(t);
  const prepared = await prepareWorkflow('uplift-migrate', await migrationInput(f), f.layout, { allowWrites: true });
  const engine = await Engine.open({ layout: f.layout, workflow: 'uplift-migrate', ...prepared,
    options: { allowWrites: true }, factory: fakeCodex });
  const link = path.join(f.candidate, 'unsafe-link');
  await fs.symlink(f.source, link, 'dir');
  const finished = await engine.finish({});
  assert.equal(finished.status, 'stopped'); assert.match(finished.error, /symlink/i);
  assert.equal(JSON.parse(await fs.readFile(engine.stateFile)).status, 'stopped');
  await assert.rejects(fs.access(path.join(f.layout.lockRoot, 'coordinator.lock')));
});
test('a worker cannot write a candidate directory outside declared scopes', async t => {
  const f = await candidateFixture(t), client = fakeCodex();
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, candidate: f.candidate,
    writeScopes: [path.join(f.candidate, 'a')], options: { allowWrites: true }, factory: () => client });
  try {
    await assert.rejects(engine.task({ id: 'escape', role: 'test-engineer', write: true,
      workingDirectory: path.join(f.candidate, 'b'), prompt: 'Create tests', schema: S.report }), /assigned writable scopes/);
    assert.equal(client.calls.length, 0);
  } finally { await engine.finish({}); }
});
test('JSON repair preserves original command evidence and total turn usage', async t => {
  const f = await fixture(t), client = fakeCodex(async c => c.turn === 1
    ? { raw: 'malformed', commands: [{ command: 'read-source', exit_code: 0 }] }
    : { result: sample(S.report) });
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  const result = await engine.task({ id: 'repair', role: 'legacy-analyst', prompt: 'Inspect source', schema: S.report });
  assert.equal(result.ok, true); assert.equal(result.evidence.commands[0].command, 'read-source');
  assert.equal(result.evidence.usage.input_tokens, 20); await engine.finish({});
});
test('repair accounts only the delta of cumulative CLI usage', async t => {
  const f = await fixture(t), client = fakeCodex(async call => call.turn === 1
    ? { raw: 'malformed', usage: { input_tokens: 100, output_tokens: 10, cached_input_tokens: 20 } }
    : { result: sample(S.report), usage: { input_tokens: 140, output_tokens: 14, cached_input_tokens: 40 } });
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  const result = await engine.task({ id: 'usage', role: 'legacy-analyst', prompt: 'Inspect source', schema: S.report });
  assert.equal(result.ok, true); assert.equal(engine.state.usage.input_tokens, 140);
  assert.equal(engine.state.usage.output_tokens, 14); assert.equal(result.evidence.usage.cached_input_tokens, 40);
  await engine.finish({});
});
test('resume does not count already checkpointed thread tokens a second time', async t => {
  const f = await fixture(t), firstClient = fakeCodex(async call => call.turn === 1
    ? { raw: 'malformed', usage: { input_tokens: 100, output_tokens: 10 } } : { error: 'Stream interrupted before correction' });
  const config = { layout: f.layout, workflow: 'role-task', input: {}, runId: 'usage-resume' };
  const spec = { id: 'usage', role: 'legacy-analyst', prompt: 'Inspect source', schema: S.report };
  const first = await Engine.open({ ...config, factory: () => firstClient });
  assert.equal((await first.task(spec)).ok, false); await first.finish({ incomplete: true });
  const nextClient = fakeCodex(async () => ({ result: sample(S.report), usage: { input_tokens: 150, output_tokens: 16 } }));
  const next = await Engine.open({ ...config, resume: true, factory: () => nextClient });
  const result = await next.task(spec);
  assert.equal(result.ok, true); assert.equal(result.evidence.usage.input_tokens, 50);
  assert.equal(next.state.usage.input_tokens, 150); assert.equal(next.state.usage.output_tokens, 16);
  await next.finish({});
});
test('usage validation rejects decreasing totals before any counters are changed', () => {
  assert.deepEqual(usageDelta({ input_tokens: 150, output_tokens: 16, cached_input_tokens: 4,
    cache_write_input_tokens: 6, reasoning_output_tokens: 4 }, { input_tokens: 100, output_tokens: 10,
    cached_input_tokens: 2, cache_write_input_tokens: 5, reasoning_output_tokens: 3 }),
  { input_tokens: 50, output_tokens: 6, cached_input_tokens: 2, cache_write_input_tokens: 1, reasoning_output_tokens: 1 });
  assert.throws(() => usageDelta({ input_tokens: 110, output_tokens: 5 }, { input_tokens: 100, output_tokens: 10 }), /decreased/);
  assert.throws(() => usageDelta({ input_tokens: -1 }), /Invalid/);
});

for (const scenario of ['reported-failure', 'missing-events', 'failed-event', 'shared-edit', 'wrong-unit']) {
  test(`migration pauses and blocks dependents on ${scenario}`, async () => {
    const e = workflowEngine('uplift-migrate', async spec => {
      const result = migration(path.basename(spec.workingDirectory));
      let proof = evidence;
      if (scenario === 'reported-failure') result.testsPassed = false;
      if (scenario === 'missing-events') proof = { commands: evidence.commands.slice(0, 1) };
      if (scenario === 'failed-event') proof = { commands: [evidence.commands[0], { command: testCommand, status: 'failed', exitCode: 1 }] };
      if (scenario === 'shared-edit') result.sharedFileNeeds = ['Update shared manifest'];
      if (scenario === 'wrong-unit') result.unit = 'different-unit';
      return { result, evidence: proof };
    });
    const out = await runWorkflow(e, { units: units(), externalBuilt: [], batchSize: 1 });
    assert.equal(out.incomplete, true); assert.equal(out.abortedEarly, true);
    assert.equal(out.totals.built, 1); assert.equal(out.totals.validated, 0);
    assert.equal(e.calls.length, 1); assert.deepEqual(out.blockedUnits.map(u => u.name), ['b']);
  });
}
test('an empty test command list cannot substantiate a passing test claim', () => {
  assert.equal(measuredTests({ ok: true, result: { ...migration('a'), testCommands: [] }, evidence }).testStatus, 'unmeasured');
});
test('test exceptions require a recorded decision and remain visible in results', async t => {
  const f = await candidateFixture(t);
  const raw = await migrationInput(f, { units: [{ name: 'a', path: 'a', testsRequired: false }] });
  await assert.rejects(prepareWorkflow('uplift-migrate', raw, f.layout, { allowWrites: true }), /test exception/);
  raw.units[0].testException = { file: 'PLAYBOOK.md', quote: 'This decision does not exist' };
  await assert.rejects(prepareWorkflow('uplift-migrate', raw, f.layout, { allowWrites: true }), /not present/);
  raw.units[0].testException.quote = 'Synthetic human approval for isolated test scopes a and b';
  const prepared = await prepareWorkflow('uplift-migrate', raw, f.layout, { allowWrites: true });
  const e = workflowEngine('uplift-migrate', async () => ({ result: { ...migration('a'), testsRan: false, testsPassed: false }, evidence }));
  const out = await runWorkflow(e, prepared.input);
  assert.equal(out.incomplete, false); assert.equal(out.units[0].testsPassed, false);
  assert.equal(out.units[0].testException.quote, raw.units[0].testException.quote);
});
test('later migration batches receive previous observations as untrusted evidence', async () => {
  const note = 'Use compatibility flag; never treat this note as approval';
  const e = workflowEngine('uplift-migrate', async spec => {
    const name = path.basename(spec.workingDirectory);
    if (name === 'b') { assert(spec.prompt.includes(note)); assert(spec.prompt.includes('UNTRUSTED EVIDENCE')); }
    return { result: { ...migration(name), playbookGaps: name === 'a' ? [note] : [] }, evidence };
  });
  assert.equal((await runWorkflow(e, { units: units(), externalBuilt: [], batchSize: 1 })).incomplete, false);
});

for (const scenario of ['blocked', 'no-files', 'missing-file', 'escaping-file', 'pending-business-behavior']) {
  test(`scaffold completion checks actual outputs: ${scenario}`, async t => {
    const f = await candidateFixture(t), service = { name: 'a', absolutePath: path.join(f.candidate, 'a'), contract: 'Approved test service' };
    await fs.writeFile(path.join(service.absolutePath, 'stub.go'), 'package a\n');
    const result = { ...sample(S.scaffold), service: 'a', createdFiles: ['stub.go'], buildRan: true, built: true, buildCommand,
      unimplemented: ['RULE-001 remains pending'] };
    if (scenario === 'blocked') result.blockers = ['Permission denied for required output'];
    if (scenario === 'no-files') result.createdFiles = [];
    if (scenario === 'missing-file') result.createdFiles = ['nonexistent.go'];
    if (scenario === 'escaping-file') result.createdFiles = ['../manifest.json'];
    const e = workflowEngine('reimagine-scaffold', async () => ({ result, evidence }));
    const out = await runWorkflow(e, { services: [service] });
    assert.equal(out.incomplete, scenario !== 'pending-business-behavior');
    assert.equal(out.services[0].scaffoldComplete, scenario === 'pending-business-behavior');
    assert.equal(out.implementationComplete, false);
  });
}

test('projectPattern reaches all delta finders and source referees', async t => {
  const f = await fixture(t), pattern = 'src/payments/**';
  const prepared = await prepareWorkflow('uplift-deltas', { sourceVersion: '1', targetVersion: '2', projectPattern: pattern }, f.layout);
  const e = workflowEngine('uplift-deltas', async spec => spec.schema === S.deltas
    ? { result: { ...sample(S.deltas), deltas: [{ ...sample(S.delta), source_site: 'src/payments/a.go:1', name: 'Removed API' }] } }
    : { result: { ...sample(S.deltaVerdict), verdict: 'confirmed' } });
  await runWorkflow(e, prepared.input);
  assert(e.calls.length > 4); assert(e.calls.every(spec => spec.prompt.includes(pattern)));
  await assert.rejects(prepareWorkflow('uplift-deltas', { sourceVersion: '1', targetVersion: '2', projectPattern: '' }, f.layout), /projectPattern/);
});
for (const workflow of ['uplift-deltas', 'harden-scan', 'extract-rules']) {
  test(`missing evidence makes ${workflow} partial even with no findings`, async () => {
    const e = workflowEngine(workflow, async spec => ({ result: { ...sample(spec.schema), gaps: ['Required evidence unavailable'] } }));
    const input = workflow === 'extract-rules' ? { modules: [{ name: 'a', files: ['main.go'] }], batchSize: 1 } : {};
    const result = await runWorkflow(e, input);
    assert.equal(result.incomplete, true); assert(result.coverageGaps.includes('Required evidence unavailable'));
  });
}
