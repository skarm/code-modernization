// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceIO, stat } from '../proof-io.mjs';
import { invariant, isFinderMetadata, name, relative, within, redact } from '../util.mjs';

export const privatePath = value => String(value).split(/[\\/]/).some(part =>
  /^secrets?(?:[._-]|$)|^\.env(?:[._-]|$)|\.local\.|^(?:auth\.json|credentials(?:\.[\w-]+)?|id_rsa|id_ed25519|\.netrc|\.npmrc|\.ssh|\.aws)$|\.(?:pem|key|p12|pfx)$/i.test(part));

export function uiRedact(value) {
  if (typeof value === 'string') return redact(value)
    .replace(/("(?:password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)"\s*:\s*)"(?:[^"\\\r\n]|\\.)*"/gi, '$1"[REDACTED]"')
    .replace(/('(?:password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)'\s*:\s*)'(?:[^'\\\r\n]|\\.)*'/gi, "$1'[REDACTED]'");
  if (Array.isArray(value)) return value.map(uiRedact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, /^(?:password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|authorization)$/i.test(key) ? '[REDACTED]' : uiRedact(child)]));
  return value;
}

/** Narrow adapter for the original pure readers. No subprocesses or project JavaScript. */
export class WorkspaceFiles {
  constructor(workspace, cache = null) { this.io = new EvidenceIO(workspace); this.root = this.io.root; this.entries = 0; this.cache = cache; }
  resolve(value) {
    invariant(typeof value === 'string' && !privatePath(value), 'Private files are excluded from the interface');
    invariant(!isFinderMetadata(value), 'Finder metadata is excluded from the interface');
    const file = path.resolve(this.root, value);
    invariant(within(this.root, file), 'Path leaves workspace');
    const parts = path.relative(this.root, file).split(path.sep);
    if (parts[0] === 'legacy' && parts.length >= 2) {
      name(parts[1]);
      let legacy = this.io.legacy(parts[1]);
      if (!legacy) {
        const reference = this.io.text(path.join(this.root, 'analysis', parts[1], 'SOURCE'), 16000)?.trim();
        if (reference && path.isAbsolute(reference)) {
          const real = fs.realpathSync(reference);
          if (stat(real)?.isDirectory() && !stat(real).isSymbolicLink()) {
            legacy = real; if (!this.io.roots.includes(real)) this.io.roots.push(real);
          }
        }
      }
      invariant(legacy, 'Legacy source is unavailable');
      return this.io.resolve(path.join(legacy, ...parts.slice(2)));
    }
    return this.io.resolve(file);
  }
  async exists(value) { try { return Boolean(stat(this.resolve(value))); } catch (e) { if (/Symbolic link|leaves the workspace/.test(e.message)) this.io.gap(e.message); return false; } }
  async stat(value) {
    const s = stat(this.resolve(value)); invariant(s, 'File is missing');
    return { kind: s.isFile() ? 'file' : s.isDirectory() ? 'dir' : 'other', size: s.size, mtimeMs: s.mtimeMs };
  }
  async list(value) {
    const file = this.resolve(value);
    if (!stat(file)?.isDirectory()) return [];
    const entries = (await fsp.readdir(file, { withFileTypes: true })).filter(e => !isFinderMetadata(e.name));
    this.entries += entries.length;
    invariant(this.entries <= 200000, 'Interface scan exceeds 200000 entries');
    const visible = entries.filter(e => !privatePath(e.name)).sort((a, b) => a.name.localeCompare(b.name, 'en')), out = [];
    for (let at = 0; at < visible.length; at += 64) out.push(...await Promise.all(visible.slice(at, at + 64).map(async e => {
      const s = await fsp.lstat(path.join(file, e.name)).catch(() => null);
      return { name: e.name, kind: s?.isFile() ? 'file' : s?.isDirectory() ? 'dir' : 'other', size: s?.size ?? 0, mtimeMs: s?.mtimeMs ?? 0, isLink: s?.isSymbolicLink() ?? e.isSymbolicLink() };
    })));
    return out;
  }
  async read(value) {
    let handle;
    try {
      const file = this.resolve(value);
      invariant(this.io.bytes < 64 * 1024 * 1024, 'Interface snapshot exceeds its read budget');
      const s = await fsp.lstat(file), signature = `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`;
      invariant(s.isFile() && s.size <= 4 * 1024 * 1024, 'Interface file is not regular or exceeds 4 MiB');
      invariant(this.io.bytes + s.size <= 64 * 1024 * 1024, 'Interface snapshot exceeds its read budget');
      this.io.bytes += s.size;
      let bytes = this.cache?.get(file, signature);
      if (!bytes) {
        handle = await fsp.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
        const before = await handle.stat(); this.resolve(value);
        invariant(before.isFile() && before.ino === s.ino && before.dev === s.dev && before.size === s.size && before.size <= 4 * 1024 * 1024, 'Interface path changed while opening');
        bytes = Buffer.alloc(before.size); let offset = 0;
        while (offset < bytes.length) { const read = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset); if (!read.bytesRead) break; offset += read.bytesRead; }
        const after = await handle.stat();
        invariant(offset === before.size && before.size === after.size && before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs, 'Interface file changed while reading');
        this.cache?.set(file, signature, bytes);
      }
      invariant(!bytes.subarray(0, 4096).includes(0), 'Binary file is not displayed');
      return bytes.toString('utf8').replace(/^\uFEFF/, '');
    } catch (e) { this.io.gap(e.message); throw e; } finally { await handle?.close(); }
  }
  async optional(value) { if (!await this.exists(value)) return null; return this.read(value); }
  async json(value) { const text = await this.optional(value); return text === null ? null : JSON.parse(text); }
}

export class ReadCache {
  constructor(maxBytes = 16 * 1024 * 1024) { this.maxBytes = maxBytes; this.values = new Map(); this.bytes = 0; this.hits = 0; }
  get(file, signature) { const hit = this.values.get(file); if (hit?.signature !== signature) return null; this.hits++; this.values.delete(file); this.values.set(file, hit); return hit.bytes; }
  set(file, signature, bytes) {
    const old = this.values.get(file); if (old) this.bytes -= old.bytes.length;
    this.values.delete(file); this.values.set(file, { signature, bytes }); this.bytes += bytes.length;
    while (this.bytes > this.maxBytes && this.values.size) { const key = this.values.keys().next().value; this.bytes -= this.values.get(key).bytes.length; this.values.delete(key); }
  }
}

/** Fixed artifact outputs only. Parent directories, links and hardlinks are checked. */
export function outputPath(files, rel) {
  relative(rel); const target = files.resolve(rel), parent = path.dirname(target);
  invariant(stat(parent)?.isDirectory(), 'Analysis directory is missing');
  const before = stat(target);
  invariant(!before || before.isFile() && before.nlink === 1, 'Output must be an ordinary, unshared file');
  return target;
}
export function atomicText(files, rel, text) {
  const target = outputPath(files, rel), parent = path.dirname(target);
  const tmp = path.join(parent, `.ui-${randomUUID()}.tmp`);
  try {
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    files.resolve(rel); fs.renameSync(tmp, target);
  } finally { fs.rmSync(tmp, { force: true }); }
}
