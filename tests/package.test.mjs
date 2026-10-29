// SPDX-License-Identifier: Apache-2.0
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { buildRelease } from '../scripts/package.mjs';

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-package-test-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source'), output = path.join(temporary, 'dist');
  const pkg = { name: 'test-plugin', version: '1.2.3', files: ['.codex-plugin/', 'runtime/', 'tests/fixtures/', 'LICENSE', 'NOTICE'] };
  const put = async (name, value) => {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, value);
  };
  for (const [name, value] of Object.entries({
    'package.json': JSON.stringify(pkg), 'package-lock.json': '{"lockfileVersion":3}',
    'README.md': '# Test plugin', LICENSE: 'Apache-2.0', NOTICE: 'Fixture attribution',
    '.codex-plugin/plugin.json': '{"name":"test-plugin"}',
    'runtime/main.mjs': 'export const fixture = true;',
    'tests/fixtures/oracle.json.gz': Buffer.from([0x1f, 0x8b, 0, 1]),
    'runtime/.DS_Store': 'local metadata', 'runtime/debug.log': 'local output',
    'runtime/node_modules/private/index.js': 'local dependency',
    '.env': 'SYNTHETIC_SECRET=private', '.selftest/run.json': '{}',
    'code-review.json': '{}'
  })) await put(name, value);
  return { root, output, pkg, put };
}

test('release includes installable sources, lockfile and attribution, excludes local state and verifies checksum', async t => {
  const f = await fixture(t), result = await buildRelease(f);
  const files = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' }).trim().split('\n');
  for (const name of ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'NOTICE', '.codex-plugin/plugin.json', 'runtime/main.mjs', 'tests/fixtures/oracle.json.gz'])
    assert(files.includes(`test-plugin-1.2.3/${name}`), `Missing ${name}`);
  assert(!files.some(file => /\.DS_Store|debug\.log|node_modules|\.env|\.selftest|code-review/.test(file)));
  const bytes = await fs.readFile(result.archive);
  assert.equal(result.sha256, createHash('sha256').update(bytes).digest('hex'));
  // Inspect every tar header: no local owner, group, PAX attributes or macOS metadata.
  const tar = gunzipSync(bytes);
  for (let offset = 0; offset + 512 <= tar.length && tar[offset] !== 0;) {
    const header = tar.subarray(offset, offset + 512);
    assert.equal(parseInt(header.subarray(108, 116).toString(), 8), 0);
    assert.equal(parseInt(header.subarray(116, 124).toString(), 8), 0);
    assert(header.subarray(265, 329).every(byte => byte === 0));
    assert(!['x', 'g'].includes(String.fromCharCode(header[156])), 'Unexpected extended metadata');
    const size = parseInt(header.subarray(124, 136).toString(), 8);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.equal(await fs.readFile(path.join(f.output, 'test-plugin-1.2.3.sha256'), 'utf8'), `${result.sha256}  test-plugin-1.2.3.tar.gz\n`);
  const extracted = path.join(f.output, 'extracted'); await fs.mkdir(extracted);
  execFileSync('tar', ['-xzf', result.archive, '-C', extracted]);
  assert.deepEqual(await fs.readFile(path.join(extracted, 'test-plugin-1.2.3/tests/fixtures/oracle.json.gz')), Buffer.from([0x1f, 0x8b, 0, 1]));
});

test('release refuses symlinks inside included directories', async t => {
  const f = await fixture(t);
  await fs.symlink('../README.md', path.join(f.root, 'runtime/linked.md'));
  await assert.rejects(buildRelease(f), /Unsupported release entry/);
  await assert.rejects(fs.access(f.output));
});

test('release refuses credentials accidentally placed in included directories', async t => {
  const f = await fixture(t);
  await f.put('runtime/.env.local', 'SYNTHETIC_SECRET=private');
  await assert.rejects(buildRelease(f), /Private file in release/);
  await assert.rejects(fs.access(f.output));
});

test('release refuses allowlist paths outside the project', async t => {
  const f = await fixture(t);
  f.pkg.files.push('../outside'); await f.put('package.json', JSON.stringify(f.pkg));
  await assert.rejects(buildRelease(f), /Release path escapes package/);
  await assert.rejects(fs.access(f.output));
});
