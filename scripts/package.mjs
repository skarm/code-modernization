#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Build the installable plugin archive, including the lockfile npm pack omits.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isFinderMetadata } from '../runtime/util.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const localNames = new Set(['.git', '.idea', '.vscode', '.selftest', 'node_modules', 'coverage', 'dist']);

export async function buildRelease({ root = projectRoot, output = path.join(root, 'dist') } = {}) {
  root = await fs.realpath(root);
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  assert(/^[a-z0-9][a-z0-9-]*$/.test(pkg.name), 'Unsafe package name');
  assert(/^\d+\.\d+\.\d+$/.test(pkg.version), 'Expected a release version');
  const name = `${pkg.name}-${pkg.version}`;
  const entries = [...new Set(['package.json', 'package-lock.json', 'README.md', ...pkg.files])];
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-package-'));
  try {
    const staged = path.join(temporary, name);
    await fs.mkdir(staged);
    for (const entry of entries) {
      assert(typeof entry === 'string' && !path.isAbsolute(entry), 'Expected a relative release path');
      const source = path.resolve(root, entry);
      const relative = path.relative(root, source);
      assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Release path escapes package');
      await fs.cp(source, path.join(staged, relative), {
        recursive: true,
        filter: async file => {
          const base = path.basename(file);
          if (isFinderMetadata(base) || localNames.has(base) || base.endsWith('.log')) return false;
          assert(!/^\.env(?:\.|$)/.test(base) && !/\.(pem|key)$/.test(base) && base !== 'auth.json', `Private file in release: ${file}`);
          const stat = await fs.lstat(file);
          assert(stat.isFile() || stat.isDirectory(), `Unsupported release entry: ${file}`);
          return true;
        }
      });
    }
    const filename = `${name}.tar.gz`;
    const archive = path.join(temporary, filename);
    execFileSync('tar', ['-czf', archive, '--format=ustar', '--owner=root:0', '--group=root:0', '--numeric-owner', '-C', temporary, name], {
      env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: 'pipe'
    });
    const bytes = await fs.readFile(archive);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await fs.mkdir(output, { recursive: true });
    await fs.copyFile(archive, path.join(output, filename));
    await fs.writeFile(path.join(output, `${name}.sha256`), `${checksum}  ${filename}\n`);
    return { archive: path.join(output, filename), sha256: checksum, bytes: bytes.length };
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildRelease().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => {
    console.error(`package: ${error.message}`); process.exitCode = 1;
  });
}
