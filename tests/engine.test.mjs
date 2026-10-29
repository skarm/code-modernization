import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Engine, resolveLayout } from '../runtime/engine.mjs';
import { streamTurn, threadOptions, childEnvironment, findCodex } from '../runtime/sdk.mjs';
import { atomicJSON, readJSON } from '../runtime/util.mjs';
import { record, string } from '../runtime/schemas.mjs';
import { fakeCodex, fixture } from './helpers.mjs';

const schema = record({ summary: string });
const spec = (id = 'one') => ({ id, role: 'legacy-analyst', prompt: 'Analyze only the source.', schema });
async function open(f, client, extra = {}) {
  return Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client, ...extra });
}
test('streamed SDK task uses safe options, outputs and event log', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'done' }, events: [
    { type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'private summary not logged' } },
  ] }));
  const engine = await open(f, client); const result = await engine.task(spec());
  assert.equal(result.ok, true); assert.equal(client.started[0].options.sandboxMode, 'read-only');
  assert.equal(client.started[0].options.approvalPolicy, 'never'); assert.equal(client.started[0].options.webSearchMode, 'disabled');
  const log = await fs.readFile(path.join(engine.runDir, 'one.events.jsonl'), 'utf8');
  assert(!log.includes('private summary')); assert(!log.includes('"text"'));
  const ended = await engine.finish({ done: true }); assert.equal(ended.status, 'completed');
  assert.equal(ended.usage.input_tokens, 10);
});
test('successful task is reused without another SDK call', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client);
  await engine.task(spec()); const cached = await engine.task(spec());
  assert.equal(cached.cached, true); assert.equal(client.calls.length, 1); await engine.finish({});
});
test('saved result tampering is rejected', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client);
  await engine.task(spec()); await atomicJSON(path.join(engine.runDir, 'one.result.json'), { changed: true });
  await assert.rejects(engine.task(spec()), /Saved result was changed/); await engine.finish({});
});
test('failed task resumes its saved SDK thread and successful tasks remain cached', async t => {
  const f = await fixture(t), client1 = fakeCodex(async c => ({ result: { summary: 'ok' }, ...(c.input.includes('fail once') ? { error: 'temporary failure' } : {}) }));
  const first = await open(f, client1, { runId: 'resume-test' });
  await first.task(spec('ok')); const badSpec = { ...spec('bad'), prompt: 'fail once' };
  await first.task(badSpec); const oldId = first.state.tasks.bad.threadId; await first.finish({ incomplete: true });
  const client2 = fakeCodex(); const second = await open(f, client2, { runId: 'resume-test', resume: true });
  assert.equal((await second.task(spec('ok'))).cached, true);
  assert.equal((await second.task(badSpec)).ok, true); assert.equal(client2.resumed[0].id, oldId);
  await second.finish({});
});
test('input/source changes invalidate resume', async t => {
  const f = await fixture(t), client = fakeCodex(); const first = await open(f, client, { runId: 'stale' });
  await first.finish({ incomplete: true }); await fs.appendFile(path.join(f.source, 'main.go'), '// changed');
  await assert.rejects(open(f, client, { runId: 'stale', resume: true }), /Inputs, source/);
});
test('concurrent workers stay within configured bound', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'ok' }, delayMs: 8 }));
  const engine = await open(f, client, { options: { concurrency: 2 } });
  const outputs = await engine.parallel(Array.from({ length: 7 }, (_, i) => spec(`task-${i}`)));
  assert(outputs.every(x => x.ok)); assert.equal(client.stats.peak, 2); assert.equal(client.stats.active, 0);
  await engine.finish({});
});
test('malformed structured output gets one response-only correction in same thread', async t => {
  const f = await fixture(t), client = fakeCodex(async c => c.turn === 1 ? { raw: 'not json' } : { result: { summary: 'corrected' } });
  const engine = await open(f, client); const output = await engine.task(spec());
  assert.equal(output.ok, true); assert.equal(client.started.length, 1); assert.equal(client.calls.length, 2);
  assert.equal(engine.state.turnsStarted, 2); assert.equal(engine.state.usage.input_tokens, 20); await engine.finish({});
});
test('permanently malformed output remains failed', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ raw: '{"other":true}' }));
  const engine = await open(f, client); assert.equal((await engine.task(spec())).ok, false);
  assert.equal(client.calls.length, 2); assert.equal((await engine.finish({})).status, 'partial');
});
for (const scenario of ['missing-completion', 'turn-error', 'stream-error', 'missing-response']) {
  test(`SDK ${scenario} is not a successful empty result`, async t => {
    const f = await fixture(t), client = fakeCodex(async () => ({
      ...(scenario === 'missing-completion' ? { omitCompletion: true } : {}),
      ...(scenario === 'missing-response' ? { omitResponse: true } : {}),
      ...(scenario === 'turn-error' ? { events: [{ type: 'turn.failed', error: { message: 'failed' } }] } : {}),
      ...(scenario === 'stream-error' ? { events: [{ type: 'error', message: 'fatal' }] } : {}),
    }));
    const engine = await open(f, client); assert.equal((await engine.task(spec())).ok, false); await engine.finish({});
  });
}
test('cancellation before scheduling starts no client task', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client);
  engine.cancel(); assert.equal((await engine.task(spec())).ok, false); assert.equal(client.calls.length, 0);
  assert.equal((await engine.finish({})).status, 'stopped');
});
test('task timeout aborts the SDK signal and waits for worker exit', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ delayMs: 1000 }));
  const engine = await open(f, client, { options: { taskTimeoutMs: 20 } });
  const output = await engine.task(spec()); assert.equal(output.ok, false); assert.equal(client.calls[0].signal.aborted, true);
  assert.match(output.error, /Task one timed out/);
  assert.equal(engine.state.tasks.one.error, output.error);
  assert.equal(client.stats.active, 0); await engine.finish({});
});
test('turn budget stops new tasks; does not kill already completed evidence', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client, { options: { maxTurns: 1 } });
  assert.equal((await engine.task(spec('first'))).ok, true); assert.equal((await engine.task(spec('second'))).ok, false);
  assert.equal(client.calls.length, 1); await engine.finish({});
});
test('observed token budget stops later launches', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client, { options: { maxTokens: 5 } });
  await engine.task(spec('first')); assert.equal((await engine.task(spec('second'))).ok, false); await engine.finish({});
});
test('source modification makes final run stopped, not completed', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client);
  await engine.task(spec()); await fs.appendFile(path.join(f.source, 'main.go'), '//mutated');
  const finished = await engine.finish({}); assert.equal(finished.status, 'stopped');
  assert.match(engine.state.errors[0].message, /Legacy source changed/);
});
test('coordinator lock prevents concurrent or accidental recovered writers', async t => {
  const f = await fixture(t), client = fakeCodex(); const engine = await open(f, client);
  await assert.rejects(open(f, client), /Another run/);
  await assert.rejects(open(f, client, { options: { confirmStopped: true } }), /still running/);
  await engine.finish({});
});
test('writable scope requires explicit authorization and cannot be shared root', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing');
  await fs.mkdir(path.join(candidate, 'unit'), { recursive: true });
  const engine = await open(f, fakeCodex(), { candidate });
  await assert.rejects(engine.task({ ...spec(), role: 'uplift-migrator', write: true, workingDirectory: path.join(candidate, 'unit') }), /not authorized/);
  await engine.finish({});
});
test('writer success uses workspace sandbox; output mutation prevents cached resume', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing'), unit = path.join(candidate, 'unit');
  await fs.mkdir(unit, { recursive: true });
  const client = fakeCodex(), config = { candidate, runId: 'writer', options: { allowWrites: true } };
  const engine = await open(f, client, config);
  assert.equal((await engine.task({ ...spec(), role: 'uplift-migrator', write: true, workingDirectory: unit })).ok, true);
  assert.equal(client.started[0].options.sandboxMode, 'workspace-write');
  await engine.finish({ incomplete: true }); await fs.writeFile(path.join(unit, 'new'), 'modified');
  await assert.rejects(open(f, client, { ...config, resume: true }), /Completed writable scope changed/);
});
test('unsafe write response is not retried automatically', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized', 'billing'), unit = path.join(candidate, 'unit');
  await fs.mkdir(unit, { recursive: true });
  const client = fakeCodex(async () => ({ raw: 'not json' })), engine = await open(f, client, { candidate, options: { allowWrites: true } });
  assert.equal((await engine.task({ ...spec(), role: 'uplift-migrator', write: true, workingDirectory: unit })).ok, false);
  assert.equal(client.calls.length, 1); await engine.finish({});
});
test('role model settings passed only as SDK-supported options', async t => {
  const f = await fixture(t), client = fakeCodex(), engine = await open(f, client, { options: { roles: { 'legacy-analyst': { model: 'user-selected-model', reasoningEffort: 'high' } } } });
  await engine.task(spec()); const o = client.started[0].options;
  assert.equal(o.model, 'user-selected-model'); assert.equal(o.modelReasoningEffort, 'high'); await engine.finish({});
});
test('environment does not inherit arbitrary project secrets', () => {
  assert.deepEqual(childEnvironment({ PATH: '/bin', HOME: '/home/user', DATABASE_PASSWORD: 'secret' }),
    { PATH: '/bin', HOME: '/home/user', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'codex_sdk_ts', CODEX_MODERNIZATION_WORKER: '1' });
});
test('explicit binary must be absolute, executable and not a directory', async t => {
  const f = await fixture(t); await assert.rejects(findCodex('./codex'), /absolute/);
  await assert.rejects(findCodex(f.root), /not a file/);
  const executable = path.join(f.root, 'codex'); await fs.writeFile(executable, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  assert.equal(await findCodex(executable), executable);
});
test('legacy and SOURCE disagreement rejected', async t => {
  const f = await fixture(t), other = path.join(f.root, 'other'); await fs.mkdir(other);
  await fs.writeFile(path.join(f.layout.analysis, 'SOURCE'), other);
  await assert.rejects(resolveLayout(f.workspace, 'billing', f.source), /disagree/);
});
