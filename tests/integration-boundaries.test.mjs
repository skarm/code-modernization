// Local integration tests use a deliberate SDK MODULE DOUBLE, never a live model.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Engine, resolveLayout } from '../runtime/engine.mjs';
import { loadSdk, createCodex, childEnvironment } from '../runtime/sdk.mjs';
import { prepareWorkflow } from '../runtime/workflows.mjs';
import { fixture, fakeCodex } from './helpers.mjs';
import { record, string } from '../runtime/schemas.mjs';
const schema = record({ summary: string });
const exec = promisify(execFile);
function env(t, values) {
  for (const [key, value] of Object.entries(values)) {
    const old = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
}
async function moduleDouble(t, meta = {}) {
  const f = await fixture(t), dir = path.join(f.root, 'sdk-home');
  const mod = path.join(dir, 'node_modules/@openai/codex-sdk'); await fs.mkdir(mod, { recursive: true });
  await fs.writeFile(path.join(mod, 'package.json'), JSON.stringify({ name: '@openai/codex-sdk', version: '0.162.1', type: 'module', exports: { '.': { import: './index.mjs' } }, ...meta }));
  await fs.writeFile(path.join(mod, 'index.mjs'), 'export class Codex { constructor(options) { this.testDouble = true; this.options = options; } }');
  env(t, { CODEX_MODERNIZATION_SDK_DIR: dir });
  return { ...f, dir };
}
test('shared SDK module resolution uses explicit npm directory (test double)', async t => {
  const f = await moduleDouble(t), loaded = await loadSdk();
  assert.equal(loaded.source, 'shared-sdk-directory'); assert.equal(loaded.version, '0.162.1');
  assert.equal(new loaded.module.Codex({}).testDouble, true); assert(loaded.location.includes('sdk-home'));
});
test('shared SDK rejects a wrong package identity', async t => {
  await moduleDouble(t, { name: 'not-the-official-sdk' }); await assert.rejects(loadSdk(), /Unexpected package/);
});
test('shared SDK rejects a version that differs from the pinned public API', async t => {
  await moduleDouble(t, { version: '0.0.0-incompatible-test-double' });
  await assert.rejects(loadSdk(), /Expected @openai\/codex-sdk 0.162.1/);
});
test('shared SDK rejects an escaping export', async t => {
  await moduleDouble(t, { exports: { '.': { import: './../other.mjs' } } });
  await assert.rejects(loadSdk(), /relative|traversal|path/i);
});
test('SDK construction passes constraints to official API shape (test double)', async t => {
  const f = await moduleDouble(t), bin = path.join(f.root, 'codex');
  await fs.writeFile(bin, '#!/bin/sh\nexit 123\n', { mode: 0o755 });
  const client = await createCodex({ codexPath: bin });
  assert.equal(client.options.codexPathOverride, bin); assert.equal(client.options.config.features.multi_agent, false);
  assert.deepEqual(client.options.config.sandbox_workspace_write, { writable_roots: [], exclude_tmpdir_env_var: true, exclude_slash_tmp: true });
  assert.equal(client.options.env.CODEX_MODERNIZATION_WORKER, '1');
});
test('default SDK construction leaves CLI resolution to the pinned package', async t => {
  await moduleDouble(t); env(t, { CODEX_PATH: undefined });
  assert.equal(Object.hasOwn((await createCodex()).options, 'codexPathOverride'), false);
});
test('recursion guard stops workers before SDK load', async t => {
  const f = await fixture(t), cli = fileURLToPath(new URL('../scripts/modernize.mjs', import.meta.url));
  await assert.rejects(exec(process.execPath, [cli, 'run', '--workspace', f.workspace, '--system', 'billing'],
    { env: { ...process.env, CODEX_MODERNIZATION_WORKER: '1' } }), error => /cannot recursively/.test(error.stderr));
});
test('one workspace lock excludes a second system coordinator', async t => {
  const f = await fixture(t), client = fakeCodex();
  const first = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  try {
    const other = await resolveLayout(f.workspace, 'orders', f.source);
    await assert.rejects(Engine.open({ layout: other, workflow: 'role-task', input: {}, factory: () => client }), /Another run/);
  } finally { await first.finish({}); }
});
test('source physically nested inside workspace is rejected', async t => {
  const f = await fixture(t), inside = path.join(f.workspace, 'source'); await fs.mkdir(inside);
  await assert.rejects(resolveLayout(f.workspace, 'inside', inside), /separate, non-nested/);
});
test('parallel overlapping write scopes start no SDK workers', async t => {
  const f = await fixture(t), client = fakeCodex(), candidate = path.join(f.workspace, 'modernized/billing');
  const scope = path.join(candidate, 'unit'); await fs.mkdir(scope, { recursive: true });
  const engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, candidate,
    options: { allowWrites: true }, factory: () => client });
  const spec = { role: 'test-engineer', workingDirectory: scope, write: true, prompt: 'Create tests', schema };
  try { await assert.rejects(engine.parallel([{ ...spec, id: 'a' }, { ...spec, id: 'b' }]), /overlap/); assert.equal(client.calls.length, 0); }
  finally { await engine.finish({}); }
});
test('role-task normalization remains replayable for relative read scope', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.source, 'unit'));
  const first = await prepareWorkflow('role-task', { role: 'legacy-analyst', scope: 'unit', task: 'Inspect only' }, f.layout);
  assert.equal(first.input.scope, 'unit');
  assert.deepEqual(await prepareWorkflow('role-task', first.input, f.layout), first);
});
test('analysis images are structured SDK inputs and their bytes invalidate task cache', async t => {
  const f = await fixture(t), image = path.join(f.layout.analysis, 'diagram.png');
  await fs.writeFile(image, 'synthetic image bytes; fake SDK does not interpret them');
  const client = fakeCodex(), engine = await Engine.open({ layout: f.layout, workflow: 'role-task', input: {}, factory: () => client });
  const spec = { id: 'with-image', role: 'architecture-critic', prompt: 'Review supplied diagram', schema, images: [image] };
  try {
    assert.equal((await engine.task(spec)).ok, true); assert.equal(client.calls[0].input[1].type, 'local_image');
    await fs.appendFile(image, ' changed'); await assert.rejects(engine.task(spec), /changed within/);
  } finally { await engine.finish({}); }
});
test('official custom CA path is preserved without inheriting project secrets', () => {
  const child = childEnvironment({ CODEX_CA_CERTIFICATE: '/trusted/ca.pem', SECRET: 'not forwarded' });
  assert.equal(child.CODEX_CA_CERTIFICATE, '/trusted/ca.pem'); assert(!('SECRET' in child));
});
