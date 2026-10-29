import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../scripts/modernize.mjs';
import { fixture } from './helpers.mjs';
import { initializeWorkspace } from '../runtime/panel-config.mjs';
const exec = promisify(execFile), cli = fileURLToPath(new URL('../scripts/modernize.mjs', import.meta.url));
test('CLI preserves arguments with spaces without shell interpolation', () => {
  const result = parseArgs(['run', '--workspace', '/path with spaces', '--allow-writes']);
  assert.equal(result.args.workspace, '/path with spaces'); assert.equal(result.args['allow-writes'], true);
});
for (const args of [['unknown'], ['run', '--mystery'], ['run', '--workspace'], ['run', '--workspace', '/a', '--workspace', '/b'], ['run', 'x']]) {
  test(`CLI rejects ambiguous/unknown arguments ${args.join(' ')}`, () => assert.throws(() => parseArgs(args)));
}
test('help works without installing SDK or authenticating', async () => {
  const { stdout } = await exec(process.execPath, [cli, 'help']); assert.match(stdout, /extract-rules/); assert.match(stdout, /resume/);
});
test('status of new workspace makes no model call', async t => {
  const f = await fixture(t); const { stdout } = await exec(process.execPath, [cli, 'status', '--workspace', f.workspace, '--system', 'billing']);
  assert.deepEqual(JSON.parse(stdout), []);
});
test('live smoke script refuses an accidental model call', async () => {
  const script = fileURLToPath(new URL('../scripts/smoke-sdk.mjs', import.meta.url));
  await assert.rejects(exec(process.execPath, [script]), e => /confirm-live/.test(e.stderr));
});
for (const remote of [false, true]) test(`panel CLI prints status and exits without a server (${remote ? 'SSH' : 'local terminal'})`, async t => {
  const f = await fixture(t); await initializeWorkspace(f.workspace, 'billing', f.source);
  const { stdout } = await exec(process.execPath, [cli, 'panel', '--workspace', f.workspace, '--system', 'billing'], {
    timeout: 10000, env: { ...process.env, TERM: 'xterm-256color',
      CODEX_MODERNIZATION_INTERFACE: remote ? 'gui' : 'terminal', ...(remote ? { SSH_CONNECTION: 'synthetic' } : {}) },
  });
  assert.match(stdout, /billing/); assert.match(stdout, /Stage|Этап/);
  assert.doesNotMatch(stdout, /http:\/\/|foreground|Ctrl\+C/);
});
