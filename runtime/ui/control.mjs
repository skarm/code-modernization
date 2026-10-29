// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceFiles, atomicText, uiRedact } from './files.mjs';
import { processAlive } from './health.mjs';
import { PLUGIN_ROOT } from '../engine.mjs';
import { childEnvironment } from '../sdk.mjs';
import { hash, invariant, name } from '../util.mjs';
import { isObject } from '../proof-io.mjs';
import { withFileLock } from './lock.mjs';

export const runRevision = state => hash({ id: state.id, fingerprint: state.fingerprint, generation: state.owner?.generation, finishedAt: state.finishedAt });
const LIVE = new Set(['running', 'pausing', 'paused', 'stopping']);

/** No arbitrary command endpoint: only saved, fingerprint-checked CLI resume requests. */
export class RunSupervisor {
  constructor(workspace, { spawnProcess = spawn, onChange = () => {} } = {}) {
    this.workspace = workspace; this.spawnProcess = spawnProcess; this.onChange = onChange; this.children = new Map();
  }
  async request(system, input) {
    name(system); invariant(isObject(input), 'Expected a run control request'); name(input.runId, 'run-id');
    const files = new WorkspaceFiles(this.workspace);
    return withFileLock(files, `analysis/${system}/.codex-sdk/runs/${input.runId}/.control.lock`, () => this.apply(system, input));
  }
  async apply(system, input) {
    name(system); invariant(isObject(input), 'Expected a run control request'); name(input.runId, 'run-id');
    invariant(['pause', 'resume', 'stop', 'retry-failed'].includes(input.action), 'Unknown control action');
    invariant(Object.keys(input).every(k => ['runId', 'action', 'runRevision', 'confirm', 'confirmStopped', 'allowWrites', 'acceptDecisions', 'decisionRevision'].includes(k)), 'Unknown control field');
    const files = new WorkspaceFiles(this.workspace), rel = `analysis/${system}/.codex-sdk/runs/${input.runId}`;
    const state = await files.json(`${rel}/state.json`);
    invariant(state && state.id === input.runId, 'Run is missing or invalid');
    invariant(!input.runRevision || input.runRevision === runRevision(state), 'Run generation changed; reload before controlling it');
    if (LIVE.has(state.status) && processAlive(state.owner) !== false) {
      invariant(input.action !== 'retry-failed', 'Stop the current run before retrying failed tasks');
      invariant(state.supportsControl === true || input.action === 'stop' && state.supportsCancellation === true, 'This run does not support cooperative control');
      invariant(processAlive(state.owner) !== false, 'Runner is no longer alive. Recover and resume the saved run instead.');
      const id = randomUUID(), request = { version: 1, id, runId: input.runId, action: input.action, controlToken: state.controlToken, requestedAt: new Date().toISOString(),
        ...(input.acceptDecisions === true ? { acceptDecisions: true, decisionRevision: input.decisionRevision } : {}) };
      // Only one unacknowledged control is allowed; stop may supersede it.
      const prior = await files.json(`${rel}/control.json`);
      invariant(!prior || prior.id === state.control?.acknowledged || prior.controlToken !== state.controlToken || input.action === 'stop', 'A control request is still awaiting acknowledgement');
      atomicText(files, `${rel}/${state.supportsControl ? 'control' : 'cancel'}.json`, JSON.stringify(request) + '\n');
      this.onChange(`${rel}/control.json`);
      return { requested: true, runId: input.runId, id, action: input.action };
    }
    invariant(['resume', 'retry-failed'].includes(input.action) && state.status !== 'completed', 'This run has no unfinished queue to resume');
    invariant(state.simulation !== true, 'This is a synthetic runner. Restart its demonstration script instead of starting an SDK model.');
    invariant(state.supportsControl === true, 'This saved run predates panel resume support; use the CLI');
    invariant(input.confirm === true && input.confirmStopped === true, 'Confirm the saved request and that all former workers have stopped');
    invariant(input.runRevision === runRevision(state), 'Run generation changed; reopen the resume dialog');
    invariant(!state.options?.allowWrites || input.allowWrites === true, 'Review partial candidate changes and explicitly authorize writes again');
    if (input.action === 'retry-failed') invariant(Object.values(state.tasks ?? {}).some(t => ['failed', 'interrupted'].includes(t.status)), 'There are no failed or interrupted tasks');
    invariant(!this.children.has(system), 'A resumed runner is already being started for this system');
    const coordinator = await files.json('analysis/.codex-sdk/coordinator.lock');
    invariant(!coordinator || processAlive(coordinator) === false, 'Workspace coordinator is alive or its ownership cannot be verified');
    const saved = await files.json(`${rel}/request.json`);
    invariant(saved?.workflow === state.workflow && isObject(saved.input), 'Saved workflow request is invalid');
    const args = [path.join(PLUGIN_ROOT, 'scripts/modernize.mjs'), 'resume', '--workspace', files.root, '--system', system, '--run-id', input.runId, '--confirm-stopped'];
    if (state.options?.allowWrites) args.push('--allow-writes');
    if (input.action === 'retry-failed') args.push('--retry-failed');
    const env = childEnvironment(); delete env.CODEX_MODERNIZATION_WORKER;
    // This child is a coordinator, so it needs the same explicitly configured
    // SDK/CLI locations. Ordinary SDK worker environments stay restricted.
    for (const key of ['CODEX_PATH', 'CODEX_MODERNIZATION_SDK_DIR'])
      if (process.env[key] !== undefined) env[key] = process.env[key];
    let stderr = '', child;
    const startedAt = new Date().toISOString(), launchId = randomUUID();
    const write = value => { atomicText(new WorkspaceFiles(this.workspace), `${rel}/launch.json`, JSON.stringify({ version: 1, launchId, action: input.action, startedAt, ...value }) + '\n'); this.onChange(`${rel}/launch.json`); };
    write({ status: 'starting' });
    try { child = this.spawnProcess(process.execPath, args, { cwd: PLUGIN_ROOT, env, shell: false, stdio: ['ignore', 'ignore', 'pipe'] }); }
    catch (error) { write({ status: 'failed', error: uiRedact(String(error.message)) }); throw error; }
    this.children.set(system, child);
    child.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-8000); });
    child.once('spawn', () => write({ status: 'started', pid: child.pid }));
    child.once('error', error => { this.children.delete(system); write({ status: 'failed', error: uiRedact(String(error.message)) }); });
    child.once('close', (code, signal) => {
      this.children.delete(system);
      try { write({ status: code === 0 ? 'finished' : 'failed', pid: child.pid, exitCode: code, signal, finishedAt: new Date().toISOString(), ...(code === 0 ? {} : { error: uiRedact(stderr.slice(-3000)) }) }); } catch { /* Workspace may have been closed/removed. */ }
    });
    // Closing a browser page does not stop work. The foreground terminal's signals
    // still reach the CLI; the runner owns its lock and cooperative stop marker.
    child.unref?.(); child.stderr?.unref?.();
    return { requested: true, runId: input.runId, action: input.action, launchId };
  }
}
