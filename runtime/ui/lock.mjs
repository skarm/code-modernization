// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { processAlive } from './health.mjs';

/** Short UI transactions only. Never used to recover the SDK coordinator lock. */
export async function withFileLock(files, rel, work) {
  const file = files.resolve(rel); let fd;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { fd = fs.openSync(file, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const before = fs.lstatSync(file); let previous = null;
        if (before.isFile() && before.nlink === 1 && before.size <= 4096) {
          try { previous = await files.json(rel); } catch { /* Unknown ownership is never stolen. */ }
        }
        const after = fs.lstatSync(file); files.resolve(rel);
        if (attempt === 0 && processAlive(previous) === false && before.ino === after.ino && before.dev === after.dev) { fs.unlinkSync(file); continue; }
      } catch (inspectionError) {
        if (inspectionError.code !== 'ENOENT') throw inspectionError;
        // The owner may finish while its metadata is being read. Retry the
        // exclusive open; never turn an ordinary release into a failed hook.
        if (attempt === 0) continue;
      }
      const conflict = new Error('Another UI writer owns this transaction lock. Retry after it finishes.'); conflict.status = 409; throw conflict;
    }
  }
  if (fd === undefined) throw new Error('Could not acquire UI transaction lock');
  const owned = fs.fstatSync(fd);
  try { fs.writeFileSync(fd, JSON.stringify({ token: randomUUID(), pid: process.pid, host: os.hostname(), at: new Date().toISOString() })); fs.fsyncSync(fd); return await work(); }
  finally {
    fs.closeSync(fd); files.resolve(rel); const current = fs.lstatSync(file);
    if (owned.ino === current.ino && owned.dev === current.dev) fs.unlinkSync(file);
    else throw new Error('UI transaction lock ownership changed');
  }
}
