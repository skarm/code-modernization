// SPDX-License-Identifier: Apache-2.0
import * as fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const isFinderMetadata = value => String(value).split(/[\\/]/).includes('.DS_Store');

export function invariant(condition, message) {
  if (!condition) throw new Error(message);
}
export function object(value, name = 'value') {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`);
  return value;
}
export function text(value, name, max = 100000) {
  invariant(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0'), `${name} must be non-empty text (max ${max})`);
  return value;
}
export function integer(value, fallback, min, max, name) {
  const n = value === undefined ? fallback : value;
  invariant(Number.isSafeInteger(n) && n >= min && n <= max, `${name} must be an integer in ${min}..${max}`);
  return n;
}
export function name(value, label = 'name') {
  invariant(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,119}$/.test(value) && !value.endsWith('.'), `${label} must be a plain identifier`);
  return value;
}
export function relative(value, label = 'path', allowDot = false) {
  text(value, label, 2000);
  const p = value.replaceAll('\\', '/');
  invariant(!/^[A-Za-z]:|^\//.test(p) && !/[\x00-\x1f\x7f]/.test(p), `${label} must be relative and contain no control characters`);
  if (allowDot && p === '.') return p;
  invariant(p.split('/').every(s => s && s !== '.' && s !== '..' && !/[. ]$/.test(s) && !s.includes(':')), `${label} has unsafe path segments`);
  return p;
}
export function within(root, file) {
  const rel = path.relative(root, file);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
export function overlaps(a, b) {
  // Conservatively reject case aliases even on case-sensitive hosts.
  const x = path.resolve(a).toLowerCase(), y = path.resolve(b).toLowerCase();
  return within(x, y) || within(y, x);
}
export function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
export function hash(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
}
export async function exists(file) {
  try { await fs.lstat(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}
export async function realDirectory(file) {
  const real = await fs.realpath(file);
  invariant((await fs.stat(real)).isDirectory(), `${file} is not a directory`);
  return real;
}
export async function safeResolve(root, rel, { directory = false, noLinks = false } = {}) {
  const spelling = path.join(root, relative(rel));
  const real = await fs.realpath(spelling);
  invariant(within(root, real), `Path escapes scope: ${rel}`);
  if (noLinks) {
    let part = root;
    for (const segment of relative(rel).split('/')) {
      part = path.join(part, segment);
      invariant(!(await fs.lstat(part)).isSymbolicLink(), `Symlink not allowed in writable path: ${rel}`);
    }
  }
  if (directory) invariant((await fs.stat(real)).isDirectory(), `Not a directory: ${rel}`);
  return real;
}
export async function resolveCandidate(workspace, value) {
  const root = await realDirectory(workspace);
  const modernized = await safeResolve(root, 'modernized', { directory: true, noLinks: true });
  const spelling = path.resolve(root, text(value, 'candidate'));
  const real = await realDirectory(spelling);
  invariant(within(modernized, real) && real !== modernized, 'Candidate must be a system directory under workspace/modernized');
  // Check the original path too: realpath alone erases links inside modernized.
  // Stop at the resolved root so platform aliases such as /var -> /private/var work.
  let part = spelling;
  while (await fs.realpath(part) !== modernized) {
    invariant(!(await fs.lstat(part)).isSymbolicLink(), `Symlink not allowed in candidate path: ${part}`);
    const parent = path.dirname(part);
    invariant(parent !== part, 'Candidate path does not descend from modernized');
    part = parent;
  }
  return real;
}
export async function safeMkdir(root, rel) {
  let part = root;
  for (const segment of relative(rel).split('/')) {
    part = path.join(part, segment);
    try { await fs.mkdir(part, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    const st = await fs.lstat(part);
    invariant(st.isDirectory() && !st.isSymbolicLink(), `Unsafe output directory: ${part}`);
  }
  return part;
}
export async function readJSON(file, maxBytes = 16 * 1024 * 1024) {
  const st = await fs.stat(file);
  invariant(st.isFile() && st.size <= maxBytes, `JSON input too large or not a file: ${file}`);
  return JSON.parse(await fs.readFile(file, 'utf8'));
}
export async function atomicJSON(file, value) {
  if (await exists(file)) {
    const st = await fs.lstat(file);
    invariant(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `Unsafe state file: ${file}`);
  }
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    try {
      await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally { await handle.close(); }
    await fs.rename(tmp, file);
  } finally { await fs.rm(tmp, { force: true }); }
}
export async function fileHash(file) {
  const h = createHash('sha256');
  for await (const data of createReadStream(file)) h.update(data);
  return h.digest('hex');
}
export async function snapshot(root, { writable = false, limit = 100000, exclude = [] } = {}) {
  const excluded = new Set(exclude.map(p => relative(p, 'excluded directory')));
  for (const rel of excluded) await safeResolve(root, rel, { directory: true, noLinks: true });
  const h = createHash('sha256');
  let files = 0, bytes = 0, links = 0;
  async function walk(dir, prefix) {
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (entry.name === '.git' || isFinderMetadata(entry.name)) continue;
      const full = path.join(dir, entry.name), rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const st = await fs.lstat(full);
      invariant(++files <= limit, `Snapshot exceeds ${limit} entries; reduce approved scope`);
      if (excluded.has(rel)) {
        invariant(st.isDirectory() && !st.isSymbolicLink(), `Unsafe excluded directory: ${rel}`);
        h.update(stable([rel, 'owned-directory']));
        continue;
      }
      if (st.isSymbolicLink()) {
        invariant(!writable, `Writable tree contains symlink: ${rel}; use a safe independent copy`);
        links++;
        h.update(stable([rel, 'link', await fs.readlink(full)]));
      } else if (st.isDirectory()) {
        h.update(stable([rel, 'directory', st.mode & 0o777]));
        await walk(full, rel);
      } else if (st.isFile()) {
        invariant(!writable || st.nlink === 1, `Writable tree contains a hard-linked file: ${rel}`);
        bytes += st.size;
        h.update(stable([rel, st.mode & 0o777, st.size, await fileHash(full)]));
      } else throw new Error(`Special file is not supported: ${rel}`);
    }
  }
  await walk(root, '');
  return { sha256: h.digest('hex'), entries: files, bytes, symlinks: links,
    excluded: ['.git', '.DS_Store', ...[...excluded].sort()], symlinkTargetsHashed: false };
}
export function redact(value) {
  if (typeof value === 'string') return value
    .replace(/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g, '[REDACTED TOKEN]')
    .replace(/(\b(?:authorization\s*[:=]\s*bearer|api[_-]?key\s*[:=]|password\s*[:=]|secret\s*[:=])\s*["']?)[^\s"',;]+/gi, '$1[REDACTED]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v)]));
  return value;
}

/** Validator for the deliberately small JSON Schema subset used by this package. */
export function validate(schema, value, at = '$') {
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'description', 'minimum', 'maximum', 'minItems', 'maxItems']);
  for (const key of Object.keys(schema)) invariant(allowed.has(key), `Unsupported schema keyword: ${key}`);
  if (Array.isArray(schema.type)) {
    invariant(schema.type.length > 0 && schema.type.every(t => typeof t === 'string'), 'Invalid schema type union');
    const matching = schema.type.find(t => t === 'null' ? value === null : t === 'integer' ? Number.isSafeInteger(value) : t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === t);
    invariant(matching !== undefined, `${at} must be ${schema.type.join(' or ')}`);
    return validate({ ...schema, type: matching }, value, at);
  }
  if (schema.enum) invariant(schema.enum.includes(value), `${at} is not an allowed enum value`);
  if (schema.type === 'object') {
    object(value, at);
    for (const key of schema.required ?? []) invariant(Object.hasOwn(value, key), `${at}.${key} is required`);
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) validate(schema.properties[key], child, `${at}.${key}`);
      else invariant(schema.additionalProperties !== false, `${at}.${key} is unexpected`);
    }
  } else if (schema.type === 'array') {
    invariant(Array.isArray(value), `${at} must be an array`);
    invariant(value.length >= (schema.minItems ?? 0) && value.length <= (schema.maxItems ?? 10000), `${at} has invalid length`);
    value.forEach((v, i) => validate(schema.items, v, `${at}[${i}]`));
  } else if (schema.type === 'integer' || schema.type === 'number') {
    invariant(Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)), `${at} must be ${schema.type}`);
    invariant(value >= (schema.minimum ?? -Infinity) && value <= (schema.maximum ?? Infinity), `${at} is out of range`);
  } else if (schema.type === 'null') invariant(value === null, `${at} must be null`);
  else invariant(typeof value === schema.type, `${at} must be ${schema.type}`);
  return value;
}
export function unique(items, key) {
  const seen = new Set();
  return items.filter(item => { const k = key(item); if (seen.has(k)) return false; seen.add(k); return true; });
}

export async function appendPrivateJSONL(file, value) {
  // Reject pre-existing symlinks and hardlinks; O_NOFOLLOW closes the symlink race on POSIX.
  if (await exists(file)) {
    const st = await fs.lstat(file);
    invariant(st.isFile() && !st.isSymbolicLink() && st.nlink === 1, `Unsafe event log: ${file}`);
  }
  const constants = (await import('node:fs')).constants;
  const handle = await fs.open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const st = await handle.stat();
    invariant(st.isFile() && st.nlink === 1, 'Event log must be an ordinary, unshared file');
    await handle.write(`${JSON.stringify(value)}\n`);
  } finally { await handle.close(); }
}
