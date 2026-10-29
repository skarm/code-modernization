#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Offline package checks, not an official host-schema validator or an SDK integration test.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { ROLES } from '../runtime/engine.mjs';
import { WORKFLOWS } from '../runtime/workflows.mjs';
import { PLUGIN_VERSION } from '../runtime/version.mjs';
import { isFinderMetadata } from '../runtime/util.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
async function scan(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (['.git', '.idea', '.vscode', 'node_modules', 'coverage', '.selftest', 'dist', 'analysis', 'legacy', 'modernized'].includes(item.name)) continue;
    if (isFinderMetadata(item.name) || item.name.endsWith('.log')) continue;
    const full = path.join(dir, item.name);
    assert(!item.isSymbolicLink(), `Symlink in distribution: ${full}`);
    if (item.isDirectory()) await scan(full); else files.push(full);
  }
}
await scan(root);
const jsonFiles = files.filter(f => f.endsWith('.json'));
for (const file of jsonFiles) JSON.parse(await fs.readFile(file, 'utf8'));
const read = async file => JSON.parse(await fs.readFile(path.join(root, file), 'utf8'));
const pkg = await read('package.json'), manifest = await read('examples/portable-plugin.json');
await assert.rejects(fs.access(path.join(root, 'plugin.json')), 'Root portable manifest disables hooks in Codex CLI 0.162.1');
const compat = await read('.codex-plugin/plugin.json');
assert.equal(pkg.version, PLUGIN_VERSION); assert.equal(pkg.version, manifest.version);
assert.equal(manifest.version, compat.version); assert.equal(pkg.name, manifest.name);
assert.equal(pkg.name, compat.name);
assert.deepEqual(pkg.dependencies, { '@openai/codex-sdk': '0.162.1', '@stephen-riley/pcre2-wasm': '1.2.4', saxes: '6.0.0' });
assert.equal(pkg.engines.node, '>=20');
const lock = await read('package-lock.json');
assert.equal(lock.version, pkg.version);
assert.equal(lock.name, pkg.name);
assert.equal(lock.packages[''].name, pkg.name);
assert.equal(lock.packages[''].version, pkg.version);
assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
assert.equal(lock.packages['node_modules/@openai/codex-sdk'].version, pkg.dependencies['@openai/codex-sdk']);
assert(lock.packages['node_modules/@openai/codex-sdk'].integrity, 'SDK lockfile integrity missing');
assert.equal(lock.packages['node_modules/saxes'].version, pkg.dependencies.saxes);
assert(lock.packages['node_modules/saxes'].integrity, 'XML parser lockfile integrity missing');
assert.equal(lock.packages['node_modules/@stephen-riley/pcre2-wasm'].version, '1.2.4');
assert(lock.packages['node_modules/@stephen-riley/pcre2-wasm'].integrity, 'Regex backend lockfile integrity missing');
await fs.access(path.join(root, 'scripts/proof-pack.mjs'));
await fs.access(path.join(root, 'tests/fixtures/proof-pack-upstream.json.gz'));
assert.equal(manifest.extensions['com.openai'].interface.displayName, compat.interface.displayName);
assert(!('mcpServers' in manifest));
assert.equal(manifest.extensions['com.openai'].hooks, './hooks/hooks.json');
assert.equal(compat.hooks, './hooks/hooks.json');
const hooks = await read('hooks/hooks.json');
for (const event of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'Interrupt', 'SessionEnd']) {
  assert.equal(hooks.hooks[event][0].hooks[0].type, 'command');
  assert.equal(hooks.hooks[event][0].hooks[0].command, 'node "${PLUGIN_ROOT}/scripts/host-hook.mjs"');
}
for (const event of ['SessionEnd', 'Interrupt']) {
  for (const group of hooks.hooks[event]) for (const hook of group.hooks)
    assert(Number.isFinite(hook.timeout) && hook.timeout >= 1 && hook.timeout <= 3, `${event} timeout must be within the host's 1–3 second limit`);
}
const skills = files.filter(f => f.endsWith(`${path.sep}SKILL.md`));
assert.equal(skills.length, 16);
let links = 0;
for (const skill of skills) {
  const body = await fs.readFile(skill, 'utf8');
  assert(body.startsWith('---\n'), `Missing skill metadata: ${skill}`);
  const meta = body.slice(4, body.indexOf('\n---', 4));
  assert.equal(/^name: (.+)$/m.exec(meta)?.[1], path.basename(path.dirname(skill)));
  assert(/^description: .+/m.test(meta), `Missing description: ${skill}`);
  assert(body.includes('SDK.md'), `Missing SDK routing: ${skill}`);
}
for (const file of files.filter(f => f.endsWith('.md'))) {
  const body = (await fs.readFile(file, 'utf8')).replace(/```[^\n]*\n[\s\S]*?```/g, '');
  for (const match of body.matchAll(/\[[^\]\n]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (/^[a-z][\w+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const pathname = decodeURIComponent(target.split('#')[0]);
    const full = path.resolve(path.dirname(file), pathname);
    assert(full.startsWith(root), `Link escapes package: ${file}: ${target}`);
    await fs.access(full); links++;
  }
}
for (const role of ROLES) await fs.access(path.join(root, 'agents', `${role}.md`));
assert.equal((await fs.readdir(path.join(root, 'agents'))).filter(f => f.endsWith('.md')).length, 8);
for (const workflow of WORKFLOWS.filter(w => w !== 'role-task')) {
  await fs.access(path.join(root, 'workflows', `${workflow}.md`));
  await fs.access(path.join(root, 'examples/sdk', `${workflow}.json`));
}
const javascript = files.filter(f => f.endsWith('.mjs'));
for (const file of javascript) execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
let inlineScripts = 0;
for (const file of files.filter(f => f.endsWith('.html'))) {
  for (const match of (await fs.readFile(file, 'utf8')).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/type\s*=\s*["']application\/json["']/i.test(match[1])) continue;
    new Script(match[2], { filename: path.relative(root, file) }); inlineScripts++;
  }
}
assert(!files.some(f => /\.(py|sqlite|sqlite3)$/.test(f)), 'Unexpected runtime/database file');
const marketplace = await read('.agents/plugins/marketplace.json');
assert.equal(marketplace.plugins[0].name, pkg.name);
assert.equal(marketplace.plugins[0].source.path, './');
const personalMarketplace = await read('examples/marketplace-personal.json');
assert.equal(personalMarketplace.plugins[0].name, pkg.name);
console.log(JSON.stringify({ package: pkg.name, version: pkg.version, jsonFiles: jsonFiles.length,
  skills: skills.length, roles: ROLES.length, originalWorkflows: WORKFLOWS.length - 1,
  javascriptSyntaxChecks: javascript.length, inlineScriptSyntaxChecks: inlineScripts, relativeLinks: links, officialHostValidation: false,
  liveSdk: false }, null, 2));
