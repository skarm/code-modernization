#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Engine, PLUGIN_ROOT, readStatus, resolveLayout, ROLES } from '../runtime/engine.mjs';
import { createCodex, findCodex, loadSdk, SDK_VERSION } from '../runtime/sdk.mjs';
import { PLUGIN_VERSION } from '../runtime/version.mjs';
import { compareCases, writeComparison } from '../runtime/compare.mjs';
import { WORKFLOWS, prepareWorkflow, runWorkflow } from '../runtime/workflows.mjs';
import { exists, integer, invariant, name, object, readJSON, redact, text, realDirectory, safeResolve } from '../runtime/util.mjs';

const BOOL = new Set(['allow-writes', 'confirm-stopped', 'network', 'record-tool-output', 'events', 'json', 'retry-failed', 'all']);
const VALUE = new Set(['workspace', 'system', 'source', 'workflow', 'input', 'run-id', 'concurrency',
  'max-turns', 'max-tokens', 'task-timeout-ms', 'run-timeout-ms', 'web', 'roles', 'cases', 'output', 'module', 'port', 'view', 'track', 'scope', 'filter', 'pattern', 'result', 'panel', 'xray', 'command-prefix', 'legacy-dir', 'interface']);
export function parseArgs(argv) {
  const command = argv[0] ?? 'help', args = {};
  invariant(['run', 'resume', 'status', 'doctor', 'help', 'compare', 'verify', 'panel', 'report', 'init', 'make-shards', 'render-rules', 'config'].includes(command), `Unknown command ${command}`);
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i];
    invariant(flag.startsWith('--'), `Unexpected argument: ${flag}`);
    const key = flag.slice(2);
    invariant(!Object.hasOwn(args, key), `Duplicate option: ${flag}`);
    if (BOOL.has(key)) args[key] = true;
    else {
      invariant(VALUE.has(key), `Unknown option: ${flag}`);
      invariant(i + 1 < argv.length && !argv[i + 1].startsWith('--'), `Missing value for ${flag}`);
      args[key] = argv[++i];
    }
  }
  return { command, args };
}
function numberOption(args, flag, fallback, min, max) {
  const raw = args[flag];
  if (raw !== undefined) invariant(/^\d+$/.test(raw), `--${flag} must be an integer`);
  return integer(raw === undefined ? undefined : Number(raw), fallback, min, max, flag);
}
async function optionsFor(args, saved = {}) {
  const options = {
    concurrency: numberOption(args, 'concurrency', saved.concurrency ?? 4, 1, 16),
    maxTurns: numberOption(args, 'max-turns', saved.maxTurns ?? 500, 1, 10000),
    maxTokens: numberOption(args, 'max-tokens', saved.maxTokens ?? 0, 0, 1000000000),
    taskTimeoutMs: numberOption(args, 'task-timeout-ms', saved.taskTimeoutMs ?? 1200000, 100, 86400000),
    webSearch: args.web ?? saved.webSearch ?? 'disabled',
    network: args.network === true || saved.network === true,
    // Do not inherit write consent on resume; it must be passed again explicitly.
    allowWrites: args['allow-writes'] === true,
    confirmStopped: args['confirm-stopped'] === true,
    recordToolOutput: args['record-tool-output'] === true || saved.recordToolOutput === true,
    retryFailed: args['retry-failed'] === true,
    roles: args.roles ? await readJSON(path.resolve(args.roles)) : saved.roles ?? {},
  };
  invariant(['disabled', 'cached', 'live'].includes(options.webSearch), '--web must be disabled, cached or live');
  object(options.roles, 'role settings');
  for (const [role, profile] of Object.entries(options.roles)) {
    invariant(ROLES.includes(role), `Unknown role override: ${role}`); object(profile, 'role profile');
    invariant(Object.keys(profile).every(k => ['model', 'reasoningEffort'].includes(k)), 'Only model and reasoningEffort may be overridden per role');
    if (profile.model !== undefined) text(profile.model, 'model', 200);
    if (profile.reasoningEffort !== undefined) invariant(['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'persistent'].includes(profile.reasoningEffort), 'Unsupported SDK reasoning effort');
  }
  return options;
}

export async function doctor() {
  const status = { node: process.version, minimumNode: '20', sdkPackage: '@openai/codex-sdk',
    pinnedSdkVersion: SDK_VERSION, sdkImported: false, codexClientConstructed: false,
    codexPath: null, authenticationChecked: false, modelCallMade: false, problems: [] };
  if (Number(process.versions.node.split('.')[0]) < 20) status.problems.push('Node.js 20+ is required by this plugin runner');
  try {
    const loaded = await loadSdk(); status.sdkImported = true; status.sdkLocation = loaded.location;
    status.sdkVersion = loaded.version ?? null; status.sdkSource = loaded.source;
  } catch (error) { status.problems.push(redact(error.message)); }
  try {
    status.codexPath = process.env.CODEX_PATH ? await findCodex() : 'SDK package resolution';
    if (status.sdkImported) { await createCodex(); status.codexClientConstructed = true; }
  } catch (e) { status.problems.push(redact(e.message)); }
  return status;
}
function help() {
  return `Code Modernization ${PLUGIN_VERSION}\n\n` +
    `node scripts/modernize.mjs doctor\n` +
    `node scripts/modernize.mjs compare --cases FILE [--output EQUIVALENCE.json]\n` +
    `node scripts/modernize.mjs verify --workspace DIR --system NAME [--module NAME]\n` +
    `node scripts/modernize.mjs panel --workspace DIR [--system NAME] [--interface terminal|gui] [--view progress|review|report|topology|fleet] [--json]\n` +
    `node scripts/modernize.mjs report --workspace DIR --system NAME\n` +
    `node scripts/modernize.mjs init --workspace DIR --system NAME --source DIR\n` +
    `node scripts/modernize.mjs make-shards --workspace DIR --system NAME [--source DIR] [--pattern GLOB] [--all]\n` +
    `node scripts/modernize.mjs render-rules --workspace DIR --system NAME [--result FILE]\n` +
    `node scripts/modernize.mjs config --workspace DIR [--panel auto|command|off] [--xray on|off]\n` +
    `node scripts/modernize.mjs run --workspace DIR --system NAME --source DIR --workflow NAME --input FILE\n` +
    `node scripts/modernize.mjs resume --workspace DIR --system NAME --run-id ID [--retry-failed] [--allow-writes --confirm-stopped]\n` +
    `node scripts/modernize.mjs status --workspace DIR --system NAME [--run-id ID]\n\n` +
    `Workflows: ${WORKFLOWS.join(', ')}\n` +
    `Controls: --concurrency 1..16 --max-turns N --max-tokens N (0 disables launch budget)\n` +
    `          --task-timeout-ms N --run-timeout-ms N --web disabled|cached|live\n` +
    `          --roles FILE --network --events --record-tool-output\n` +
    `Writes require recorded original gates, disjoint candidate scopes and --allow-writes.\n` +
    `No daemon, MCP server, Python, SQLite, separate API client or automatic dependency installation.\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const { command, args } = parseArgs(argv);
  if (command === 'help') { process.stdout.write(help()); return 0; }
  if (command === 'panel' || command === 'report') return (await import('./panel.mjs')).panelMain(args, command);
  if (command === 'config') {
    const { configure } = await import('../runtime/panel-config.mjs');
    console.log(JSON.stringify(await configure(args), null, 2)); return 0;
  }
  if (command === 'doctor') {
    const status = await doctor(); console.log(JSON.stringify(status, null, 2)); return status.problems.length ? 2 : 0;
  }
  if (command === 'compare') {
    invariant(Object.keys(args).every(key => ['cases', 'output'].includes(key)), 'compare accepts only --cases and --output');
    const comparison = await compareCases(path.resolve(text(args.cases, '--cases')));
    const output = await writeComparison(comparison, args.output);
    console.log(JSON.stringify({ resultFile: output, passed: comparison.report.passed,
      totals: comparison.report.totals, coverageGaps: comparison.report.coverageGaps,
      behaviorEquivalenceProven: false }, null, 2));
    return comparison.report.passed ? 0 : 1;
  }
  if (command === 'verify') {
    invariant(Object.keys(args).every(key => ['workspace', 'system', 'module'].includes(key)), 'verify accepts only --workspace, --system and --module');
    const { buildProofPack, writeProofPack } = await import('../runtime/proof-pack.mjs');
    const workspace = path.resolve(text(args.workspace, '--workspace')), system = name(args.system, '--system');
    const pack = await buildProofPack(system, workspace, args.module ?? null);
    const outputs = await writeProofPack(pack, workspace);
    console.log(JSON.stringify({ system, evaluator: pack.evaluator, ...pack.overall, outputs,
      modules: pack.modules.map(m => ({ name: m.name, track: m.track, verdict: m.verdict, reasons: m.reasons })),
      toolingOnly: pack.toolingOnly, problems: pack.problems }, null, 2));
    return pack.overall.verdict === 'PROVEN' ? 0 : 1;
  }
  const workspace = path.resolve(text(args.workspace, '--workspace'));
  const system = name(args.system, '--system');
  if (['init', 'make-shards', 'render-rules'].includes(command)) {
    const allowed = command === 'init' ? ['workspace', 'system', 'source'] : command === 'make-shards' ? ['workspace', 'system', 'source', 'pattern', 'all'] : ['workspace', 'system', 'source', 'result'];
    invariant(Object.keys(args).every(k => allowed.includes(k)), `Unexpected ${command} option`);
    const { initializeWorkspace } = await import('../runtime/panel-config.mjs');
    const layout = command === 'render-rules' ? { workspace: await realDirectory(workspace), system, analysis: await safeResolve(await realDirectory(workspace), `analysis/${system}`, { directory: true, noLinks: true }) }
      : await initializeWorkspace(workspace, system, args.source);
    if (command === 'init') console.log(JSON.stringify(layout, null, 2));
    if (command === 'make-shards') {
      const { makeShards } = await import('../runtime/shards.mjs');
      console.log(JSON.stringify(await makeShards(layout, { pattern: args.pattern, includeAll: args.all }), null, 2));
    }
    if (command === 'render-rules') {
      const { writeRuleArtifacts } = await import('../runtime/rule-artifacts.mjs');
      const result = await readJSON(args.result ? path.resolve(args.result) : path.join(layout.analysis, 'rules_result.json'));
      console.log(JSON.stringify(await writeRuleArtifacts(layout, result), null, 2));
    }
    return 0;
  }
  if (command === 'status') {
    if (args['run-id']) console.log(JSON.stringify(await readStatus(workspace, system, args['run-id']), null, 2));
    else {
      const folder = path.join(workspace, 'analysis', system, '.codex-sdk', 'runs');
      const runs = [];
      if (await exists(folder)) for (const entry of (await fs.readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const id = entry.name;
        try {
          const state = await readStatus(workspace, system, id);
          runs.push({ runId: id, workflow: state.workflow, status: state.status, createdAt: state.createdAt, usage: state.usage });
        } catch (e) { runs.push({ runId: id, error: String(e.message) }); }
      }
      console.log(JSON.stringify(runs, null, 2));
    }
    return 0;
  }
  invariant(process.env.CODEX_MODERNIZATION_WORKER !== '1', 'SDK workers cannot recursively launch modernization runs');
  let raw, workflow, source, saved = {};
  const resume = command === 'resume';
  invariant(!args['retry-failed'] || resume, '--retry-failed is only valid with resume');
  if (resume) {
    name(args['run-id'], '--run-id');
    invariant(!args.input && !args.workflow && !args.source, 'resume uses saved inputs; new inputs/source/workflow require a new run');
    const request = await readJSON(path.join(workspace, 'analysis', system, '.codex-sdk', 'runs', args['run-id'], 'request.json'));
    ({ input: raw, workflow, source, options: saved } = request);
  } else {
    workflow = text(args.workflow, '--workflow', 120);
    raw = await readJSON(path.resolve(text(args.input, '--input')));
    source = args.source ? path.resolve(args.source) : undefined;
  }
  const options = await optionsFor(args, saved);
  const runTimeoutMs = numberOption(args, 'run-timeout-ms', saved.runTimeoutMs ?? 3600000, 100, 604800000);
  options.runTimeoutMs = runTimeoutMs;
  const layout = await resolveLayout(workspace, system, source);
  const prepared = await prepareWorkflow(workflow, raw, layout, options);
  // Fail before scheduling any work if the official SDK/CLI cannot be loaded.
  const client = await createCodex({ modernizationContext: layout });
  const engine = await Engine.open({ layout, workflow, ...prepared, options,
    runId: args['run-id'], resume, factory: () => client,
    onProgress(event) {
      if (args.events) process.stderr.write(`${JSON.stringify(event)}\n`);
      else if (['thread.started', 'turn.completed', 'worker.failed'].includes(event.type))
        process.stderr.write(`[${event.task}] ${event.type}${event.error ? `: ${event.error}` : ''}\n`);
    },
  });
  process.stderr.write(`Run ${engine.state.id}; state: ${engine.runDir}\n`);
  const stop = () => engine.cancel('Interrupted by user/supervisor');
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const timer = setInterval(() => { if (engine.activeDuration() >= runTimeoutMs) engine.cancel('Workflow active-time limit reached'); }, Math.min(1000, runTimeoutMs));
  let result, error;
  try { result = await runWorkflow(engine, prepared.input); }
  catch (e) { error = e; engine.cancel(String(e.message)); }
  finally { clearInterval(timer); process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  const finished = await engine.finish(result, error);
  console.log(JSON.stringify({ runId: finished.runId, status: finished.status, runDir: finished.runDir,
    resultFile: finished.result ? path.join(finished.runDir, 'result.json') : null, usage: finished.usage,
    ...(finished.error ? { error: finished.error } : {}) }, null, 2));
  return finished.status === 'completed' ? 0 : finished.status === 'partial' ? 3 : 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(`${redact(String(error.message))}\n`); process.exitCode = 2;
  });
}
