#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Scan the prospective source commit and, when present, all local Git history.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invariant, isFinderMetadata, relative } from '../runtime/util.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const scanner = process.env.GITLEAKS_PATH || 'gitleaks';
const run = args => execFileSync(scanner, args, { cwd: root, stdio: 'inherit' });
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-secret-scan-'));
try {
  const version = execFileSync(scanner, ['version'], { encoding: 'utf8' }).trim();
  invariant(version === '8.30.1', `Expected Gitleaks 8.30.1, found ${version}`);
  console.log(`Gitleaks ${version}`);
  const source = path.join(temporary, 'source');
  await fs.mkdir(source);
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' });
  let count = 0;
  for (const file of new Set(files.split('\0').filter(Boolean))) {
    if (isFinderMetadata(file)) continue;
    relative(file);
    const from = path.join(root, file), to = path.join(source, file);
    const stat = await fs.lstat(from).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!stat) continue; // A tracked file may have been deleted in the working tree.
    invariant(stat.isFile() && !stat.isSymbolicLink(), `Unsupported source entry: ${file}`);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    count++;
  }
  invariant(count > 0, 'No source files found to scan');
  console.log(`Scanning ${count} source files; ignored local files are excluded.`);
  run(['dir', '--redact', '--no-banner', '--ignore-gitleaks-allow', '--max-archive-depth=2', source]);
  let hasHistory = false;
  try { execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: root, stdio: 'ignore' }); hasHistory = true; } catch { /* First commit has not been made yet. */ }
  if (hasHistory) run(['git', '--redact', '--no-banner', '--ignore-gitleaks-allow', '--log-opts=--all', root]);
  else console.log('No Git commits yet; source files were scanned before the first commit.');
} catch (error) {
  if (error.code === 'ENOENT') console.error('Install Gitleaks 8.30.1 or set GITLEAKS_PATH to its executable, then rerun npm run scan:secrets.');
  else if (error.status !== undefined) console.error('Secret scan failed; review the redacted findings above.');
  else console.error(`Secret scan failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
