// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fixture, fakeCodex } from './helpers.mjs';
import { createDemo } from '../examples/ui-demo.mjs';
import { handleHook, sessionKey, modernizationInvocation, initializationCommand, toolResult, hostRequest } from '../runtime/host-hooks.mjs';
import { configure, initializeWorkspace, readUIConfig } from '../runtime/panel-config.mjs';
import { readModel, sourceView } from '../runtime/ui/model.mjs';
import { startPanel } from '../runtime/ui/server.mjs';
import { collectObservations, isTestCommand, testTotals, commandDirectory } from '../runtime/ui/observations.mjs';
import { Engine } from '../runtime/engine.mjs';
import { record, string } from '../runtime/schemas.mjs';

async function setup(t) {
  const f = await fixture(t), dataDir = path.join(f.root, 'plugin-data'), opened = [], starts = [], requests = [];
  const options = { dataDir, headless: false, worker: false, env: { CODEX_MODERNIZATION_INTERFACE: 'gui' },
    ensurePanel: async state => { starts.push(state); return { url: 'http://127.0.0.1:12345/#token=' + 'a'.repeat(64), session: state.key, pid: 1 }; },
    openBrowser: async url => { opened.push(url); }, request: async (panel, action) => { requests.push(action); return { ok: true }; } };
  const payload = (event, extra = {}) => ({ session_id: 'test-session', cwd: f.source, hook_event_name: event, ...extra });
  const invoke = () => handleHook(payload('UserPromptSubmit', { prompt: `$modernize-uplift billing --workspace "${f.workspace}" --source "${f.source}"` }), options);
  return { ...f, dataDir, opened, starts, requests, options, payload, invoke };
}
test('init creates a fresh analysis system and source reference before the panel reader runs', async t => {
  const f = await setup(t), workspace = path.join(f.root, 'fresh');
  const layout = await initializeWorkspace(workspace, 'new-system', f.source);
  assert.equal((await readModel(workspace, { system: 'new-system' })).data.system, 'new-system');
  assert.equal((await fs.readFile(path.join(layout.analysis, 'SOURCE'), 'utf8')).trim(), f.source);
});
test('invalid nested workspace is rejected before any directory is created in source, including a symlink alias', async t => {
  const f = await fixture(t), nested = path.join(f.source, 'must-not-create');
  await assert.rejects(initializeWorkspace(nested, 'billing', f.source), /separate/);
  await assert.rejects(fs.access(nested));
  const link = path.join(f.root, 'alias'); await fs.symlink(f.source, link);
  await assert.rejects(initializeWorkspace(path.join(link, 'must-not-create'), 'billing', f.source), /separate/); await assert.rejects(fs.access(nested));
});
test('invocation-level panel off is persisted before an automatic browser can open', async t => {
  const f = await setup(t);
  await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize billing --workspace ${f.workspace} --panel off --xray off` }), f.options);
  assert.equal(f.opened.length, 0); const config = await readUIConfig(f.workspace); assert.equal(config.panel, 'off'); assert.equal(config.xray, false);
});
test('hooks stay inactive for unrelated chats and SDK workers', async t => {
  const f = await setup(t);
  assert.deepEqual(await handleHook(f.payload('SessionStart'), f.options), {});
  await handleHook(f.payload('UserPromptSubmit', { prompt: '$modernize-uplift billing' }), { ...f.options, worker: true });
  assert.equal(f.starts.length, 0); assert.equal(f.opened.length, 0);
});
test('all packaged skills are recognized; explicit JSON helper never creates analysis or a window', async t => {
  const f = await setup(t);
  for (const entry of await fs.readdir(new URL('../skills/', import.meta.url), { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    await fs.access(new URL(`../skills/${entry.name}/SKILL.md`, import.meta.url));
    assert(modernizationInvocation(`$${entry.name} billing`), entry.name);
  }
  assert.equal(modernizationInvocation('Do not run $modernize billing'), null);
  const fresh = path.join(f.root, 'must-not-initialize');
  await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize-panel billing json --workspace ${fresh}` }), f.options);
  await assert.rejects(fs.access(fresh)); assert.equal(f.opened.length, 0);
});
test('explicit panel close suppresses reopening in the same chat until open is requested', async t => {
  const f = await setup(t); await f.invoke();
  await handleHook(f.payload('UserPromptSubmit', { prompt: '$modernize-panel billing close' }), f.options);
  const starts = f.starts.length;
  const closed = await f.invoke(); assert.equal(f.starts.length, starts); assert.match(closed.hookSpecificOutput.additionalContext, /human closed/i);
  await handleHook(f.payload('UserPromptSubmit', { prompt: '$modernize-panel billing open' }), f.options); assert.equal(f.starts.length, starts + 1);
});
test('first invocation starts a panel only after source registration and reuses it without reopening', async t => {
  const f = await setup(t), output = await f.invoke();
  assert.match(output.hookSpecificOutput.additionalContext, /panel is running/);
  assert.equal((await readModel(f.workspace, { system: 'billing' })).data.system, 'billing');
  assert.equal(f.opened.length, 1);
  await handleHook(f.payload('UserPromptSubmit', { prompt: '$modernize-uplift billing' }), f.options);
  assert.equal(f.opened.length, 1); assert.equal(f.starts.at(-1).workspace, f.workspace);
  await handleHook(f.payload('SessionEnd'), f.options); assert(f.requests.includes('close'));
});
test('a later session resumes its registered workspace and starts its own lifecycle panel', async t => {
  const f = await setup(t); await f.invoke();
  await handleHook(f.payload('SessionStart', { session_id: 'another-session', source: 'resume' }), f.options);
  assert.equal(f.starts.length, 2); assert.equal(f.starts[1].workspace, f.workspace); assert.notEqual(f.starts[0].key, f.starts[1].key);
});
for (const panel of ['command', 'off']) test(`persistent panel=${panel} suppresses automatic opening`, async t => {
  const f = await setup(t); await configure({ workspace: f.workspace, panel }); await f.invoke();
  assert.equal(f.starts.length, 0); assert.equal((await readUIConfig(f.workspace)).panel, panel);
});
test('headless invocation registers context without spawning or opening a browser', async t => {
  const f = await setup(t);
  await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize billing --workspace ${f.workspace}` }), { ...f.options, headless: true });
  assert.equal(f.opened.length, 0); assert.equal(f.starts.length, 0);
});
for (const env of [{}, { TERM: 'xterm-256color', CODEX_INTERNAL_ORIGINATOR_OVERRIDE: 'Codex Desktop' },
  { SSH_CONNECTION: 'synthetic', CODEX_MODERNIZATION_INTERFACE: 'gui' }]) {
  test(`terminal hooks keep explicit panel commands in the terminal: ${JSON.stringify(env)}`, async t => {
    const f = await setup(t);
    const output = await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize-panel billing open --workspace ${f.workspace}` }), { ...f.options, env });
    assert.equal(f.starts.length, 0); assert.equal(f.opened.length, 0);
    assert.match(output.hookSpecificOutput.additionalContext, /terminal/i);
    assert.match(output.hookSpecificOutput.additionalContext, /billing/);
    assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /http:\/\//);
    const resumed = await handleHook(f.payload('SessionStart', { session_id: 'terminal-resume', source: 'resume' }), { ...f.options, env });
    assert.match(resumed.hookSpecificOutput.additionalContext, /terminal/i);
    assert.equal(f.starts.length, 0); assert.equal(f.opened.length, 0);
  });
}
test('successful official init tool command registers the coordinator and opens its selected workspace', async t => {
  const f = await setup(t), script = path.resolve('scripts/modernize.mjs');
  const command = `node "${script}" init --workspace "${f.workspace}" --system billing --source "${f.source}"`;
  assert.equal(initializationCommand(command).workspace, f.workspace);
  assert.equal(initializationCommand(command + ' && echo forged'), null);
  await handleHook(f.payload('PostToolUse', { tool_name: 'Bash', tool_input: { command }, tool_response: { output: '{}', exit_code: 0 } }), f.options);
  assert.equal(f.opened.length, 1);
});
test('a panel startup error is surfaced and does not deny a modernization prompt', async t => {
  const f = await setup(t);
  const output = await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize billing --workspace ${f.workspace}` }), { ...f.options, ensurePanel: async () => { throw new Error('listen denied'); } });
  assert.match(output.systemMessage, /listen denied/); assert.equal(output.continue, undefined);
});
test('parent test commands are observed, redacted, and rendered without requiring an XML report', async t => {
  const f = await setup(t); await f.invoke();
  const dir = path.join(f.workspace, 'modernized/billing/core'); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'go.mod'), 'module example');
  await handleHook(f.payload('PostToolUse', { tool_name: 'Bash', tool_use_id: 'test-1', tool_input: { command: 'python -m pytest', workdir: dir }, tool_response: { output: '=== 12 passed, 1 skipped in 0.12s ===\n"api_key": "sk-never-print-this-credential"', exit_code: 0 } }), f.options);
  const model = (await readModel(f.workspace, { system: 'billing', track: 'transform' })).data;
  assert.equal(model.modules.find(m => m.dir === 'core').tests.tests, 13);
  assert.equal(model.modules.find(m => m.dir === 'core').tests.skipped, 1);
  assert(!JSON.stringify(model.session).includes('sk-never-print')); assert.equal(model.session.agents.at(-1).role, 'coordinator');
});
test('parent X-ray attaches source-linked rules to reads and honors its persistent off switch', async t => {
  const f = await setup(t); await f.invoke();
  await fs.writeFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), '### RULE-001: Settlement\n**Priority:** P0\n**Source:** `main.go:1-2`\n**Plain English:** A settlement decision.\n');
  const payload = f.payload('PostToolUse', { tool_name: 'Bash', tool_input: { command: `cat "${path.join(f.source, 'main.go')}"` }, tool_response: { output: 'package main', exit_code: 0 } });
  const output = await handleHook(payload, f.options); assert.match(output.hookSpecificOutput.additionalContext, /RULE-001/);
  const metadata = path.join(f.source, '.DS_Store'); await fs.writeFile(metadata, 'Finder metadata');
  assert.equal((await handleHook(f.payload('PostToolUse', { tool_name: 'Read', tool_input: { file_path: metadata }, tool_response: { content: 'Finder metadata' } }), f.options)).hookSpecificOutput, undefined);
  assert(!(JSON.stringify((await readModel(f.workspace, { system: 'billing' })).data.session)).includes('.DS_Store'));
  await configure({ workspace: f.workspace, xray: 'off' });
  assert.equal((await handleHook(payload, f.options)).hookSpecificOutput, undefined);
  assert.equal((await sourceView(f.workspace, 'billing', 'main.go')).xray, null);
});
test('SDK worker hooks add X-ray and read touches without opening panels, changing gates or duplicating commands', async t => {
  const f = await setup(t); await initializeWorkspace(f.workspace, 'billing', f.source);
  await fs.writeFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), '### RULE-001: Settlement\n**Priority:** P0\n**Source:** `main.go:1-2`\n');
  const payload = f.payload('PostToolUse', { session_id: 'sdk-test-worker', tool_name: 'Bash', tool_input: { command: `cat "${path.join(f.source, 'main.go')}"` }, tool_response: { output: 'package main', exit_code: 0 } });
  const output = await handleHook(payload, { ...f.options, worker: true, workerContext: { workspace: f.workspace, source: f.source, system: 'billing' } });
  assert.match(output.hookSpecificOutput.additionalContext, /RULE-001/); assert.equal(f.opened.length, 0); assert.equal(f.starts.length, 0);
  const model = (await readModel(f.workspace, { system: 'billing' })).data;
  assert(model.session.timeline.some(e => e.role === 'SDK worker read')); assert(!model.session.agents.some(a => a.role === 'coordinator'));
  assert(!model.session.timeline.some(e => e.summary.includes('cat ')));
  const metadata = path.join(f.source, '.DS_Store'); await fs.writeFile(metadata, 'Finder metadata');
  const ignored = await handleHook(f.payload('PostToolUse', { session_id: 'sdk-test-worker', tool_name: 'Read', tool_input: { file_path: metadata }, tool_response: { content: 'Finder metadata' } }),
    { ...f.options, worker: true, workerContext: { workspace: f.workspace, source: f.source, system: 'billing' } });
  assert.deepEqual(ignored, {});
  assert(!(JSON.stringify((await readModel(f.workspace, { system: 'billing' })).data.session)).includes('.DS_Store'));
});
test('queued next step is delivered once; pause denies the next tool and stops at Stop', async t => {
  const f = await setup(t); await f.invoke();
  const requestFile = path.join(f.layout.analysis, '.codex-host/requests', sessionKey('test-session') + '.json');
  await fs.writeFile(requestFile, JSON.stringify({ action: 'next', command: '$modernize-assess billing' }));
  const next = await handleHook(f.payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } }), f.options);
  assert.match(next.hookSpecificOutput.additionalContext, /modernize-assess/); assert.equal(JSON.parse(await fs.readFile(requestFile)), null);
  await fs.writeFile(requestFile, JSON.stringify({ action: 'pause' }));
  const pause = await handleHook(f.payload('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'pwd' } }), f.options);
  assert.equal(pause.hookSpecificOutput.permissionDecision, 'deny'); assert.equal(pause.continue, undefined);
  assert.equal((await handleHook(f.payload('Stop'), f.options)).continue, false);
});
test('parallel hooks serialize lifecycle state without duplicating browser opening', async t => {
  const f = await setup(t); await Promise.all([f.invoke(), f.invoke(), f.invoke()]);
  assert.equal(f.opened.length, 1); assert.equal(f.starts.length, 3);
});
test('SDK events persist test totals without retaining raw command output', async t => {
  const f = await fixture(t), client = fakeCodex(async () => ({ result: { summary: 'fixture' }, commands: [{ command: 'pytest', exit_code: 0, aggregated_output: '=== 4 passed, 2 skipped in 0.1s ===' }] }));
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  try {
    await engine.task({ id: 'tests', role: 'legacy-analyst', prompt: 'Fixture event', schema: record({ summary: string }) });
    const lines = (await fs.readFile(path.join(engine.runDir, 'tests.events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    const command = lines.find(e => e.type === 'item.completed' && e.item?.type === 'command_execution').item;
    assert.equal(command.testTotals.tests, 6); assert.equal(command.output, undefined);
  } finally { await engine.finish({}); }
});
test('recovered SDK command errors still produce adaptive Fleet warnings', async t => {
  const f = await fixture(t); await initializeWorkspace(f.workspace, 'billing', f.source);
  const client = fakeCodex(async () => ({ result: { summary: 'Recovered' }, commands: [{ command: 'fixture-probe', exit_code: 1, aggregated_output: 'Error: No such file or directory: /fixture/missing' }] }));
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  try {
    await engine.parallel(['a', 'b', 'c'].map(id => ({ id, role: 'legacy-analyst', prompt: 'Fixture only', schema: record({ summary: string }) })));
  } finally { await engine.finish({}); }
  const session = (await readModel(f.workspace, { system: 'billing' })).data.session;
  assert(session.agents.every(a => a.error === '')); assert.equal(session.failures.length, 1); assert.equal(session.failures[0].agents.length, 3);
  assert.equal(session.failureAnnouncementThreshold, 3); assert.equal(session.failures[0].announcedAt, 3);
});
test('runner recognition and command cwd attribution cannot turn a mention or ambiguous run green', () => {
  assert(!isTestCommand('cat pytest.ini')); assert(isTestCommand('cd core && env A=1 node --test tests/*.test.mjs'));
  const event = { type: 'item.completed', at: new Date().toISOString(), workingDirectory: '/workspace/modernized/s/core', item: { type: 'command_execution', command: 'pytest', exit_code: 1, output: '=== 12 passed in 1.0s ===' } };
  assert.equal(collectObservations([event], '/workspace').size, 0);
  assert.equal(testTotals('node --test x', 'TAP version 13\nok 1 - partial\n'), null);
  assert.equal(commandDirectory('cd a && cd b && pytest', '/workspace'), null);
  assert.equal(commandDirectory('(cd a; pytest)', '/workspace'), null);
  assert.deepEqual(toolResult('Process exited with code 2\npermission denied'), { output: 'Process exited with code 2\npermission denied', exitCode: 2 });
});
test('lifecycle HTTP requires its private capability and fixed owning session', async t => {
  const f = await fixture(t); await initializeWorkspace(f.workspace, 'billing', f.source); let beats = 0, closes = 0;
  const panel = await startPanel({ workspace: f.workspace, system: 'billing', hostSession: { id: 'owner', heartbeat: () => beats++, close: () => closes++ } });
  t.after(() => panel.close());
  await hostRequest({ url: panel.url, session: 'owner' }, 'heartbeat'); assert.equal(beats, 1);
  await assert.rejects(hostRequest({ url: panel.url, session: 'stranger' }, 'close')); assert.equal(closes, 0);
  await hostRequest({ url: panel.url, session: 'owner' }, 'close'); assert.equal(closes, 1);
});
test('real managed sidecar starts once, reuses its receipt and closes at session end', { timeout: 15000 }, async t => {
  const f = await setup(t), options = { dataDir: f.dataDir, openBrowser: async () => {}, headless: false, worker: false, env: { CODEX_MODERNIZATION_INTERFACE: 'gui' } };
  try {
    await handleHook(f.payload('UserPromptSubmit', { prompt: `$modernize billing --workspace ${f.workspace}` }), options);
    const file = path.join(f.dataDir, 'modernization-sessions', sessionKey('test-session') + '.json'), first = JSON.parse(await fs.readFile(file));
    assert(first.panel?.pid); await hostRequest(first.panel, 'heartbeat');
    await handleHook(f.payload('SessionStart', { source: 'compact' }), options);
    const second = JSON.parse(await fs.readFile(file)); assert.equal(first.panel.pid, second.panel.pid);
    await handleHook(f.payload('SessionEnd'), options);
    for (let i = 0; i < 100; i++) {
      try { await hostRequest(first.panel, 'heartbeat'); await new Promise(r => setTimeout(r, 20)); } catch { return; }
    }
    assert.fail('Owned panel was not closed');
  } finally { await handleHook(f.payload('SessionEnd'), options).catch(() => {}); }
});
