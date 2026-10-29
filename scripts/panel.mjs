#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readModel } from '../runtime/ui/model.mjs';
import { writeReport } from '../runtime/ui/report.mjs';
import { invariant, text } from '../runtime/util.mjs';
import { hostInterface, terminalStatus } from '../runtime/interface.mjs';

export async function panelMain(args, command = 'panel') {
  const allowed = command === 'report' ? ['workspace', 'system'] : ['workspace', 'system', 'source', 'track', 'view', 'port', 'json', 'scope', 'filter', 'panel', 'interface'];
  invariant(Object.keys(args).every(key => allowed.includes(key)), 'Unexpected panel/report option');
  const workspace = path.resolve(text(args.workspace, '--workspace'));
  invariant(!args.json || !args.source, '--json is read-only; run init before requesting a snapshot');
  if (args.source) {
    invariant(args.system, '--source requires --system');
    const { initializeWorkspace } = await import('../runtime/panel-config.mjs');
    await initializeWorkspace(workspace, args.system, args.source);
  }
  if (args.panel !== undefined) {
    invariant(!args.json, '--json must not change preferences');
    const { configure } = await import('../runtime/panel-config.mjs');
    await configure({ workspace, panel: args.panel });
    if (args.panel === 'off') { console.log(JSON.stringify({ panel: 'off', workspace })); return 0; }
  }
  if (command === 'report') { invariant(args.system, '--system is required'); const file = await writeReport(workspace, args.system); console.log(JSON.stringify({ report: file })); return 0; }
  if (args.json) { console.log(JSON.stringify((await readModel(workspace, { system: args.system, track: args.track, scope: args.scope, filter: args.filter })).data, null, 2)); return 0; }
  invariant(args.interface === undefined || ['terminal', 'gui'].includes(args.interface), '--interface must be terminal or gui');
  const mode = hostInterface({ ...process.env, ...(args.interface ? { CODEX_MODERNIZATION_INTERFACE: args.interface } : {}) });
  if (mode === 'terminal') {
    console.log(terminalStatus((await readModel(workspace, { system: args.system, track: args.track, scope: args.scope, filter: args.filter })).data).trimEnd());
    return 0;
  }
  invariant(args.port === undefined || /^\d+$/.test(args.port), '--port must be an integer');
  const { startPanel } = await import('../runtime/ui/server.mjs');
  const panel = await startPanel({ workspace, system: args.system, track: args.track, view: args.view, scope: args.scope, filter: args.filter, port: Number(args.port ?? 0) });
  console.log(JSON.stringify({ panel: panel.url, pid: process.pid, foreground: true, stop: 'Ctrl+C', workspace }, null, 2));
  await new Promise(resolve => {
    let closing = false;
    const stop = async () => {
      if (closing) return; closing = true;
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
      await panel.close(); resolve();
    };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
  });
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { parseArgs } = await import('./modernize.mjs');
  const { command, args } = parseArgs(['panel', ...process.argv.slice(2)]);
  panelMain(args, command).then(code => { process.exitCode = code; }).catch(e => { console.error(e.message); process.exitCode = 2; });
}
