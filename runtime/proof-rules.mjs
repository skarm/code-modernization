// SPDX-License-Identifier: Apache-2.0
// Node port of upstream trace_rules.py (c8874f5ad883), Apache-2.0.
import path from 'node:path';
import fs from 'node:fs';
import { clean, dictionary, realDirectory, ProofInputError } from './proof-io.mjs';

export const SKIP_DIRS = new Set(['target', 'build', 'dist', 'node_modules', 'bin', 'obj', '__pycache__', 'venv']);
export const DOC_EXT = new Set(['.md', '.markdown', '.rst', '.txt', '.adoc']);
export const NOTE_NAMES = ['TRANSFORMATION_NOTES.md', 'UPLIFT_NOTES.md'];
export const NOT_RUN = 'named, not run';
export const NO_RUN = { known: false, ids: new Set(), keys: new Set() };
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec', 'specs']);
const TEST_NAME = /^test_|_tests?\.[^.]+$|\.(?:spec|test)\.[^.]+$|(?:Test|Tests|TestCase|IT)\.[^.]+$|^Test[A-Z0-9_]/;
const PATH = /[A-Za-z0-9_@][A-Za-z0-9_@./+-]{0,199}\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9_])/g;
const SKIPPED = /@Disabled|@Ignore|\[Ignore\]|#\[ignore\]|xit\(|xdescribe|skip|pending|todo/i;
const TOOLING = new Set(['pom.xml', 'mvnw', 'mvnw.cmd', 'gradlew', 'gradlew.bat', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'gradle.properties',
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'pytest.ini', 'tox.ini', 'setup.cfg', 'pyproject.toml', 'uv.lock', 'poetry.lock', 'conftest.py',
  'cargo.toml', 'cargo.lock', 'go.mod', 'go.sum', 'composer.json', 'composer.lock', 'phpunit.xml', 'phpunit.xml.dist', 'cmakelists.txt', 'makefile', 'dockerfile']);
export function findIds(text) {
  const found = [];
  for (const rx of [/(?<![A-Za-z0-9])rule[-_](\d{1,6})(?!\d)/gi, /(?<![A-Za-z0-9])rule(\d{3,6})(?!\d)/gi, /(?<=[a-z])Rule[-_]?(\d{3,6})(?!\d)/g]) {
    for (const m of text.matchAll(rx)) {
      found.push([Number(m[1]), m.index]); let pos = m.index + m[0].length, more;
      while ((more = /^(?:\/|,[ \t]*-)(\d{2,6})(?!\d)/.exec(text.slice(pos)))) { found.push([Number(more[1]), m.index]); pos += more[0].length; }
    }
  }
  return found;
}
export function classKeys(name) {
  const text = String(name ?? '').slice(0, 400), parts = text.split(/[.$:/\\]+/).filter(Boolean), outer = text.split('$')[0].split(/[.:/\\]+/).filter(Boolean);
  const keys = new Set([...parts.slice(-2), ...outer.slice(-1)].map(v => v.toLowerCase()));
  if (/[/\\]/.test(text)) { const base = text.split(/[/\\]/).at(-1); keys.add(base.toLowerCase()); keys.add(base.slice(0, base.length - path.extname(base).length).toLowerCase()); }
  return keys;
}
export function runEvidence(results) {
  const out = { known: false, ids: new Set(), keys: new Set() };
  for (const res of results) {
    if (!res || !Object.keys(res.tests).length) continue;
    out.known = true;
    for (const [id, status] of Object.entries(res.tests)) if (status === 'PASS' && /rule/i.test(id)) for (const [n] of findIds(id)) out.ids.add(n);
    for (const [klass, c] of Object.entries(res.classes)) if (c.pass) for (const k of classKeys(klass)) out.keys.add(k);
  }
  return out;
}
function lineMarks(body) {
  const starts = [], marked = []; let offset = 0, count = 0;
  for (const line of body.split('\n')) { starts.push(offset); count += Number(SKIPPED.test(line)); marked.push(count); offset += line.length + 1; }
  return { starts, marked };
}
function lineAt(starts, offset) {
  let lo = 0, hi = starts.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (starts[mid] <= offset) lo = mid + 1; else hi = mid; }
  return lo;
}
function field(lines, name) {
  for (const line of lines) { const s = line.slice(0, 4000).replace(/^[ \t>*-]+/, ''); if (s.slice(0, name.length).toLowerCase() === name.toLowerCase()) { const rest = s.slice(name.length).replace(/^\*+/, '').trimStart(); if (rest.startsWith(':')) return rest.slice(1).replace(/^[ \t*]+/, '').trim(); } }
  return '';
}
export function parseRules(text) {
  const rules = [], notes = [], seen = new Set(), rows = new Map(), lines = text.replace(/\r\n?/g, '\n').split('\n');
  let card = null, fence = '';
  for (const line of lines) if (line.trimStart().startsWith('|')) {
    const cells = line.slice(0, 4000).trim().replace(/^\|+|\|+$/g, '').split('|').map(c => c.replace(/[*`]/g, '').trim()), ids = cells.map(c => /^RULE[-_](\d{1,6})$/i.exec(c)).filter(Boolean);
    if (ids.length && !rows.has(Number(ids[0][1]))) rows.set(Number(ids[0][1]), { p: cells.find(c => /^P\d$/.test(c)) ?? '', c: cells.find(c => /^(high|medium|low)\b/i.test(c)) ?? '' });
  }
  for (const line of lines) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = ''; if (card) card.body.push(line); continue; }
    if (f) fence = f[1];
    const m = f ? null : /^#{2,5}[ \t]+[*`\[]*RULE[-_](\d{1,6})(?![A-Za-z0-9])/i.exec(line.slice(0, 4000));
    if (!f && /^#{1,6}\s/.test(line)) card = null;
    if (m) {
      const n = Number(m[1]); if (seen.has(n)) { notes.push(`RULE-${String(n).padStart(3, '0')} has more than one card; the first was used.`); continue; }
      seen.add(n); card = { n, id: `RULE-${String(n).padStart(3, '0')}`, name: clean(line.slice(m[0].length, 4000).replace(/^[*`\] \t:·–—-]+/, '').replace(/[# \t]+$/, ''), 160), body: [] }; rules.push(card);
    } else if (card) card.body.push(line);
  }
  for (const r of rules) {
    const priority = /\bP\d\b/.exec(field(r.body, 'Priority')), confidence = /\b(high|medium|low)\b/i.exec(field(r.body, 'Confidence')), row = rows.get(r.n) ?? {}, source = field(r.body, 'Source'), sourceFile = [...source.matchAll(PATH)][0]?.[0] ?? '';
    const conf = confidence?.[1] ?? row.c ?? ''; Object.assign(r, { priority: priority?.[0] ?? row.p ?? '', confidence: conf.charAt(0).toUpperCase() + conf.slice(1).toLowerCase(), source: clean(source, 160), sourceFile: path.posix.basename(sourceFile) }); delete r.body;
  }
  return [rules, notes];
}
export function fileKind(rel) {
  const parts = rel.split('/'), base = parts.at(-1);
  if (DOC_EXT.has(path.extname(base).toLowerCase())) return 'doc';
  return parts.slice(0, -1).some(p => TEST_DIRS.has(p.toLowerCase())) || TEST_NAME.test(base) ? 'test' : 'main';
}
export function discoverModules(io, system) {
  const out = [];
  io.watch(path.join(io.root, 'modernized'));
  for (const [track, suffix] of [['rewrite', ''], ['uplift', '-uplifted'], ['reimagine', '-reimagined']]) {
    const rel = `modernized/${system}${suffix}`, root = io.inside(rel);
    if (!root || !realDirectory(root)) continue;
    io.watch(root);
    if (track === 'uplift') { out.push({ name: system + suffix, track, path: root, rel }); continue; }
    const subs = fs.readdirSync(root).sort().filter(d => !d.startsWith('.') && !SKIP_DIRS.has(d) && realDirectory(path.join(root, d)));
    for (const d of subs) out.push({ name: d, track, path: path.join(root, d), rel: rel + '/' + d });
    if (!subs.length) out.push({ name: system + suffix, track, path: root, rel });
  }
  return out;
}
export const walkModule = (io, root, budget = 200000) => io.walk(root, { skipDirs: SKIP_DIRS, maxFiles: budget });
export function toolingOnly(io, root) {
  const walked = walkModule(io, root); let tests = 0;
  for (const [rel] of walked.files) {
    const kind = fileKind(rel), base = path.posix.basename(rel).toLowerCase();
    if (kind === 'test') tests++;
    else if (kind === 'main' && !TOOLING.has(base) && !new Set(['.csproj', '.sln', '.props', '.targets', '.runsettings']).has(path.extname(base)) && !/^(?:tsconfig[\w.-]*\.json|[\w-]+\.config\.(?:js|cjs|mjs|ts)|docker-compose[\w.-]*\.ya?ml)$/.test(base)) return false;
  }
  return tests > 0 && !walked.cut;
}
export function claimsOf(notes, names) {
  const claimed = new Set(), named = new Set(); let unresolved = 0, head = '';
  for (let line of notes.split('\n')) {
    line = line.slice(0, 4000); const tokens = [...line.matchAll(PATH)].map(m => m[0]); for (const t of tokens) named.add(path.posix.basename(t));
    if (line.startsWith('#')) head = line.replace(/^#+/, '').trim();
    if (!line.trimStart().startsWith('|') || /not migrated|not implemented|not ported|removed|retired|dead code|dropped|out of scope/i.test(head)) continue;
    const ids = findIds(line); if (!ids.length) continue;
    if (tokens.some(t => (names.get(path.posix.basename(t)) ?? []).some(p => p === t || p.endsWith('/' + t)))) for (const [id] of ids) claimed.add(id); else unresolved++;
  }
  return [claimed, unresolved, named];
}
const blank = () => ({ main: 0, tests: 0, live: 0, claimed: false, named: false, by: '', at: '' });
const status = slot => slot.by ? 'tested' : slot.tests ? NOT_RUN : slot.main ? 'code only' : slot.claimed ? 'claimed only' : 'none';
export function totals(rows) {
  const out = dictionary();
  for (const r of rows) { const t = out[r.priority || 'unrated'] ??= { rules: 0, tested: 0, [NOT_RUN]: 0, 'code only': 0, 'claimed only': 0, none: 0 }; t.rules++; t[r.status]++; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
export function traceRules(io, system, ran = dictionary()) {
  const rulesFile = `analysis/${system}/BUSINESS_RULES.md`, text = io.text(path.join(io.root, rulesFile));
  if (text === null) throw new ProofInputError(`${rulesFile} is missing or is not readable text`);
  const [rules, notes] = parseRules(text), byNumber = new Map(rules.map(r => [r.n, r])), per = new Map(rules.map(r => [r.n, dictionary()])), samples = new Map(rules.map(r => [r.n, { main: [], tests: [] }]));
  const modules = [], scan = { files: 0, textFiles: 0, linksSkipped: 0, cut: false }; let budget = 200000;
  for (const mod of discoverModules(io, system)) {
    const { files, links, cut } = walkModule(io, mod.path, budget); budget -= files.length;
    const names = new Map(); for (const [rel] of files) { const base = path.posix.basename(rel); if (!names.has(base)) names.set(base, []); names.get(base).push(rel); }
    const note = NOTE_NAMES.find(n => names.get(n)?.includes(n)) ?? '';
    const ntext = note ? io.text(path.join(mod.path, note), 1 << 20) : null;
    const [claimed, unresolved, named] = ntext === null ? [new Set(), 0, new Set()] : claimsOf(ntext, names);
    const ev = ran[mod.rel] ?? NO_RUN; let testFiles = 0;
    for (const [rel, full] of files) {
      const kind = fileKind(rel); if (kind === 'doc') continue;
      const key = kind === 'test' ? 'tests' : 'main', body = io.text(full, 2 << 20); testFiles += Number(kind === 'test'); scan.textFiles += Number(body !== null);
      const hits = [...findIds(path.posix.basename(rel)).map(([n]) => [n, null]), ...findIds(body ?? '')];
      const backed = kind === 'test' && ev.known && ev.keys.has(path.posix.basename(rel, path.extname(rel)).toLowerCase());
      const marks = hits.length && body !== null ? lineMarks(body) : null;
      for (const [n, at] of hits) {
        if (!byNumber.has(n)) continue;
        const slot = per.get(n)[mod.rel] ??= blank(); slot[key]++;
        const line = at === null ? 0 : lineAt(marks.starts, at), before = line - 5;
        const live = at === null || marks.marked[line - 1] === (before < 0 ? 0 : marks.marked[before]);
        if (kind === 'test' && live) { slot.live++; if (backed && !slot.by) { slot.by = 'test file'; slot.at = `${mod.rel}/${rel}:${line}`; } }
        const place = `${mod.rel}/${rel}`, target = samples.get(n)[key]; if (target.length < 3 && !target.some(s => s.slice(0, s.lastIndexOf(':')) === place)) target.push(`${place}:${line}`);
      }
    }
    for (const n of ev.ids) if (byNumber.has(n)) (per.get(n)[mod.rel] ??= blank()).by = 'test name';
    for (const n of claimed) if (byNumber.has(n)) (per.get(n)[mod.rel] ??= blank()).claimed = true;
    for (const r of rules) if (r.sourceFile && named.has(r.sourceFile)) (per.get(r.n)[mod.rel] ??= blank()).named = true;
    scan.files += files.length; scan.linksSkipped += links; scan.cut ||= cut;
    modules.push({ name: mod.name, track: mod.track, path: mod.rel, files: files.length, testFiles, notes: note, claimRowsUnresolved: unresolved });
  }
  const out = rules.map(r => {
    const slots = per.get(r.n), ss = Object.values(slots), combined = { main: ss.reduce((n, s) => n + s.main, 0), tests: ss.reduce((n, s) => n + s.tests, 0), claimed: ss.some(s => s.claimed), by: ss.some(s => s.by) };
    return { id: r.id, name: r.name, priority: r.priority, confidence: r.confidence, source: r.source, main: combined.main, tests: combined.tests, claimed: combined.claimed, status: status(combined), perModule: slots, samples: samples.get(r.n) };
  });
  if (scan.cut) notes.push('The scan stopped early'); if (scan.linksSkipped) notes.push(`${scan.linksSkipped} symbolic links were not followed`);
  return { system: clean(system, 100), rulesFile, modules, rules: out, totals: totals(out), p0NoTests: out.filter(r => r.priority === 'P0' && r.status !== 'tested').map(r => r.id), scan, notes };
}
export function moduleView(result, rel) {
  const mod = result.modules.find(m => m.path === rel); let rows = [], tied = true;
  const makeRow = r => { const slot = r.perModule[rel] ?? blank(); return { ...r, ...slot, status: status(slot) }; };
  for (const r of result.rules) { const s = r.perModule[rel] ?? blank(); if (mod && (mod.track === 'uplift' || s.main || s.tests || s.claimed || s.named || s.by)) rows.push(makeRow(r)); }
  if (mod && !rows.length && result.rules.length) { tied = false; rows = result.rules.map(makeRow); }
  return { rows, totals: totals(rows), outOfScope: result.rules.length - rows.length, tied, p0NoTests: rows.filter(r => r.priority === 'P0' && r.status !== 'tested').map(r => r.id) };
}
