#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Lifecycle-owned sidecar. A private instance receipt, session end and idle lease bound its lifetime.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJSON, invariant, readJSON } from '../runtime/util.mjs';
import { startPanel } from '../runtime/ui/server.mjs';
import { readModel } from '../runtime/ui/model.mjs';
const [stateFile, instanceFile] = process.argv.slice(2);
let panel, timer, stopping = false;
async function stop() {
  if (stopping) return; stopping = true; clearInterval(timer);
  await panel?.close(); await fs.rm(instanceFile, { force: true });
}
try {
  invariant(path.isAbsolute(stateFile) && path.dirname(stateFile) === path.dirname(instanceFile), 'Invalid sidecar receipt paths');
  const state = await readJSON(stateFile, 256 * 1024);
  invariant(/^[a-f0-9]{32}$/.test(state.key) && path.basename(stateFile) === `${state.key}.json` && path.basename(instanceFile) === `${state.key}.panel.json`, 'Invalid sidecar session identity');
  // Do not start after the invoking hook timed out or was interrupted.
  invariant(Date.now() - Date.parse(state.at) < 10000, 'Panel startup request has expired');
  let lastSeen = Date.now();
  panel = await startPanel({ workspace: state.workspace, system: state.system,
    hostSession: { id: state.key, heartbeat: () => { lastSeen = Date.now(); }, close: () => { setTimeout(() => stop().catch(() => {}), 20); } } });
  await atomicJSON(instanceFile, { session: state.key, pid: process.pid, url: panel.url, startedAt: new Date().toISOString() });
  let checking = false;
  timer = setInterval(async () => {
    if (checking || Date.now() - lastSeen <= 30 * 60 * 1000) return; checking = true;
    try {
      const { data } = await readModel(state.workspace, { system: state.system });
      if (data.session?.active > 0) lastSeen = Date.now(); else await stop();
    } catch { await stop(); } finally { checking = false; }
  }, 10000);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop().catch(() => {}));
} catch (error) { if (instanceFile) await atomicJSON(instanceFile, { error: String(error.message).slice(0, 500) }); await panel?.close(); process.exitCode = 2; }
