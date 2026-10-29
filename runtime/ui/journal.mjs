// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { clean, isObject } from '../proof-io.mjs';
import { invariant } from '../util.mjs';
import { uiRedact } from './files.mjs';
import { testTotals } from './observations.mjs';

// A bounded, append-aware tail. Offsets are bytes, including for multibyte UTF-8.
// Partial last lines are reread; replaced/truncated files start a new generation.
export class JournalTail {
  constructor({ maxBytes = 256 * 1024, maxLines = 400, maxFiles = 256 } = {}) {
    Object.assign(this, { maxBytes, maxLines, maxFiles }); this.files = new Map();
    this.stats = { bytes: 0, reads: 0 }; this.cachedBytes = 0;
  }
  async read(files, rel) {
    const file = files.resolve(rel);
    let handle;
    try {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const before = await handle.stat(); files.resolve(rel);
      invariant(before.isFile(), 'Activity log is not a regular file');
      const identity = `${before.dev}:${before.ino}:${before.birthtimeMs}`;
      let hit = this.files.get(file);
      if (!hit || hit.identity !== identity || before.size < hit.size || before.size === hit.size && before.ctimeMs !== hit.ctimeMs)
        hit = { identity, offset: 0, lines: [], size: 0, ctimeMs: 0 };
      if (before.size !== hit.size) {
        const start = Math.max(hit.offset, before.size - this.maxBytes);
        const buffer = Buffer.alloc(Math.min(this.maxBytes, before.size - start));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
        this.stats.bytes += bytesRead; this.stats.reads++;
        let cursor = 0;
        if (start > hit.offset) { hit.lines = []; const cut = buffer.indexOf(10); cursor = cut < 0 ? bytesRead : cut + 1; }
        let end;
        while ((end = buffer.indexOf(10, cursor)) >= 0 && end < bytesRead) {
          const offset = start + cursor, raw = buffer.subarray(cursor, end).toString('utf8'); cursor = end + 1;
          try {
            const value = JSON.parse(raw);
            if (isObject(value)) hit.lines.push({ ...eventView(value), offset, generation: identity });
          } catch { /* An invalid complete line does not hide the rest of the log. */ }
        }
        hit.offset = start + cursor;
        // Bound a malformed line without a newline as well as ordinary logs.
        if (bytesRead === this.maxBytes && cursor === 0) hit.offset = start + bytesRead;
        hit.lines = hit.lines.slice(-this.maxLines);
      }
      hit.size = before.size; hit.ctimeMs = before.ctimeMs;
      const old = this.files.get(file); if (old) this.cachedBytes -= old.storedBytes ?? 0;
      hit.storedBytes = Buffer.byteLength(JSON.stringify(hit.lines)); this.cachedBytes += hit.storedBytes;
      this.files.delete(file); this.files.set(file, hit);
      while (this.files.size > this.maxFiles || this.cachedBytes > 16 * 1024 * 1024) { const key = this.files.keys().next().value; this.cachedBytes -= this.files.get(key).storedBytes; this.files.delete(key); }
      return hit.lines;
    } catch (e) {
      if (e.code === 'ENOENT') { this.cachedBytes -= this.files.get(file)?.storedBytes ?? 0; this.files.delete(file); return []; }
      files.io.gap(`Activity log unavailable: ${clean(e.message, 160)}`); return [];
    } finally { await handle?.close(); }
  }
}

function eventView(event) {
  const item = event.item;
  return uiRedact({ at: clean(event.at, 50), task: clean(event.task, 120), type: clean(event.type, 100),
    ...(event.actor === 'sdk-worker' ? { actor: 'sdk-worker' } : {}),
    ...(typeof event.workingDirectory === 'string' ? { workingDirectory: clean(event.workingDirectory, 2000) } : {}),
    ...(event.error ? { error: clean(event.error, 1000) } : {}),
    ...(isObject(item) ? { item: { id: clean(item.id, 200), type: clean(item.type, 100), status: clean(item.status, 50),
      ...(typeof item.command === 'string' ? { command: clean(item.command, 2000) } : {}),
      ...(Number.isInteger(item.exit_code) ? { exit_code: item.exit_code } : {}),
      ...(item.failure ? { failure: clean(item.failure, 1000) } : {}),
      ...((item.testTotals || testTotals(item.command, item.output)) ? { testTotals: item.testTotals || testTotals(item.command, item.output) } : {}),
      ...(Array.isArray(item.changes) ? { changes: item.changes.slice(0, 50).map(c => ({ path: clean(c.path, 1000), kind: clean(c.kind, 30) })) } : {}),
      ...(typeof item.output === 'string' ? { output: item.output.slice(-4000) } : {}) } } : {}) });
}
