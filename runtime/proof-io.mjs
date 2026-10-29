// SPDX-License-Identifier: Apache-2.0
// Shared bounded, read-only evidence access for the Node proof pack.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isFinderMetadata, within } from './util.mjs';

export class ProofInputError extends Error {}
export const dictionary = () => Object.create(null);
export const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const clean = (v, limit = 200) => {
  const s = String(v ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length <= limit ? s : s.slice(0, limit - 1) + '…';
};
export const slash = value => value.split(path.sep).join('/');
export const utc = seconds => new Date((seconds ?? 0) * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
export const SHA256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function stat(file) { try { return fs.lstatSync(file); } catch { return null; } }
export function realDirectory(file) { const s = stat(file); return Boolean(s?.isDirectory() && !s.isSymbolicLink()); }
const directoryEntries = file => fs.readdirSync(file).filter(n => !isFinderMetadata(n)).sort();

export class EvidenceIO {
  constructor(workspace) {
    try { this.root = fs.realpathSync(workspace); } catch { throw new ProofInputError('Workspace does not exist'); }
    if (!realDirectory(this.root)) throw new ProofInputError('Workspace must be a directory');
    this.roots = [this.root]; this.problems = []; this.bytes = 0;
    this.cache = new Map(); this.observed = new Map(); this.directories = new Map(); this.metadata = new Map(); this.legacyBindings = new Map();
  }
  gap(message) { const value = clean(message, 500); if (!this.problems.includes(value)) this.problems.push(value); }
  watch(file) {
    try {
      this.resolve(file); const s = stat(file); if (!s) return;
      if (!this.metadata.has(file)) this.metadata.set(file, s.isDirectory()
        ? { ino: s.ino, dev: s.dev, entries: directoryEntries(file) }
        : { size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs, ino: s.ino, dev: s.dev });
    } catch (e) { this.gap(e.message); }
  }
  resolve(value, root = this.root) {
    if (typeof value !== 'string' || !value || value.includes('\0')) throw new ProofInputError('Invalid evidence path');
    const file = path.resolve(root, value), scope = this.roots.find(r => within(r, file));
    if (isFinderMetadata(file)) throw new ProofInputError('Finder metadata is excluded from evidence');
    if (!scope) throw new ProofInputError('Evidence path leaves the workspace');
    let cur = scope;
    for (const part of path.relative(scope, file).split(path.sep).filter(Boolean)) {
      cur = path.join(cur, part);
      if (stat(cur)?.isSymbolicLink()) throw new ProofInputError(`Symbolic link in evidence path: ${clean(slash(path.relative(scope, cur)))}`);
    }
    return file;
  }
  inside(value, root = this.root) { try { return this.resolve(value, root); } catch (e) { this.gap(e.message); return null; } }
  // The established layout permits exactly the legacy/<system> entry to point at
  // an external original checkout. It is read-only; links below that root are skipped.
  legacy(system) {
    const parent = this.resolve('legacy');
    const entry = path.join(parent, system);
    if (!stat(entry)) return null;
    let root;
    try { root = fs.realpathSync(entry); } catch { this.gap('Legacy source cannot be resolved'); return null; }
    if (!realDirectory(root)) return null;
    if (!this.legacyBindings.has(entry)) this.legacyBindings.set(entry, { root, ino: stat(entry).ino, dev: stat(entry).dev });
    if (!this.roots.includes(root)) this.roots.push(root);
    return root;
  }
  read(value, cap = 8 << 20) {
    const file = this.resolve(value), cached = this.cache.get(file);
    if (cached) {
      if (cached.length > cap) throw new ProofInputError(`${clean(path.basename(file))} exceeds its size limit`);
      return cached;
    }
    let fd;
    try {
      const expected = stat(file);
      if (!expected?.isFile() || expected.size > cap) throw new ProofInputError(`${clean(path.basename(file))} is not a regular file or exceeds ${cap} bytes`);
      fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
      const before = fs.fstatSync(fd);
      this.resolve(file);
      if (before.ino !== expected.ino || before.dev !== expected.dev) throw new ProofInputError('Evidence path changed while being opened');
      if (!before.isFile() || before.size > cap) throw new ProofInputError(`${clean(path.basename(file))} is not a regular file or exceeds ${cap} bytes`);
      if (this.bytes + before.size > 512 * 1024 * 1024) throw new ProofInputError('Evidence exceeds the 512 MiB read budget');
      const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd);
      if (bytes.length !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
        throw new ProofInputError('Evidence changed while being read');
      this.bytes += bytes.length; this.cache.set(file, bytes);
      this.observed.set(file, { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs,
        ino: before.ino, dev: before.dev, sha256: SHA256(bytes) });
      return bytes;
    } catch (e) { throw e instanceof ProofInputError ? e : new ProofInputError(`Cannot read ${clean(path.basename(file))}: ${e.code ?? e.name}`); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  text(file, cap = 8 << 20) {
    if (!stat(file)) return null;
    try { const bytes = this.read(file, cap); return bytes.subarray(0, 4096).includes(0) ? null : bytes.toString('utf8').replace(/^\uFEFF/, ''); }
    catch (e) { this.gap(e.message); return null; }
  }
  json(file, cap = 8 << 20) {
    if (!stat(file)) return [null, null];
    try { return [JSON.parse(this.read(file, cap).toString('utf8').replace(/^\uFEFF/, '')), null]; }
    catch (e) { const message = `${clean(path.basename(file))} could not be read as JSON: ${clean(e.message, 150)}`; this.gap(message); return [null, message]; }
  }
  walk(root, { skipDirs = new Set(), hidden = true, maxFiles = 200000, maxDepth = 60 } = {}) {
    const files = []; let links = 0, cut = false;
    const visit = (dir, depth) => {
      if (depth > maxDepth) { cut = true; this.gap('Evidence directory depth exceeds 60'); return; }
      let names;
      try {
        this.resolve(dir); const s = stat(dir);
        if (this.directories.size >= 200000) throw new ProofInputError('Evidence exceeds 200000 directories');
        names = directoryEntries(dir);
        if (!this.directories.has(dir)) this.directories.set(dir, { entries: names, ino: s.ino, dev: s.dev });
      }
      catch (e) { this.gap(`Cannot walk ${clean(path.basename(dir))}: ${e.code ?? e.message}`); cut = true; return; }
      for (const n of names) {
        if (isFinderMetadata(n)) continue;
        if (hidden && n.startsWith('.')) continue;
        const full = path.join(dir, n), s = stat(full);
        if (!s) { cut = true; this.gap('A path disappeared during the evidence scan'); continue; }
        if (s.isSymbolicLink()) { links++; continue; }
        if (s.isDirectory()) { if (!skipDirs.has(n)) visit(full, depth + 1); }
        else if (s.isFile()) {
          if (files.length >= maxFiles) { cut = true; return; }
          files.push([slash(path.relative(root, full)), full]);
        }
        if (files.length >= maxFiles && cut) return;
      }
    };
    try { this.resolve(root); if (realDirectory(root)) visit(root, 0); }
    catch (e) { cut = true; this.gap(e.message); }
    if (cut) this.gap('Evidence scan could not finish; its partial results cannot prove completeness');
    return { files, links, cut };
  }
  unchanged() {
    for (const [entry, before] of this.legacyBindings) {
      try {
        this.resolve(path.dirname(entry)); const s = stat(entry);
        if (!s || s.ino !== before.ino || s.dev !== before.dev || fs.realpathSync(entry) !== before.root) throw new Error('Legacy binding changed');
      } catch { this.gap('The legacy source entry changed during verification'); }
    }
    for (const [file, before] of this.metadata) {
      let s;
      try { this.resolve(file); s = stat(file); } catch { /* Record below. */ }
      let changed = !s || (before.entries ? !s.isDirectory() || ['ino', 'dev'].some(k => s[k] !== before[k])
        : ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some(k => s[k] !== before[k]));
      if (!changed && before.entries) {
        try { changed = JSON.stringify(directoryEntries(file)) !== JSON.stringify(before.entries); } catch { changed = true; }
      }
      if (changed) this.gap(`Evidence metadata changed during verification: ${clean(slash(path.relative(this.root, file)), 250)}`);
    }
    for (const [dir, before] of this.directories) {
      let s;
      try { this.resolve(dir); s = stat(dir); } catch { /* Record below. */ }
      let changed = !s?.isDirectory() || ['ino', 'dev'].some(k => s[k] !== before[k]);
      if (!changed) {
        try { changed = JSON.stringify(directoryEntries(dir)) !== JSON.stringify(before.entries); } catch { changed = true; }
      }
      if (changed) this.gap(`Evidence directory changed during verification: ${clean(slash(path.relative(this.root, dir)), 250)}`);
    }
    for (const [file, before] of this.observed) {
      let s;
      try { this.resolve(file); s = stat(file); } catch { /* Record below. */ }
      if (!s?.isFile() || ['size', 'mtimeMs', 'ctimeMs', 'ino', 'dev'].some(k => s[k] !== before[k]))
        this.gap(`Evidence changed during verification: ${clean(slash(path.relative(this.root, file)), 250)}`);
    }
    return this.problems.length === 0;
  }
}
