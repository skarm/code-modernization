// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { Engine } from '../runtime/engine.mjs';
import { CONTEXT_MARKER } from '../runtime/decisions.mjs';
import { atomicJSON, readJSON } from '../runtime/util.mjs';
import { record, string } from '../runtime/schemas.mjs';
import { fixture, fakeCodex } from './helpers.mjs';
import { createDemo } from '../examples/ui-demo.mjs';
import { JournalTail } from '../runtime/ui/journal.mjs';
import { WorkspaceFiles, ReadCache } from '../runtime/ui/files.mjs';
import { LiveStore, eventStream } from '../runtime/ui/live.mjs';
import { RunSupervisor, runRevision } from '../runtime/ui/control.mjs';
import { runHealth } from '../runtime/ui/health.mjs';
import { withFileLock } from '../runtime/ui/lock.mjs';
import { readModel } from '../runtime/ui/model.mjs';
import { saveReview } from '../runtime/ui/decisions.mjs';
import { cardRevision, entryRevision } from '../runtime/ui/model.mjs';
import { parseRules } from '../runtime/ui/upstream/reader/rules.mjs';
import { startPanel } from '../runtime/ui/server.mjs';
import { SSEParser, applyUpdate, LiveConnection } from '../assets/live-client.mjs';

const schema = record({ summary: string });
const spec = id => ({ id, role: 'legacy-analyst', prompt: 'Inspect approved source', schema });
async function until(predicate, timeout = 4000) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error('Timed out waiting for state'); await delay(10); }
}
async function engineFor(f, client, extra = {}) {
  return Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client, ...extra });
}
async function send(engine, action, extra = {}) {
  const id = randomUUID();
  await atomicJSON(path.join(engine.runDir, 'control.json'), { version: 1, id, runId: engine.state.id, controlToken: engine.state.controlToken, action, ...extra });
  await engine.checkCancellation(); await until(() => engine.state.control?.acknowledged === id); return engine.state.control;
}
async function demo(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-live-')));
  t.after(() => fs.rm(root, { recursive: true, force: true })); await createDemo(root);
  return { root, dir: path.join(root, 'analysis/carddemo') };
}

test('pause drains active tasks, exposes the queue and resume launches remaining work', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'ok' }, delayMs: 70 }));
  const e = await engineFor(f, client, { options: { concurrency: 1 } });
  try {
    const work = e.parallel([spec('first'), spec('second'), spec('third')]);
    await until(() => client.calls.length === 1); await send(e, 'pause');
    assert.equal(e.state.status, 'pausing');
    await until(() => e.state.status === 'paused');
    assert.equal(client.calls.length, 1); assert.equal(e.state.tasks.second.status, 'queued');
    await send(e, 'resume'); const result = await work;
    assert(result.every(r => r.ok)); assert.equal(client.calls.length, 3); assert.equal(client.stats.active, 0);
    assert.equal((await e.finish({})).status, 'completed');
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('stop wakes a paused queue without launching more SDK workers', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'ok' }, delayMs: 30 })), e = await engineFor(f, client, { options: { concurrency: 1 } });
  try {
    const work = e.parallel([spec('first'), spec('second')]); await until(() => client.calls.length === 1);
    await send(e, 'pause'); await until(() => e.state.status === 'paused'); await send(e, 'stop');
    const result = await work; assert.equal(result[1].ok, false); assert.equal(client.calls.length, 1);
    assert.equal(e.state.tasks.second.status, 'deferred'); assert.equal(e.state.tasks.second.attempts, 0);
    assert.equal((await e.finish({})).status, 'stopped');
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('controls from a former generation and unknown actions cannot pause a run', async t => {
  const f = await fixture(t), e = await engineFor(f, fakeCodex());
  try {
    await atomicJSON(path.join(e.runDir, 'control.json'), { version: 1, id: 'old', runId: e.state.id, controlToken: 'former-generation', action: 'pause' });
    await e.checkCancellation(); assert.equal(e.paused, false);
    await atomicJSON(path.join(e.runDir, 'control.json'), { version: 1, id: 'bad', runId: e.state.id, controlToken: e.state.controlToken, action: 'execute' });
    await e.checkCancellation(); assert.equal(e.paused, false); await e.finish({});
  } finally { if (!e.closing) await e.finish(); }
});

test('a paused engine keeps its process alive without a CLI timer', { timeout: 10000 }, async t => {
  const f = await fixture(t), engineURL = new URL('../runtime/engine.mjs', import.meta.url).href;
  const script = `import {Engine} from ${JSON.stringify(engineURL)};
    const e = await Engine.open({layout:${JSON.stringify(f.layout)},workflow:'role-task',input:{}});
    e.paused=true; await e.runState(); console.log(JSON.stringify({runDir:e.runDir}));
    await e.boundary(false); await e.finish();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '', exited = false;
  child.stdout.on('data', value => { output += value; }); child.stderr.on('data', value => { error += value; });
  const closed = new Promise(resolve => child.once('close', (code) => { exited = true; resolve(code); }));
  try {
    await until(() => output.includes('\n') || exited); assert(!exited, error);
    const { runDir } = JSON.parse(output.trim()), state = await readJSON(path.join(runDir, 'state.json'));
    await delay(150); assert(!exited, 'Paused runner exited before receiving a resume/stop request');
    await atomicJSON(path.join(runDir, 'control.json'), { version: 1, id: randomUUID(), runId: state.id, controlToken: state.controlToken, action: 'stop' });
    assert.equal(await closed, 0, error);
  } finally { if (!exited) { child.kill('SIGTERM'); await closed; } }
});

test('changed decisions pause before the next write and require a current validated revision', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized/billing'), unit = path.join(candidate, 'a');
  await fs.mkdir(unit, { recursive: true }); await fs.writeFile(path.join(f.layout.analysis, 'PLAN.md'), 'approved initial context');
  const input = { contextContents: { 'PLAN.md': 'approved initial context' } }, client = fakeCodex();
  const e = await engineFor(f, client, { input, candidate, options: { allowWrites: true } });
  try {
    await fs.writeFile(path.join(f.layout.analysis, 'PLAN.md'), 'approved revised context');
    const work = e.task({ ...spec('writer'), role: 'uplift-migrator', write: true, workingDirectory: unit, prompt: `Migrate with ${CONTEXT_MARKER}` });
    await until(() => e.state.status === 'paused'); assert.equal(client.calls.length, 0);
    assert.deepEqual(e.state.gateChange.files, ['PLAN.md']);
    const rejected = await send(e, 'resume', { acceptDecisions: true, decisionRevision: 'old' });
    assert.match(rejected.error, /latest decision/); assert.equal(e.paused, true);
    await send(e, 'resume', { acceptDecisions: true, decisionRevision: e.state.gateChange.nextRevision });
    assert.equal((await work).ok, true); assert(client.calls[0].input.includes('approved revised context'));
    assert(!client.calls[0].input.includes('approved initial context')); assert.equal(e.state.tasks.writer.contextRevision, e.state.decisionRevision);
    await e.finish({});
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('a resume acknowledgement cannot bypass removed gate evidence', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized/billing'), unit = path.join(candidate, 'a');
  await fs.mkdir(unit, { recursive: true }); const quote = 'This is the explicitly approved phase';
  await fs.writeFile(path.join(f.layout.analysis, 'PLAN.md'), quote);
  const e = await engineFor(f, fakeCodex(), { candidate, input: { gates: { brief: { file: 'PLAN.md', quote } }, contextContents: { 'PLAN.md': quote } }, options: { allowWrites: true } });
  try {
    await fs.writeFile(path.join(f.layout.analysis, 'PLAN.md'), 'Gate removed');
    const work = e.task({ ...spec('write'), role: 'uplift-migrator', write: true, workingDirectory: unit });
    await until(() => e.state.status === 'paused');
    const control = await send(e, 'resume', { acceptDecisions: true, decisionRevision: e.state.gateChange.nextRevision });
    assert.match(control.error, /evidence changed/); assert.equal(e.paused, true);
    await send(e, 'stop'); assert.equal((await work).ok, false); await e.finish();
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('retry-failed reuses successful results and defers never-started tasks', async t => {
  const f = await fixture(t), first = await engineFor(f, fakeCodex(async c => c.input.includes('fail once') ? { error: 'transient' } : { result: { summary: 'ok' } }), { runId: 'retry' });
  const bad = { ...spec('bad'), prompt: 'fail once' };
  await first.task(spec('ok')); await first.task(bad); await first.finish({ incomplete: true });
  const client = fakeCodex(), e = await engineFor(f, client, { runId: 'retry', resume: true, options: { retryFailed: true } });
  try {
    assert.equal((await e.task(spec('ok'))).cached, true); assert.equal((await e.task(bad)).ok, true);
    assert.equal((await e.task(spec('future'))).deferred, true); assert.equal(client.calls.length, 1);
    assert.equal(e.state.tasks.future.attempts, 0); assert.equal((await e.finish({ incomplete: true })).status, 'partial');
  } finally { if (!e.closing) await e.finish(); }
});

test('runner heartbeat identifies its generation and records a real command start', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'ok' }, events: [{ type: 'item.started', item: { id: 'cmd', type: 'command_execution', status: 'in_progress', command: 'go test ./...' } }] })), e = await engineFor(f, client);
  const beat = await readJSON(path.join(e.runDir, 'heartbeat.json')); assert.equal(beat.generation, e.state.owner.generation);
  await e.task(spec('cmd')); const log = await fs.readFile(path.join(e.runDir, 'cmd.events.jsonl'), 'utf8');
  assert.match(log, /go test/); assert.match(log, /worker.started/); assert.match(log, /worker.completed/); await e.finish({});
});

test('paused time does not consume the active-time budget', async t => {
  const f = await fixture(t), e = await engineFor(f, fakeCodex(), { options: { runTimeoutMs: 1000 } });
  try {
    await send(e, 'pause'); const pausedAt = e.activeDuration(); await delay(90);
    assert(e.activeDuration() - pausedAt < 15); await send(e, 'resume'); await delay(25);
    assert(e.activeDuration() - pausedAt >= 20); await e.finish({});
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('review saves during a writer run but a disputed P0 blocks the next write', async t => {
  const f = await fixture(t), candidate = path.join(f.workspace, 'modernized/billing'), unit = path.join(candidate, 'a');
  await fs.mkdir(unit, { recursive: true });
  const rules = '### RULE-001: Preserve the approved limit\n**Category:** Validation\n**Priority:** P0\n**Source:** `main.go:1-2`\n**Plain English:** Reject values above the limit.\n**Specification:**\n  Given a limit\n  When the limit is exceeded\n  Then reject\n**Confidence:** Medium — SME question: Which limit applies?\n';
  await fs.writeFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), rules);
  const rule = parseRules(rules).rules[0], client = fakeCodex(), e = await engineFor(f, client, { candidate, options: { allowWrites: true } });
  try {
    await saveReview(f.workspace, 'billing', { id: rule.id, verdict: 'discuss', ruleRevision: cardRevision(rule), reviewRevision: entryRevision(null) });
    assert((await fs.readFile(path.join(f.layout.lockRoot, 'coordinator.lock'), 'utf8')).includes(String(process.pid)));
    const work = e.task({ ...spec('writer'), role: 'uplift-migrator', write: true, workingDirectory: unit, prompt: CONTEXT_MARKER });
    await until(() => e.state.status === 'paused');
    const rejected = await send(e, 'resume', { acceptDecisions: true, decisionRevision: e.state.gateChange.nextRevision });
    assert.match(rejected.error, /human confirmation/); assert.equal(client.calls.length, 0);
    const ledger = await readJSON(path.join(f.layout.analysis, 'RULE_REVIEWS.json'));
    const before = e.state.gateChange.nextRevision;
    await saveReview(f.workspace, 'billing', { id: rule.id, verdict: 'confirmed', ruleRevision: cardRevision(rule), reviewRevision: entryRevision(ledger.reviews[rule.id]) });
    e.lastDecisionCheck = 0; await e.checkCancellation(); await until(() => e.state.gateChange.nextRevision !== before);
    await send(e, 'resume', { acceptDecisions: true, decisionRevision: e.state.gateChange.nextRevision });
    assert.equal((await work).ok, true); assert(client.calls[0].input.includes('confirmed')); await e.finish({});
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('heartbeat distinguishes alive, stale, dead and unknown processes', async t => {
  const f = await demo(t), files = new WorkspaceFiles(f.root), folder = 'analysis/carddemo/.codex-sdk/runs/demo-run';
  const state = { status: 'running', owner: { pid: process.pid, host: os.hostname(), generation: 'new' } };
  await atomicJSON(path.join(f.root, folder, 'heartbeat.json'), { generation: 'new', at: new Date().toISOString() });
  assert.equal((await runHealth(files, folder, state)).state, 'alive');
  assert.equal((await runHealth(new WorkspaceFiles(f.root), folder, state, Date.now() + 20000)).state, 'stale');
  assert.equal((await runHealth(files, folder, { ...state, owner: { ...state.owner, generation: 'old' } })).state, 'unknown');
  assert.equal((await runHealth(files, folder, { ...state, owner: { ...state.owner, pid: 2147483647 } })).state, 'dead');
  assert.equal((await runHealth(files, folder, { status: 'completed' })).state, 'finished');
});

test('journal reads a tail of a log larger than 4 MiB and then only appended bytes', async t => {
  const f = await demo(t), file = 'analysis/carddemo/big.events.jsonl', absolute = path.join(f.root, file), tail = new JournalTail();
  const row = i => JSON.stringify({ at: '2026-10-15T12:00:00Z', task: 'a', type: 'item.completed', item: { type: 'command_execution', command: `step ${i} ${'x'.repeat(1000)}`, exit_code: 0 } }) + '\n';
  await fs.writeFile(absolute, Array.from({ length: 5000 }, (_, i) => row(i)).join(''));
  let events = await tail.read(new WorkspaceFiles(f.root), file); assert(events.at(-1).item.command.startsWith('step 4999')); assert(tail.stats.bytes <= 256 * 1024);
  const before = tail.stats.bytes; await fs.appendFile(absolute, row(5000)); events = await tail.read(new WorkspaceFiles(f.root), file);
  assert(events.at(-1).item.command.startsWith('step 5000')); assert(tail.stats.bytes - before < 2000);
  const reads = tail.stats.reads; await tail.read(new WorkspaceFiles(f.root), file); assert.equal(tail.stats.reads, reads);
});

test('journal preserves split UTF-8 and partial lines, tolerates malformed lines and resets on rotation', async t => {
  const f = await demo(t), rel = 'analysis/carddemo/events.jsonl', file = path.join(f.root, rel), tail = new JournalTail();
  const row = Buffer.from(JSON.stringify({ type: 'worker.failed', error: 'ошибка' }) + '\n'), split = row.indexOf(Buffer.from('ш')) + 1;
  await fs.writeFile(file, row.subarray(0, split)); assert.equal((await tail.read(new WorkspaceFiles(f.root), rel)).length, 0);
  await fs.appendFile(file, row.subarray(split)); let events = await tail.read(new WorkspaceFiles(f.root), rel); assert.equal(events[0].error, 'ошибка');
  await fs.appendFile(file, '{broken}\n' + JSON.stringify({ type: 'worker.completed' }) + '\n'); assert.equal((await tail.read(new WorkspaceFiles(f.root), rel)).length, 2);
  await fs.rename(file, file + '.old'); await fs.writeFile(file, JSON.stringify({ type: 'worker.started' }) + '\n');
  events = await tail.read(new WorkspaceFiles(f.root), rel); assert.equal(events.length, 1); assert.equal(events[0].type, 'worker.started');
});

test('journal never exposes hidden text and redacts recorded output', async t => {
  const f = await demo(t), rel = 'analysis/carddemo/events.jsonl';
  await fs.writeFile(path.join(f.root, rel), JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'hidden text', output: 'password=secret' } }) + '\n');
  const events = await new JournalTail().read(new WorkspaceFiles(f.root), rel);
  assert(!JSON.stringify(events).includes('hidden text')); assert(!JSON.stringify(events).includes('=secret'));
});

test('read cache invalidates replacement with the same size and preserved mtime', async t => {
  const f = await demo(t), rel = 'analysis/carddemo/cache.md', file = path.join(f.root, rel), cache = new ReadCache();
  await fs.writeFile(file, 'first'); const stamp = await fs.stat(file);
  assert.equal(await new WorkspaceFiles(f.root, cache).read(rel), 'first'); assert.equal(await new WorkspaceFiles(f.root, cache).read(rel), 'first'); assert(cache.hits > 0);
  await fs.writeFile(file + '.new', 'other'); await fs.utimes(file + '.new', stamp.atime, stamp.mtime); await fs.rename(file + '.new', file);
  assert.equal(await new WorkspaceFiles(f.root, cache).read(rel), 'other');
});

test('short UI locks reject concurrent writers and recover only a known dead owner', async t => {
  const f = await demo(t), files = new WorkspaceFiles(f.root), rel = 'analysis/carddemo/.test.lock';
  let release; const held = withFileLock(files, rel, () => new Promise(resolve => { release = resolve; }));
  await until(() => typeof release === 'function');
  await assert.rejects(withFileLock(new WorkspaceFiles(f.root), rel, () => {}), e => e.status === 409); release(); await held;
  await fs.writeFile(path.join(f.root, rel), JSON.stringify({ pid: 2147483647, host: os.hostname() }));
  assert.equal(await withFileLock(new WorkspaceFiles(f.root), rel, () => 'recovered'), 'recovered');
  await fs.writeFile(path.join(f.root, rel), 'unknown owner');
  await assert.rejects(withFileLock(new WorkspaceFiles(f.root), rel, () => {}), e => e.status === 409);
  assert.equal(await fs.readFile(path.join(f.root, rel), 'utf8'), 'unknown owner');
});

test('SSE parser handles every UTF-8 byte boundary, multiline JSON and CRLF', () => {
  const events = [], parser = new SSEParser(e => events.push(e));
  const bytes = Buffer.from(':comment\r\nid: rev-1\r\nevent: snapshot\r\ndata: {"word":\r\ndata: "привет"}\r\n\r\n');
  for (const byte of bytes) parser.push(Uint8Array.of(byte));
  assert.deepEqual(events, [{ type: 'snapshot', id: 'rev-1', data: { word: 'привет' } }]);
});
test('SSE parser bounds both a partial line and an accumulating event', () => {
  assert.throws(() => new SSEParser(() => {}, 20).push('x'.repeat(21)), /buffer/);
  const parser = new SSEParser(() => {}, 20); parser.push('data: 12345\n'); assert.throws(() => parser.push('data: 12345\n'), /buffer/);
});
test('patches must follow an exact snapshot revision', () => {
  const original = { revision: 'a', system: 'billing', percent: 0 };
  const next = applyUpdate(original, { type: 'patch', data: { base: 'a', revision: 'b', changes: { percent: 1 }, readAtMs: 123 } });
  assert.equal(next.percent, 1); assert.equal(original.percent, 0);
  assert.throws(() => applyUpdate(next, { type: 'patch', data: { base: 'a', revision: 'c', changes: {} } }), /revision gap/);
});

test('live client ignores an old snapshot response after the system changes', async () => {
  const pending = [], received = []; let query = 'system=one';
  const connection = new LiveConnection({ query: () => query, token: () => 'token', onModel: m => received.push(m), fetcher: () => new Promise(resolve => pending.push(resolve)) });
  const first = connection.refresh(); query = 'system=two'; connection.generation++; const second = connection.refresh();
  pending[1](new Response(JSON.stringify({ revision: 'two', system: 'two' }))); await second;
  pending[0](new Response(JSON.stringify({ revision: 'one', system: 'one' }))); await first;
  assert.deepEqual(received.map(m => m.system), ['two']); connection.stop();
});

test('live store reuses a snapshot and emits revisioned changes with replay and reset', async t => {
  const f = await demo(t), store = new LiveStore(f.root); t.after(() => store.close());
  const first = await store.get('carddemo'), revision = first.data.revision, builds = store.stats.builds;
  await store.get('carddemo'); assert.equal(store.stats.builds, builds);
  for (const rel of ['.DS_Store', 'analysis/carddemo/.DS_Store', 'legacy/carddemo/.DS_Store']) {
    await fs.writeFile(path.join(f.root, rel), 'Finder metadata'); store.invalidate(rel);
  }
  await store.get('carddemo'); assert.equal(store.stats.builds, builds);
  assert.equal(first.data.revision, revision);
  const received = [], unsubscribe = store.subscribe(first, revision, event => received.push(event));
  await fs.appendFile(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), '\nAdditional context.\n'); store.invalidate('analysis/carddemo/MODERNIZATION_BRIEF.md');
  await store.get('carddemo'); assert.equal(received[0].type, 'patch'); assert.equal(received[0].data.base, revision); assert(received[0].data.changes.briefRevision);
  const replay = []; store.subscribe(first, revision, e => replay.push(e))(); assert.equal(replay[0].id, received[0].id);
  const reset = []; store.subscribe(first, 'unknown-before-restart', e => reset.push(e))(); assert.equal(reset[0].type, 'snapshot'); unsubscribe();
});

test('default-system subscriptions and nested source changes invalidate cached discovery', async t => {
  const f = await demo(t), store = new LiveStore(f.root); t.after(() => store.close());
  const first = await store.get(undefined), before = first.data.briefRevision;
  await fs.appendFile(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), '\nNew decision.'); store.invalidate('analysis/carddemo/MODERNIZATION_BRIEF.md');
  assert.notEqual((await store.get(undefined)).data.briefRevision, before);
  const top = path.join(f.dir, 'topology.json'); await fs.unlink(top); store.invalidate('analysis/carddemo/topology.json');
  const initial = (await store.get('carddemo')).data.totals.loc;
  await fs.appendFile(path.join(f.root, 'legacy/carddemo/app/cbl/COACTUPC.cbl'), '\nNew source line\n'); store.invalidate('legacy/carddemo/app/cbl/COACTUPC.cbl');
  assert((await store.get('carddemo')).data.totals.loc > initial);
});

test('report freshness includes documents outside the progress model', async t => {
  const f = await demo(t), store = new LiveStore(f.root); t.after(() => store.close());
  const first = (await store.get('carddemo')).data.documents.report;
  await fs.writeFile(path.join(f.dir, 'ASSESSMENT.md'), 'New assessment section'); store.invalidate('analysis/carddemo/ASSESSMENT.md');
  assert.notEqual((await store.get('carddemo')).data.documents.report, first);
  const previousMap = (await store.get('carddemo')).data.documents.topology, file = path.join(f.dir, 'topology.json');
  const topology = await readJSON(file); topology.observations = ['A new observation that is not part of the flat progress projection'];
  await fs.writeFile(file, JSON.stringify(topology)); store.invalidate('analysis/carddemo/topology.json');
  assert.notEqual((await store.get('carddemo')).data.documents.topology, previousMap);
});

test('old-generation control markers do not appear pending after a resume', async t => {
  const f = await demo(t), folder = path.join(f.dir, '.codex-sdk/runs/demo-run');
  const state = await readJSON(path.join(folder, 'state.json')); state.status = 'running'; state.controlToken = 'current-generation';
  await atomicJSON(path.join(folder, 'state.json'), state);
  await atomicJSON(path.join(folder, 'control.json'), { id: 'old', controlToken: 'former-generation', action: 'pause' });
  const model = (await readModel(f.root, { system: 'carddemo' })).data;
  assert.equal(model.session.runs.find(r => r.id === 'demo-run').pendingControl, null);
});

test('slow SSE clients wait for drain and overflow is bounded', () => {
  class Response extends EventEmitter { chunks = []; write(chunk) { this.chunks.push(chunk); return this.chunks.length !== 1; } destroy() { this.destroyed = true; this.emit('close'); } }
  const response = new Response(), send = eventStream(response, { maxQueuedBytes: 100 });
  send({ type: 'heartbeat', data: 1 }); send({ type: 'heartbeat', data: 2 }); assert.equal(response.chunks.length, 1);
  response.emit('drain'); assert.equal(response.chunks.length, 2);
  const slow = new Response(), write = eventStream(slow, { maxQueuedBytes: 100 }); write({ type: 'heartbeat', data: 1 }); write({ type: 'snapshot', data: 'x'.repeat(120) }); assert.equal(slow.destroyed, true);
});

test('supervisor only starts saved fixed-argument resumes after explicit write consent', async t => {
  const f = await fixture(t), e = await engineFor(f, fakeCodex(), { runId: 'supervised' }); await e.finish({ incomplete: true });
  let spawned; const child = new EventEmitter(); child.stderr = new EventEmitter(); child.unref = () => {};
  const supervisor = new RunSupervisor(f.workspace, { spawnProcess: (...args) => { spawned = args; return child; } });
  const input = { runId: e.state.id, action: 'resume', runRevision: runRevision(e.state), confirm: true, confirmStopped: true };
  await assert.rejects(supervisor.request('billing', { ...input, confirm: false }), /Confirm/);
  await assert.rejects(supervisor.request('billing', { ...input, action: 'arbitrary-shell' }), /Unknown/);
  await assert.rejects(supervisor.request('billing', { ...input, runRevision: 'old' }), /generation changed/);
  assert.equal(spawned, undefined);
  await supervisor.request('billing', input); assert.equal(spawned[0], process.execPath); assert.equal(spawned[2].shell, false);
  assert.equal(spawned[2].env.CODEX_MODERNIZATION_WORKER, undefined); assert(spawned[1].includes('--confirm-stopped')); assert(!spawned[1].includes('--allow-writes'));
  child.emit('close', 0); await delay(10);
});

test('supervisor rejects a stale generation and preserves an unacknowledged control', async t => {
  const f = await fixture(t), e = await engineFor(f, fakeCodex());
  clearInterval(e.controlTimer); e.controlWatcher?.close();
  try {
    const supervisor = new RunSupervisor(f.workspace), input = { runId: e.state.id, action: 'pause', runRevision: runRevision(e.state) };
    await assert.rejects(supervisor.request('billing', { ...input, runRevision: 'stale' }), /generation/);
    await supervisor.request('billing', input);
    await assert.rejects(supervisor.request('billing', { ...input, action: 'resume' }), /awaiting acknowledgement/);
    await e.checkCancellation(); await until(() => e.paused);
    await supervisor.request('billing', { ...input, action: 'stop' }); await e.checkCancellation(); await until(() => e.abort.signal.aborted); await e.finish();
  } finally { if (!e.closing) { e.cancel(); await e.finish(); } }
});

test('live client reconnects to a restarted connection and receives later file changes', { timeout: 10000 }, async t => {
  const f = await demo(t), panel = await startPanel({ workspace: f.root, system: 'carddemo' }), received = [], states = [];
  const connection = new LiveConnection({ query: () => 'system=carddemo', token: () => panel.token, onModel: value => received.push(value), onState: state => states.push(state),
    fetcher: (url, options) => fetch(panel.origin + url, options) });
  try {
    connection.start(); await until(() => received.length > 0);
    panel.server.closeAllConnections(); await until(() => states.includes('reconnecting'));
    // The fallback snapshot can arrive before the event stream reconnects.
    await until(() => states.at(-1) === 'live'); const initial = received.at(-1).revision;
    await fs.appendFile(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), '\nAfter reconnect.');
    await until(() => received.at(-1).revision !== initial); assert(received.at(-1).briefText.includes('After reconnect.'));
    assert.equal(states.at(-1), 'live');
  } finally { connection.stop(); await panel.close(); }
});

test('HTTP event stream authenticates, pushes file changes, reconnects and closes cleanly', { timeout: 10000 }, async t => {
  const f = await demo(t), panel = await startPanel({ workspace: f.root, system: 'carddemo' });
  const abort = new AbortController();
  try {
    assert.equal((await fetch(panel.origin + '/api/events')).status, 401);
    const headers = { 'X-Modernization-Token': panel.token };
    assert.equal((await fetch(panel.origin + '/api/events', { headers: { ...headers, Origin: 'https://other.invalid' } })).status, 403);
    const response = await fetch(panel.origin + '/api/events?system=carddemo', { headers, signal: abort.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /text\/event-stream/);
    const events = [], parser = new SSEParser(e => events.push(e)), reader = response.body.getReader();
    while (!events.some(e => e.type === 'snapshot')) parser.push((await reader.read()).value);
    const initial = events.find(e => e.type === 'snapshot'), start = performance.now();
    await fs.appendFile(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), '\nLive HTTP update.');
    while (!events.some(e => e.type === 'patch')) parser.push((await reader.read()).value);
    assert(performance.now() - start < 2000); const patch = events.find(e => e.type === 'patch'); assert.equal(patch.data.base, initial.id);
    assert(!JSON.stringify(events).includes(panel.token)); abort.abort(); await reader.cancel().catch(() => {});
    const reconnect = new AbortController();
    const replay = await fetch(panel.origin + '/api/events?system=carddemo', { headers: { ...headers, 'Last-Event-ID': initial.id }, signal: reconnect.signal });
    const replayed = [], reparser = new SSEParser(e => replayed.push(e)), replayReader = replay.body.getReader(); while (!replayed.length) reparser.push((await replayReader.read()).value);
    assert.equal(replayed[0].type, 'patch'); assert.equal(replayed[0].id, patch.id); reconnect.abort(); await replayReader.cancel().catch(() => {});
    const model = await fetch(panel.origin + '/api/model?system=carddemo', { headers });
    assert.equal((await fetch(panel.origin + '/api/model?system=carddemo', { headers: { ...headers, 'If-None-Match': model.headers.get('etag') } })).status, 304);
  } finally { abort.abort(); await panel.close(); }
});

test('live cache evicts idle entries by recent use and rebuilds saved rules on return', async t => {
  const f = await demo(t), store = new LiveStore(f.root);
  try {
    const original = await store.get('carddemo'); assert(original.data.rules.length > 0);
    for (let i = 0; i < 15; i++) store.entry(`idle${i}`);
    assert.equal(store.entry('carddemo'), original);
    store.entry('next');
    assert.equal(store.entries.has('idle0:auto'), false);
    assert.equal(store.entries.get('carddemo:auto'), original);
    for (let i = 0; i < 32; i++) store.entry(`other${i}`);
    assert.equal(store.entries.size, 16);
    const rebuilt = await store.get('carddemo');
    assert.notEqual(rebuilt, original); assert.deepEqual(rebuilt.data.rules, original.data.rules);
  } finally { store.close(); }
});

test('live cache preserves every active stream and releases capacity on unsubscribe', async t => {
  const f = await fixture(t), store = new LiveStore(f.workspace), releases = [];
  try {
    for (let i = 0; i < 16; i++) {
      const entry = store.entry(`active${i}`); entry.data = { revision: `test-${i}` };
      releases.push(store.subscribe(entry, null, () => {}));
    }
    assert.throws(() => store.entry('overflow'), /Too many active/);
    releases[0](); store.entry('overflow'); assert.equal(store.entries.size, 16);
    for (let i = 1; i < 16; i++) assert.equal(store.entries.get(`active${i}:auto`).listeners.size, 1);
  } finally { for (const release of releases) release(); store.close(); }
});

test('a queued model read remains pinned while other idle systems rotate', async t => {
  const f = await demo(t), store = new LiveStore(f.root); let release;
  store.work = new Promise(resolve => { release = resolve; });
  const reading = store.get('carddemo');
  try {
    for (let i = 0; i < 32; i++) store.entry(`idle${i}`);
    assert(store.entries.has('carddemo:auto')); release();
    const entry = await reading; assert.equal(store.entries.get('carddemo:auto'), entry);
    const received = [], unsubscribe = store.subscribe(entry, null, event => received.push(event));
    assert.equal(received[0].data.system, 'carddemo'); unsubscribe();
  } finally { release(); await reading.catch(() => {}); store.close(); }
});

test('an evicted snapshot cannot create an orphaned SSE subscription', async t => {
  const f = await fixture(t), store = new LiveStore(f.workspace);
  try {
    const stale = store.entry('old'); stale.data = { revision: 'expired' };
    for (let i = 0; i < 16; i++) store.entry(`next${i}`);
    assert.throws(() => store.subscribe(stale, null, () => {}), /reconnect/);
    assert.equal(stale.listeners.size, 0);
  } finally { store.close(); }
});

test('panel recovery preserves explicit SDK and CLI paths without forwarding unrelated secrets', async t => {
  const keys = ['CODEX_PATH', 'CODEX_MODERNIZATION_SDK_DIR', 'DATABASE_PASSWORD'];
  const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; });
  process.env.CODEX_PATH = '/synthetic/custom-codex';
  process.env.CODEX_MODERNIZATION_SDK_DIR = '/synthetic/shared-sdk';
  process.env.DATABASE_PASSWORD = 'synthetic-not-forwarded';
  const f = await fixture(t), e = await engineFor(f, fakeCodex(), { runId: 'custom-sdk' });
  await e.finish({ incomplete: true });
  const child = new EventEmitter(); child.stderr = new EventEmitter(); child.unref = () => {};
  let options;
  const supervisor = new RunSupervisor(f.workspace, { spawnProcess: (_exe, _args, value) => { options = value; return child; } });
  await supervisor.request('billing', { runId: e.state.id, action: 'resume', runRevision: runRevision(e.state), confirm: true, confirmStopped: true });
  assert.equal(options.env.CODEX_PATH, '/synthetic/custom-codex');
  assert.equal(options.env.CODEX_MODERNIZATION_SDK_DIR, '/synthetic/shared-sdk');
  assert.equal(options.env.DATABASE_PASSWORD, undefined);
  assert.equal(options.env.CODEX_MODERNIZATION_WORKER, undefined);
  child.emit('close', 0);
});
