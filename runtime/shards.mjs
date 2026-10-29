// SPDX-License-Identifier: Apache-2.0
// Node adaptation of Anthropic's make_shards.py. Source is read, never executed.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { invariant, isFinderMetadata, relative, safeResolve, within } from './util.mjs';
import { WorkspaceFiles, atomicText } from './ui/files.mjs';

export const SOURCE_EXT = new Set(('.cbl .cob .cobol .cpy .pli .pl1 .jcl .proc .rpg .rpgle .sqlrpgle .clle .nat .ada .adb .ads .asm .bms .map .pas .dpr .prg .f .for .f90 .f77 .java .kt .scala .groovy .cs .vb .vbs .bas .cls .frm .fs .c .h .cc .cpp .cxx .hpp .m .mm .go .rs .py .rb .php .pl .pm .js .mjs .cjs .jsx .ts .mts .cts .tsx .swift .lua .tcl .erl .ex .exs .clj .hs .ml .r .sh .bat .ps1 .asp .aspx .ascx .cshtml .jsp .jspx .sql .pks .pkb .plsql .tf').split(' '));
const SKIP = new Set('.git .svn .hg node_modules vendor third_party thirdparty dist build target bin obj out __pycache__ .venv venv .tox .gradle .idea coverage fixtures testdata test-data generated'.split(' '));
const TEST = new Set('test tests __tests__ spec specs'.split(' '));
export const SHARD_LIMITS = { files: 25, loc: 5000, small: 300, tiny: 30, bytes: 5000000, inventory: 100000 };
export function matchesModule(value, pattern = '') {
  if (!pattern) return true;
  invariant(typeof pattern === 'string' && pattern.length <= 500 && !/[\x00-\x1f]/.test(pattern), 'Invalid module pattern');
  // fnmatch-style glob over the full path and basename, including directory separators.
  let glob = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') glob += '.*';
    else if (c === '?') glob += '.';
    else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end > i + 1) { const cls = pattern.slice(i + 1, end); glob += `[${cls.startsWith('!') ? '^' + cls.slice(1) : cls}]`; i = end; }
      else glob += '\\[';
    } else glob += c.replace(/[\\^$+?.()|{}\]]/g, '\\$&');
  }
  const re = new RegExp(glob + '$');
  if (re.test(value) || re.test(path.posix.basename(value))) return true;
  return !/[*?[]/.test(pattern) && (`/${value.replace(/^\/+|\/+$/g, '')}/`).includes(`/${pattern.replace(/^\/+|\/+$/g, '')}/`);
}
async function linesOf(source, rel) {
  const full = await safeResolve(source, relative(rel), { noLinks: true }), st = await fs.stat(full);
  invariant(st.isFile() && st.size <= SHARD_LIMITS.bytes, 'Oversized or non-file source');
  const bytes = await fs.readFile(full);
  invariant(!bytes.includes(0), 'Binary source');
  let lines = bytes.length && bytes.at(-1) !== 10 ? 1 : 0;
  for (const b of bytes) if (b === 10) lines++;
  return lines;
}
export async function sourceInventory(source, { includeAll = false } = {}) {
  source = await fs.realpath(source);
  const home = await fs.realpath(os.homedir());
  invariant(source.split(path.sep).filter(Boolean).length >= 2 && !within(source, home), 'Source directory is too broad');
  const files = [], skipped = { generated: 0, tests: 0, unreadable: 0, links: 0 }; let entries = 0;
  async function walk(dir = '') {
    for (const entry of (await fs.readdir(path.join(source, dir), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (isFinderMetadata(entry.name)) continue;
      invariant(++entries <= SHARD_LIMITS.inventory, 'Source inventory limit exceeded');
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { skipped.links++; continue; }
      if (entry.isDirectory()) {
        if (SKIP.has(entry.name.toLowerCase()) || entry.name.startsWith('.')) skipped.generated++;
        else if (!includeAll && TEST.has(entry.name.toLowerCase())) skipped.tests++;
        else await walk(rel);
      } else if (entry.isFile() && SOURCE_EXT.has(path.extname(entry.name).toLowerCase()) && !/\.min\.[cm]?js$/i.test(entry.name)) {
        if (!includeAll && /(?:^|[._-])(?:test|spec)\.[^.]+$/i.test(entry.name)) { skipped.tests++; continue; }
        try { files.push({ file: rel, loc: await linesOf(source, rel) }); } catch { skipped.unreadable++; }
      }
    }
  }
  await walk(); return { files, skipped };
}
function treeShards(files, pattern) {
  const groups = new Map();
  for (const entry of files.filter(f => matchesModule(f.file, pattern))) {
    const dir = path.posix.dirname(entry.file), group = groups.get(dir) ?? []; group.push(entry); groups.set(dir, group);
  }
  const shards = [];
  for (const [dir, entries] of groups) {
    let current, part = 0;
    for (const entry of entries) {
      if (!current || current.files.length >= SHARD_LIMITS.files || current.loc + entry.loc > SHARD_LIMITS.loc) {
        part++; current = { name: dir + (part > 1 ? `#${part}` : ''), domain: dir === '.' ? '' : dir, files: [], loc: 0 }; shards.push(current);
      }
      current.files.push(entry.file); current.loc += entry.loc;
    }
  }
  return shards;
}
async function topologyShards(topology, layout, inventory, pattern) {
  invariant(topology?.root && typeof topology.root === 'object', 'Topology has no root');
  const modules = [], names = new Set(), owned = new Set(), byFile = new Map(inventory.map(f => [f.file, f.loc]));
  function walk(node, domain = '', depth = 0) {
    invariant(depth <= 100 && modules.length <= SHARD_LIMITS.inventory, 'Topology limit exceeded');
    if (node.kind === 'domain') domain = String(node.name || node.id || '');
    if (node.kind === 'module' && node.file) {
      let rel = String(node.file).replaceAll('\\', '/');
      if (path.isAbsolute(rel)) { invariant(within(layout.source, rel), 'Topology location escapes source'); rel = path.relative(layout.source, rel); }
      rel = rel.replace(new RegExp(`^legacy/${layout.system.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '');
      relative(rel);
      invariant(byFile.has(rel) && !owned.has(rel), `Topology location is shared, missing, excluded or not a source file: ${rel}`);
      owned.add(rel);
      let label = String(node.name || node.id || rel);
      if (names.has(label)) label = String(node.id || `${domain}/${label}`);
      invariant(!names.has(label), 'Duplicate topology module identity'); names.add(label);
      if (matchesModule(label, pattern) || matchesModule(rel, pattern)) modules.push({ name: label, domain, files: [rel], loc: byFile.get(rel) });
    }
    invariant(node.children === undefined || Array.isArray(node.children), 'Invalid topology children');
    for (const child of node.children ?? []) walk(child, domain, depth + 1);
  }
  walk(topology.root);
  invariant(owned.size === inventory.length, 'Topology omits source files; using complete tree inventory');
  const shards = [], pools = new Map(), counters = new Map();
  for (const module of modules) {
    if (module.loc >= SHARD_LIMITS.small) { shards.push(module); continue; }
    let current = pools.get(module.domain);
    if (!current || current.loc >= SHARD_LIMITS.small || current.files.length >= SHARD_LIMITS.files) {
      const n = (counters.get(module.domain) ?? 0) + 1; counters.set(module.domain, n);
      current = { name: `${module.domain || 'misc'}:small-${n}`, domain: module.domain, files: [], loc: 0 }; pools.set(module.domain, current); shards.push(current);
    }
    current.files.push(...module.files); current.loc += module.loc;
  }
  return shards;
}
export async function makeShards(layout, { pattern = '', includeAll = false, write = true } = {}) {
  const { files, skipped } = await sourceInventory(layout.source, { includeAll });
  const notes = []; let modules, origin = 'tree';
  try {
    const topology = JSON.parse(await fs.readFile(await safeResolve(layout.analysis, 'topology.json', { noLinks: true }), 'utf8'));
    modules = await topologyShards(topology, layout, files, pattern); origin = 'topology';
  } catch (e) { if (e.code !== 'ENOENT') notes.push(`Topology fallback: ${e.message}`); }
  modules ??= treeShards(files, pattern);
  invariant(modules.length > 0, 'No source files match the module pattern; nothing written');
  const output = path.join(layout.analysis, 'extract-rules.modules.json');
  if (write) atomicText(new WorkspaceFiles(layout.workspace), `analysis/${layout.system}/extract-rules.modules.json`, JSON.stringify(modules, null, 2) + '\n');
  return { modules, output: write ? output : null, origin, sourceFiles: files.length, tinyEstate: files.length < SHARD_LIMITS.tiny, skipped, notes };
}
