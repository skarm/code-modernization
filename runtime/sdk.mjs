// SPDX-License-Identifier: Apache-2.0
// Only official public SDK APIs are used; no subprocess protocol is reimplemented.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { invariant, object, readJSON, relative, within } from './util.mjs';

const ENV_KEYS = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'USER', 'LOGNAME', 'SHELL',
  'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT',
  'LANG', 'LC_ALL', 'TERM', 'CODEX_HOME', 'CODEX_API_KEY', 'OPENAI_API_KEY',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'CODEX_CA_CERTIFICATE'];

export function childEnvironment(env = process.env) {
  const out = Object.fromEntries(ENV_KEYS.filter(k => env[k] !== undefined).map(k => [k, env[k]]));
  // An inherited custom originator must not masquerade as the interactive parent.
  out.CODEX_INTERNAL_ORIGINATOR_OVERRIDE = 'codex_sdk_ts';
  out.CODEX_MODERNIZATION_WORKER = '1';
  return out;
}

export async function findCodex(explicit = process.env.CODEX_PATH, env = process.env) {
  if (explicit) {
    invariant(path.isAbsolute(explicit), 'CODEX_PATH must be an absolute executable path');
    const st = await fs.stat(explicit);
    invariant(st.isFile(), 'CODEX_PATH is not a file');
    await fs.access(explicit, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return explicit;
  }
  // Do not search the repository/current directory for a potentially planted binary.
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const executable of process.platform === 'win32' ? ['codex.exe'] : ['codex']) {
      const candidate = path.join(dir, executable);
      try {
        const st = await fs.stat(candidate);
        if (!st.isFile()) continue;
        await fs.access(candidate, process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
        return candidate;
      } catch { /* Continue to the SDK's own CLI package resolution. */ }
    }
  }
  return undefined;
}

export const SDK_VERSION = '0.162.1';
export const USAGE_KEYS = ['input_tokens', 'output_tokens', 'cached_input_tokens',
  'cache_write_input_tokens', 'reasoning_output_tokens'];

export function usageDelta(total, previous = {}) {
  object(total, 'SDK usage'); object(previous, 'Previous SDK usage');
  // CLI rust-v0.162.1's JSONL processor emits ThreadTokenUsage.total, including
  // resumed turns, despite the SDK type comments saying "during the turn".
  return Object.fromEntries(USAGE_KEYS.map(key => {
    const current = total[key] ?? 0, before = previous[key] ?? 0;
    invariant(Number.isSafeInteger(current) && current >= 0 && Number.isSafeInteger(before) && before >= 0, 'Invalid SDK usage');
    invariant(current >= before, 'SDK thread usage decreased; verify the explicitly selected CLI version');
    return [key, current - before];
  }));
}

export async function loadSdk() {
  // Prefer the installed plugin's normal npm dependency. A shared user-owned npm
  // directory also works when the host installs skills into a read-only cache.
  if (!process.env.CODEX_MODERNIZATION_SDK_DIR) {
    try {
      const module = await import('@openai/codex-sdk');
      const location = typeof import.meta.resolve === 'function'
        ? import.meta.resolve('@openai/codex-sdk') : '@openai/codex-sdk';
      let version;
      if (location.startsWith('file:')) {
        const meta = await readJSON(new URL('../package.json', location));
        invariant(meta.name === '@openai/codex-sdk' && meta.version === SDK_VERSION,
          `Expected @openai/codex-sdk ${SDK_VERSION}, found ${meta.version ?? 'unknown'}`);
        version = meta.version;
      }
      return { module, location, version, source: 'package-resolution' };
    } catch (error) {
      if (!['ERR_MODULE_NOT_FOUND', 'ERR_PACKAGE_PATH_NOT_EXPORTED'].includes(error.code)) throw error;
    }
  }
  const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const directory = process.env.CODEX_MODERNIZATION_SDK_DIR || path.join(home, 'code-modernization-sdk');
  invariant(path.isAbsolute(directory), 'CODEX_MODERNIZATION_SDK_DIR must be an absolute npm project directory');
  const packageRoot = path.join(directory, 'node_modules', '@openai', 'codex-sdk');
  let meta;
  try { meta = await readJSON(path.join(packageRoot, 'package.json')); }
  catch (cause) {
    throw new Error('Official @openai/codex-sdk is not installed. Run npm install in the plugin directory, or install it into ~/.codex/code-modernization-sdk. The plugin does not request an API key.', { cause });
  }
  invariant(meta.name === '@openai/codex-sdk', 'Unexpected package in the shared SDK directory');
  invariant(meta.version === SDK_VERSION, `Expected @openai/codex-sdk ${SDK_VERSION}, found ${meta.version ?? 'unknown'}`);
  const entry = meta.exports?.['.']?.import ?? meta.module;
  invariant(typeof entry === 'string' && entry.startsWith('./'), 'Unsupported official SDK entry point');
  const target = path.resolve(packageRoot, relative(entry.slice(2)));
  invariant(within(packageRoot, target), 'SDK entry point escaped package root');
  const location = pathToFileURL(target).href;
  return { module: await import(location), location, version: meta.version, source: 'shared-sdk-directory' };
}

export async function createCodex({ codexPath, modernizationContext } = {}) {
  const { module: mod } = await loadSdk();
  // Prefer the CLI shipped with the pinned SDK. PATH may contain another protocol version.
  const selected = codexPath ?? process.env.CODEX_PATH;
  const executable = selected ? await findCodex(selected) : undefined;
  const env = childEnvironment();
  if (modernizationContext) {
    for (const key of ['workspace', 'source']) invariant(path.isAbsolute(modernizationContext[key] ?? ''), 'Invalid modernization hook context');
    invariant(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(modernizationContext.system ?? ''), 'Invalid modernization hook system');
    env.CODEX_MODERNIZATION_WORKSPACE = modernizationContext.workspace;
    env.CODEX_MODERNIZATION_SOURCE = modernizationContext.source;
    env.CODEX_MODERNIZATION_SYSTEM = modernizationContext.system;
  }
  return new mod.Codex({
    ...(executable ? { codexPathOverride: executable } : {}),
    env,
    config: {
      // The orchestrator owns fan-out. Child agents must not recursively multiply it.
      features: { multi_agent: false },
      sandbox_workspace_write: {
        writable_roots: [], exclude_tmpdir_env_var: true, exclude_slash_tmp: true,
      },
    },
  });
}

export function threadOptions({ workingDirectory, write = false, model, reasoningEffort, webSearch = 'disabled', network = false }) {
  return {
    workingDirectory,
    sandboxMode: write ? 'workspace-write' : 'read-only',
    approvalPolicy: 'never', // Reject escalation; this does NOT grant blanket permission.
    skipGitRepoCheck: true, // Support non-Git legacy copies without mutating Git metadata.
    networkAccessEnabled: network,
    webSearchMode: webSearch,
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
  };
}

/** A single streamed SDK turn. `onEvent` is awaited to checkpoint thread IDs promptly. */
export async function streamTurn(thread, input, { schema, signal, onEvent }) {
  const { events } = await thread.runStreamed(input, { outputSchema: schema, signal });
  let finalResponse, completed = false, usage = null;
  const commands = [], changes = [];
  for await (const event of events) {
    await onEvent(event);
    if (event.type === 'error') throw new Error(event.message || 'Codex stream error');
    if (event.type === 'turn.failed') throw new Error(event.error?.message || 'Codex turn failed');
    if (event.type === 'item.completed') {
      const item = event.item;
      if (item.type === 'agent_message') finalResponse = item.text;
      if (item.type === 'command_execution') commands.push(item);
      if (item.type === 'file_change') changes.push(item);
    }
    if (event.type === 'turn.completed') { completed = true; usage = event.usage; }
  }
  if (signal?.aborted) throw signal.reason ?? new Error('Cancelled');
  invariant(completed, 'Codex stream ended without turn.completed; result is incomplete');
  invariant(typeof finalResponse === 'string', 'Codex did not return a final agent_message');
  return { finalResponse, usage, commands, changes };
}
