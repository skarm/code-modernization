// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { resolveLayout } from './engine.mjs';
import { atomicJSON, exists, invariant, name, realDirectory, relative, overlaps } from './util.mjs';
import { WorkspaceFiles, atomicText } from './ui/files.mjs';

export const CONFIG_FILE = 'MODERNIZATION_UI.json';
export const DEFAULT_UI_CONFIG = { panel: 'auto', xray: true, system: null, track: 'auto', commandPrefix: '$modernize-', legacyDir: 'legacy', telemetry: false };
export function validateUIConfig(raw) {
  invariant(raw && typeof raw === 'object' && !Array.isArray(raw), 'UI configuration must be an object');
  invariant(Object.keys(raw).every(k => Object.hasOwn(DEFAULT_UI_CONFIG, k)), 'Unknown UI configuration field');
  const config = { ...DEFAULT_UI_CONFIG, ...raw };
  invariant(['auto', 'command', 'off'].includes(config.panel), 'panel must be auto, command or off');
  invariant(typeof config.xray === 'boolean' && config.telemetry === false, 'xray must be boolean; telemetry is disabled');
  if (config.system !== null) name(config.system);
  invariant(['auto', 'transform', 'uplift', 'reimagine'].includes(config.track), 'Invalid configured track');
  invariant(typeof config.commandPrefix === 'string' && /^[$/]?[a-zA-Z][a-zA-Z0-9:_-]{0,79}-$/.test(config.commandPrefix), 'Invalid command prefix');
  relative(config.legacyDir, 'legacyDir'); return config;
}
export async function readUIConfig(workspace) {
  const files = new WorkspaceFiles(workspace), raw = await files.json(CONFIG_FILE);
  return validateUIConfig(raw ?? {});
}
export async function configure(args) {
  invariant(Object.keys(args).every(k => ['workspace', 'panel', 'xray', 'system', 'track', 'command-prefix', 'legacy-dir'].includes(k)), 'Unexpected config option');
  const workspace = await realDirectory(path.resolve(args.workspace ?? '.')), config = await readUIConfig(workspace);
  const fields = { panel: 'panel', system: 'system', track: 'track', 'command-prefix': 'commandPrefix', 'legacy-dir': 'legacyDir' };
  for (const [arg, key] of Object.entries(fields)) if (args[arg] !== undefined) config[key] = args[arg];
  if (args.xray !== undefined) { invariant(['on', 'off'].includes(args.xray), '--xray must be on or off'); config.xray = args.xray === 'on'; }
  validateUIConfig(config);
  if (Object.keys(args).some(k => k !== 'workspace')) await atomicJSON(path.join(workspace, CONFIG_FILE), config);
  return config;
}
export async function initializeWorkspace(workspace, system, source) {
  name(system); workspace = path.resolve(workspace);
  if (source) {
    source = await realDirectory(path.resolve(source));
    let ancestor = workspace; const missing = [];
    while (!(await exists(ancestor))) { missing.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
    const future = path.join(await fs.realpath(ancestor), ...missing);
    invariant(!overlaps(source, future), 'Source and workspace must be separate, non-nested directories');
  }
  await fs.mkdir(workspace, { recursive: true, mode: 0o700 }); workspace = await realDirectory(workspace);
  const config = await readUIConfig(workspace);
  if (!source && config.legacyDir !== 'legacy') {
    const candidate = path.join(workspace, config.legacyDir, system);
    if (await exists(candidate)) source = await realDirectory(candidate);
  }
  const layout = await resolveLayout(workspace, system, source ? path.resolve(source) : undefined);
  const files = new WorkspaceFiles(workspace);
  if (!(await files.exists(`analysis/${system}/SOURCE`))) atomicText(files, `analysis/${system}/SOURCE`, layout.source + '\n');
  return layout;
}
