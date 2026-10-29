// SPDX-License-Identifier: Apache-2.0
// Node port of upstream uplift_checks.py (c8874f5ad883), Apache-2.0.
import path from 'node:path';
import { clean, realDirectory, SHA256 } from './proof-io.mjs';
import { fileKind, SKIP_DIRS } from './proof-rules.mjs';
import { mdTables } from './proof-results.mjs';

const SILENT = /behaviou?ral[\s_-]*silent|silent[\s_-]*behaviou?ral/i;
const CONFIG = new Set(['xml', 'yml', 'yaml', 'json', 'properties', 'gradle', 'toml', 'ini', 'cfg']);
const CODE = new Set('java kt kts scala groovy cs vb fs py js jsx ts tsx mjs cjs go rs rb php c h cc cpp hpp swift m sql cbl cob cpy jcl pl pm sh ps1 xml yml yaml json properties gradle toml ini cfg'.split(' '));
export function walkTests(io, root) {
  if (!root || !realDirectory(root)) return { files: new Map(), cut: false, links: 0 };
  const walked = io.walk(root, { skipDirs: SKIP_DIRS, maxFiles: 200000 });
  const tests = walked.files.filter(([r]) => fileKind(r) === 'test');
  if (tests.length > 60000) io.gap('More than 60000 test files');
  return { files: new Map(tests.slice(0, 60000)), cut: walked.cut || tests.length > 60000, links: walked.links };
}
const lines = b => b.toString('utf8').replace(/\r\n?/g, '\n').split('\n');
// Same longest-contiguous-block selection as difflib.SequenceMatcher(autojunk=False).
// Only diagnostic line counts use it; whether test contents changed is byte-derived.
function matchingLines(a, b) {
  const positions = new Map(); b.forEach((line, j) => { if (!positions.has(line)) positions.set(line, []); positions.get(line).push(j); });
  const queue = [[0, a.length, 0, b.length]]; let matched = 0;
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop(); let bestI = alo, bestJ = blo, best = 0, lengths = new Map();
    for (let i = alo; i < ahi; i++) {
      const next = new Map();
      for (const j of positions.get(a[i]) ?? []) {
        if (j < blo) continue; if (j >= bhi) break;
        const n = (lengths.get(j - 1) ?? 0) + 1; next.set(j, n);
        if (n > best) { bestI = i - n + 1; bestJ = j - n + 1; best = n; }
      }
      lengths = next;
    }
    if (!best) continue; matched += best;
    if (alo < bestI && blo < bestJ) queue.push([alo, bestI, blo, bestJ]);
    if (bestI + best < ahi && bestJ + best < bhi) queue.push([bestI + best, ahi, bestJ + best, bhi]);
  }
  return matched;
}
function lineDiff(a, b, budget) {
  if (a.length <= 4000 && b.length <= 4000 && a.length * b.length <= budget) { const n = matchingLines(a, b); return [b.length - n, a.length - n, true, budget - a.length * b.length]; }
  const ca = new Map(), cb = new Map(); for (const s of a) ca.set(s, (ca.get(s) ?? 0) + 1); for (const s of b) cb.set(s, (cb.get(s) ?? 0) + 1);
  return [[...cb].reduce((n, [s, k]) => n + Math.max(0, k - (ca.get(s) ?? 0)), 0), [...ca].reduce((n, [s, k]) => n + Math.max(0, k - (cb.get(s) ?? 0)), 0), false, budget];
}
export function testsChanged(io, legacyRoot, workRoot) {
  const out = { checked: false, why: '', legacyTests: 0, workTests: 0, counts: { added: 0, removed: 0, changed: 0 }, added: [], removed: [], changed: [], share: 0, gap: false, cut: false };
  if (!legacyRoot || !realDirectory(legacyRoot)) return { ...out, why: 'the legacy tree was not found, so its test files could not be compared' };
  if (!workRoot || !realDirectory(workRoot)) return { ...out, why: 'the working copy was not found' };
  const old = walkTests(io, legacyRoot), current = walkTests(io, workRoot); let budget = 300000000;
  Object.assign(out, { checked: true, legacyTests: old.files.size, workTests: current.files.size, cut: old.cut || current.cut });
  const removed = [...old.files.keys()].filter(k => !current.files.has(k)).sort(), added = [...current.files.keys()].filter(k => !old.files.has(k)).sort();
  const lineCount = file => { try { const b = io.read(file, 64 << 20); return b.subarray(0, 8192).includes(0) ? 0 : lines(b.subarray(0, 2 << 20)).length; } catch (e) { io.gap(e.message); return 0; } };
  for (const rel of [...old.files.keys()].filter(k => current.files.has(k)).sort()) {
    let a, b, change = null;
    try {
      a = io.read(old.files.get(rel), 64 << 20); b = io.read(current.files.get(rel), 64 << 20);
      if (a.length > 2 << 20 || b.length > 2 << 20) { if (SHA256(a) !== SHA256(b)) change = { added: 0, removed: 0, note: 'large file, lines not counted' }; }
      else if (a.subarray(0, 8192).includes(0) || b.subarray(0, 8192).includes(0)) { if (!a.equals(b)) change = { added: 0, removed: 0, note: 'binary file' }; }
      else { const la = lines(a), lb = lines(b); if (la.length !== lb.length || la.some((s, i) => s !== lb[i])) { const [plus, minus, exact, left] = lineDiff(la, lb, budget); budget = left; change = { added: plus, removed: minus, note: exact ? '' : 'lines counted approximately' }; } }
    } catch (e) { io.gap(e.message); change = { added: 0, removed: 0, note: 'could not be read' }; }
    if (change) out.changed.push({ ...change, path: clean(rel, 300) });
  }
  out.counts = { added: added.length, removed: removed.length, changed: out.changed.length };
  out.changed.sort((a, b) => (b.added + b.removed) - (a.added + a.removed) || a.path.localeCompare(b.path)); out.changed = out.changed.slice(0, 40);
  out.added = added.slice(0, 40).map(r => ({ path: clean(r, 300), lines: lineCount(current.files.get(r)) })); out.removed = removed.slice(0, 40).map(r => ({ path: clean(r, 300), lines: lineCount(old.files.get(r)) }));
  out.share = old.files.size ? Math.round(out.counts.changed / old.files.size * 10000) / 10000 : 0;
  out.gap = removed.length > 0 || !old.files.size || out.counts.changed > 0.25 * old.files.size || out.cut;
  if (!old.files.size) out.why = 'the legacy tree has no test files, so nothing shows the tests were kept';
  return out;
}
function sitesIn(text) {
  const out = [];
  for (const m of text.slice(0, 4000).matchAll(/((?:[\p{L}\p{N}_.$@+-]{1,80}\/){0,12})([A-Za-z_$][\p{L}\p{N}_$-]{0,80})((?:\.[A-Za-z][A-Za-z0-9]{0,7}){1,3})(?::(\d{1,7}))?/gu)) {
    const ext = m[3].split('.').at(-1).toLowerCase(), stem = m[2], p = clean(m[1] + stem + m[3], 200);
    if (stem.length < 2 || (!m[4] && !CODE.has(ext)) || out.some(s => s.path === p)) continue;
    out.push({ path: p, stem, line: Number(m[4] ?? 0), ext });
  }
  return out.slice(0, 20);
}
const normId = text => text.replace(/[\s*`#.]+/g, '').toLowerCase().slice(0, 40);
export function parseDeltas(text) {
  const found = new Map();
  const add = (id, title, category, sites) => {
    const key = normId(id); if (!key || (found.size >= 2000 && !found.has(key))) return;
    if (!found.has(key)) found.set(key, { id: clean(id.replaceAll('*', '').trim(), 40), title: '', category: '', sites: [] });
    const d = found.get(key);
    d.title ||= clean(title, 200); d.category ||= clean(category, 80); for (const s of sites) if (!d.sites.some(o => o.path === s.path)) d.sites.push(s); d.sites = d.sites.slice(0, 20);
  };
  for (const [, header, rows] of mdTables(text.slice(0, 8 << 20))) {
    const low = header.map(h => h.toLowerCase()), cat = low.findIndex(h => /\bcat/.test(h)); if (cat < 0) continue;
    const idAt = low.findIndex(h => /^(id|#|no\.?|delta|card|ref)$/.test(h.trim())), id = idAt < 0 ? 0 : idAt;
    const title = low.findIndex((h, i) => /delta|title|name|change|summary|\bold\b/.test(h) && i !== id), siteCols = low.flatMap((h, i) => /\bsites?\b|location|cited|file/.test(h) ? [i] : []);
    for (const row of rows.slice(0, 5000)) {
      if (cat >= row.length || id >= row.length || !row[id].trim()) continue;
      const cells = siteCols.length ? siteCols.filter(i => i < row.length && !/^\s*\d+\s*$/.test(row[i])).map(i => row[i]) : row.filter((_, i) => i !== cat && i !== id);
      add(row[id], title < 0 ? '' : row[title] ?? '', row[cat], sitesIn(cells.join(' ')));
    }
  }
  const ls = text.slice(0, 8 << 20).split('\n').map(l => l.slice(0, 4000));
  for (let i = 0; i < ls.length;) {
    const m = /^#{2,6}[ \t]+(?:\*\*)?((?:DELTA-|D-)?\d{1,4})(?:\*\*)?[.):\s][ \t]*(.*)$/i.exec(ls[i++]); if (!m) continue;
    let category = ''; const sites = [];
    while (i < ls.length && !ls[i].startsWith('#')) {
      const line = ls[i++], c = /categor[^:\n]{0,40}:\**[ \t]*(.{1,200})/i.exec(line); if (c && !category) category = c[1].split(/[/;]/)[0].replace(/^[ *`]+|[ *`]+$/g, '');
      const cited = /\bcited\s*:/i.exec(line) ?? /^[ \t>*-]*\**(?:sites?|location|source)\b[^:\n]{0,30}:/i.exec(line);
      if (cited) sites.push(...sitesIn(line.slice(cited.index + cited[0].length)));
    }
    if (category || found.has(normId(m[1]))) add(m[1], m[2], category, sites);
  }
  return [...found.values()];
}
export function deltaCoverage(io, text, workRoot) {
  const out = { parsed: 0, silent: 0, covered: [], uncovered: [], config: [], other: 0, testFiles: 0, gap: false, why: '' };
  if (text === null) return { ...out, gap: true, why: 'DELTA_CATALOG.md was not found' };
  const deltas = parseDeltas(text); out.parsed = deltas.length;
  if (!deltas.length) return { ...out, gap: true, why: 'No delta could be read from DELTA_CATALOG.md' };
  const words = new Set(); let total = 0;
  for (const [, file] of walkTests(io, workRoot).files) {
    const body = io.text(file, 2 << 20); if (body === null) continue;
    total += Buffer.byteLength(body); if (total > 400 << 20) { io.gap('Delta coverage exceeds the 400 MiB text budget'); break; }
    for (const m of body.matchAll(/[A-Za-z_$][\p{L}\p{N}_$]{0,200}/gu)) words.add(m[0]);
    // Both token sets are needed: the ordinary word regex otherwise consumes a
    // dashed file stem's first segment before the dashed alternative can match.
    for (const m of body.matchAll(/[A-Za-z0-9_$]{1,100}(?:-[A-Za-z0-9_$]{1,100}){1,8}/g)) words.add(m[0]);
    out.testFiles++;
  }
  for (const d of deltas) {
    if (!SILENT.test(d.category)) { out.other++; continue; } out.silent++;
    const code = d.sites.filter(s => !CONFIG.has(s.ext)), rec = { id: d.id, title: d.title, sites: d.sites.slice(0, 5).map(s => s.path + (s.line ? ':' + s.line : '')) };
    if (d.sites.length && !code.length) { out.config.push(rec); continue; }
    const missing = code.filter(s => !words.has(s.stem)).map(s => s.stem);
    if (code.length && !missing.length) out.covered.push(rec); else out.uncovered.push({ ...rec, why: !code.length ? 'no site is named in the catalog' : 'no test names ' + [...new Set(missing)].slice(0, 5).map(s => clean(s, 60)).join(', ') });
  }
  out.gap = out.uncovered.length > 0; return out;
}
