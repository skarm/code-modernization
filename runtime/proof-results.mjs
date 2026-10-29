// SPDX-License-Identifier: Apache-2.0
// Node port of upstream baseline_diff.py (c8874f5ad883), Apache-2.0.
import path from 'node:path';
import { SaxesParser } from 'saxes';
import { clean, dictionary, isObject, ProofInputError, realDirectory, stat } from './proof-io.mjs';

export const BAD = new Set(['FAIL', 'ERROR']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv']);
const STATUS = { pass: 'PASS', passed: 'PASS', ok: 'PASS', success: 'PASS', green: 'PASS', fail: 'FAIL', failed: 'FAIL', failure: 'FAIL', red: 'FAIL',
  error: 'ERROR', errors: 'ERROR', errored: 'ERROR', skip: 'SKIP', skipped: 'SKIP', ignored: 'SKIP', pending: 'SKIP', disabled: 'SKIP' };
const statusOf = s => typeof s === 'string' && Object.hasOwn(STATUS, s) ? STATUS[s] : null;
const COLUMNS = [['pass', /^(?:pass|passed|passing|ok|successes?)$/], ['fail', /^(?:fail|failed|failing|failures?)$/],
  ['error', /^(?:errors?|errored)$/], ['skip', /^(?:skip|skipped|ignored|pending|disabled)$/]];
const TOTALS = { executed: 'executed', 'test cases': 'cases', passed: 'pass', pass: 'pass', failed: 'fail', failures: 'fail', errors: 'error', skipped: 'skip', ignored: 'skip' };
const EXT = /\.(?:xml|trx|json|txt|log|out|tap)$/i;
const entries = Object.entries, values = Object.values;
const nonempty = o => o && Object.keys(o).length > 0;
export const tally = statuses => {
  const c = { pass: 0, fail: 0, error: 0, skip: 0 };
  for (const s of statuses) c[s.toLowerCase()]++;
  return { ...c, executed: c.pass + c.fail + c.error };
};
function cell(s) {
  let v = s.replaceAll('\\|', '|').trim();
  if (v.length > 4 && v.startsWith('**') && v.endsWith('**')) v = v.slice(2, -2).trim();
  if (v.length >= 2 && v.startsWith('`') && v.endsWith('`')) v = v.slice(1, -1);
  return v;
}
function splitRow(line) { return line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '').slice(0, 20000).split(/(?<!\\)\|/).map(cell); }
export function mdTables(text) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n'), lines = [];
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i], extra = 0;
    while (/^\s*\|/.test(line) && !line.trimEnd().endsWith('|') && extra < 3 && i + 1 < raw.length && raw[i + 1].trim() && !/^\s*[|#]/.test(raw[i + 1])) {
      line += '\n' + raw[++i]; extra++;
    }
    lines.push(line);
  }
  const tables = []; let heading = '';
  for (let i = 0; i < lines.length; i++) {
    const h = /^#{1,6}[ \t]+(.*)/.exec(lines[i].slice(0, 2000)); if (h) heading = h[1];
    if (lines[i].includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1]?.slice(0, 5000) ?? '')) {
      const header = splitRow(lines[i]), rows = []; i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      tables.push([heading, header, rows]); i--;
    }
  }
  return tables;
}
function toInt(s) { const v = s.trim().replaceAll(',', ''); return ['', '-', '–', '—'].includes(v) ? 0 : /^\d{1,12}$/.test(v) ? Number(v) : null; }
export function parseBaseline(text) {
  text = text.replace(/\r\n?/g, '\n');
  const target = /^\W*target-only:[ \t]*(.*)$/im.exec(text);
  const out = { targetOnly: Boolean(target), why: target ? clean(target[1], 300) : '', modules: dictionary(), tests: dictionary(), totals: dictionary(), flaky: [], approved: dictionary() };
  for (const [heading, header, rows] of mdTables(text)) {
    const low = header.map(h => h.toLowerCase());
    if (/flak/i.test(heading)) { out.flaky.push(...rows.filter(r => r[0]).map(r => clean(r[0], 400))); continue; }
    if (/approved/i.test(heading)) { for (const r of rows) if (r[0] && !Object.hasOwn(out.approved, clean(r[0], 400))) out.approved[clean(r[0], 400)] = clean(r[1], 300); continue; }
    const cols = Object.fromEntries(COLUMNS.map(([k, rx]) => [k, low.findIndex(h => rx.test(h))]));
    const result = low.findIndex(h => /^(result|status|outcome|verdict)$/.test(h));
    if (cols.pass >= 0 && ['fail', 'error', 'skip'].some(k => cols[k] >= 0)) {
      for (const r of rows) {
        const counts = Object.fromEntries(entries(cols).map(([k, i]) => [k, i >= 0 && i < r.length ? toInt(r[i]) : 0]));
        if (r[0] && !/^(totals?|all|sum)$/i.test(r[0]) && values(counts).every(v => v !== null)) out.modules[r[0].slice(0, 300)] = counts;
      }
    } else if (result >= 0) {
      const at = low.findIndex(h => /^(tests?|test name|test id|id|name|cases?|test case)$/.test(h)), name = at < 0 ? 0 : at;
      for (const r of rows) { const st = statusOf(r[result]?.toLowerCase()); if (st && r[name] && result !== name) out.tests[r[name].slice(0, 400)] = st; }
    } else if (header.length >= 2) {
      for (const r of rows) { const label = r[0]?.toLowerCase(), n = r.length > 1 ? toInt(r[1]) : null; if (Object.hasOwn(TOTALS, label ?? '') && n !== null) out.totals[TOTALS[label]] = n; }
    }
  }
  if (![out.modules, out.tests, out.totals].some(nonempty)) for (const [word, key] of [['pass(?:ed|ing)', 'pass'], ['fail(?:ed|ing|ures?)', 'fail'], ['skipped', 'skip'], ['errors?', 'error']]) {
    const m = new RegExp('(\\d{1,9})\\s+(?:tests?\\s+|cases?\\s+)?' + word, 'i').exec(text); if (m) out.totals[key] = Number(m[1]);
  }
  return out;
}
export function baselineCounts(base) {
  if (nonempty(base.tests)) return [tally(values(base.tests)), 'per-test table'];
  if (nonempty(base.modules)) {
    const c = Object.fromEntries(['pass', 'fail', 'error', 'skip'].map(k => [k, values(base.modules).reduce((n, v) => n + v[k], 0)]));
    return [{ ...c, executed: c.pass + c.fail + c.error }, 'per-module table'];
  }
  if (nonempty(base.totals)) { const c = Object.fromEntries(['pass', 'fail', 'error', 'skip'].map(k => [k, base.totals[k] ?? 0])); return [{ ...c, executed: base.totals.executed ?? c.pass + c.fail + c.error }, 'totals']; }
  return [null, 'nothing'];
}

export function parseResultXML(bytes) {
  const cases = [], suites = []; let cur = null, depth = 0;
  let encoding = 'utf-8';
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (bytes[0] === 0x3c && bytes[1] === 0) encoding = 'utf-16le';
  else if (bytes[0] === 0 && bytes[1] === 0x3c) encoding = 'utf-16be';
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  const declared = /^<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/.exec(text.slice(0, 1000))?.[1]?.toLowerCase();
  if (declared && !['utf-8', 'utf8', 'utf-16', 'utf-16le', 'utf-16be'].includes(declared)) throw new ProofInputError('Unsupported XML encoding: ' + clean(declared));
  const parser = new SaxesParser({ xmlns: true });
  parser.on('doctype', () => { throw new ProofInputError('Test results declare a DTD or entity'); });
  parser.on('error', e => { throw new ProofInputError(`XML is not well formed: ${clean(e.message, 150)}`); });
  parser.on('opentag', node => {
    if (++depth > 60) throw new ProofInputError('XML is nested more than 60 levels deep');
    const tag = node.local, a = Object.fromEntries(values(node.attributes).map(v => [v.local, v.value]));
    if (tag === 'testsuite') suites.push((a.name ?? '').slice(0, 300));
    else if (tag === 'testcase') {
      if (cur) throw new ProofInputError('Nested testcase elements are ambiguous');
      if (cases.length >= 2000000) throw new ProofInputError('More than 2000000 test cases');
      cur = [(a.classname || suites.at(-1) || '').slice(0, 300), (a.name ?? '').slice(0, 400),
        ['skipped', 'ignored', 'notrun', 'notexecuted', 'disabled'].includes((a.status || a.result || '').toLowerCase()) ? 'SKIP' : 'PASS', false];
    } else if (cur && ['failure', 'error', 'skipped'].includes(tag)) {
      if (tag === 'skipped') cur[3] = Boolean(a.message?.trim());
      const next = { failure: 'FAIL', error: 'ERROR', skipped: 'SKIP' }[tag];
      if (cur[2] === 'PASS' || (cur[2] === 'SKIP' && next !== 'SKIP')) cur[2] = next;
    } else if (tag === 'UnitTestResult') {
      if (cases.length >= 2000000) throw new ProofInputError('More than 2000000 test cases');
      const name = (a.testName ?? '').slice(0, 400), at = name.indexOf('('), head = at < 0 ? name : name.slice(0, at), dot = head.lastIndexOf('.');
      const trx = { Passed: 'PASS', Failed: 'FAIL', Error: 'ERROR', Timeout: 'ERROR', Aborted: 'ERROR' };
      cases.push([dot < 0 ? '' : head.slice(0, dot).slice(0, 300), dot < 0 ? name : name.slice(dot + 1), Object.hasOwn(trx, a.outcome ?? '') ? trx[a.outcome] : 'SKIP', false, '']);
    }
  });
  parser.on('closetag', node => { depth--; if (node.local === 'testcase' && cur) { cases.push([...cur, suites.at(-1) ?? '']); cur = null; } else if (node.local === 'testsuite') suites.pop(); });
  for (let i = 0; i < text.length; i += 65536) parser.write(text.slice(i, i + 65536));
  parser.close(); return cases;
}
function moduleLabel(file) {
  const parts = path.resolve(file).split(path.sep);
  for (let i = parts.length - 2; i > 1; i--) if (['target', 'build'].includes(parts[i]) && ['surefire-reports', 'failsafe-reports', 'test-results'].includes(parts[i + 1])) return parts.slice(0, i).join(path.sep) || path.sep;
  return '';
}
export function resultFiles(io, paths) {
  const files = new Set(), problems = [];
  for (const input of paths) {
    const p = io.inside(input); if (!p) { problems.push('Result path is outside the permitted tree or contains a link'); continue; }
    const st = stat(p);
    if (st?.isFile()) files.add(p);
    else if (st?.isDirectory()) {
      const walked = io.walk(p, { skipDirs: SKIP_DIRS, hidden: false, maxFiles: 20000 });
      for (const [, f] of walked.files) if (/\.(xml|trx)$/i.test(f)) {
        try {
          const head = io.read(f, 200 << 20).subarray(0, 4096), encoding = head[0] === 0xff && head[1] === 0xfe || head[0] === 0x3c && head[1] === 0 ? 'utf-16le' : head[0] === 0xfe && head[1] === 0xff || head[0] === 0 && head[1] === 0x3c ? 'utf-16be' : 'utf-8';
          if (/\.trx$/i.test(f) || /^TEST[-_].*\.xml$/i.test(path.basename(f)) || /<(?:[\w]+:)?(?:testsuite|TestRun)\b/.test(new TextDecoder(encoding).decode(head))) files.add(f);
        }
        catch (e) { problems.push(clean(e.message)); io.gap(e.message); }
      }
    } else problems.push(`${clean(p, 120)} is not a file or folder that can be read`);
    if (files.size > 20000) { problems.push('More than 20000 result files were found'); break; }
  }
  return [[...files].slice(0, 20000), problems];
}
export function readResults(io, paths) {
  const [files, problems] = resultFiles(io, paths);
  const out = { tests: dictionary(), skipReasons: dictionary(), classes: dictionary(), modules: dictionary(), suites: dictionary(), files: 0, unreadable: [], problems, oldest: null, newest: null };
  let caseCount = 0;
  for (const file of files) {
    if (caseCount >= 2000000) { io.gap('Result collection exceeds 2000000 test cases'); break; }
    let cases;
    try { cases = parseResultXML(io.read(file, 200 << 20)); }
    catch (e) { const issue = `${clean(path.basename(file), 100)}: ${clean(e.message, 120)}`; out.unreadable.push(issue); io.gap(issue); continue; }
    if (caseCount + cases.length > 2000000) { io.gap('Result collection exceeds 2000000 test cases'); cases = cases.slice(0, 2000000 - caseCount); }
    caseCount += cases.length;
    const root = moduleLabel(file), seen = dictionary(), mtime = stat(file).mtimeMs / 1000;
    const roots = root ? [...new Set([root, ...(root.startsWith('/private/') ? [root.slice(8)] : [])])].sort((a, b) => b.length - a.length) : [];
    out.files++; out.oldest = Math.min(out.oldest ?? Infinity, mtime); out.newest = Math.max(out.newest ?? 0, mtime);
    for (let [klass, name, status, reason, suite] of cases) {
      for (const r of roots) name = name.replaceAll(r, '<MODULE>'); name = name.replace(/(test)\d+(\.tmp)/g, '$1<N>$2');
      const base = klass ? `${klass}#${name}` : name, n = seen[base] ?? 0, id = n ? `${base}~${n}` : base; seen[base] = n + 1;
      if (Object.hasOwn(out.tests, id) && out.tests[id] !== status) io.gap(`Conflicting results for test ${clean(id, 150)}`);
      out.tests[id] = BAD.has(out.tests[id]) ? out.tests[id] : status;
      out.skipReasons[id] = reason;
      for (const [key, store] of [[klass, out.classes], [root && path.basename(root), out.modules], [suite, out.suites]]) if (key) (store[key] ??= []).push(status);
    }
  }
  for (const store of ['classes', 'modules', 'suites']) out[store] = Object.assign(dictionary(), Object.fromEntries(entries(out[store]).map(([k, v]) => [k, tally(v)])));
  for (const p of problems) io.gap(p);
  return out;
}

const words = s => { const out = dictionary(); for (const m of s.matchAll(/(\d+)\s+([A-Za-z]+)/g)) out[m[2].toLowerCase()] = (out[m[2].toLowerCase()] ?? 0) + Number(m[1]); return out; };
// A complete Node test-runner TAP stream, not arbitrary TAP or per-test identity evidence.
function parseNodeTAP(text) {
  const counts = dictionary(), scopes = new Map([[0, { points: 0, plan: null }]]);
  let header = false, diagnostics = null, duration = false, points = 0, notOK = 0;
  const closeBelow = indent => {
    for (const [depth, scope] of scopes) if (depth > indent) {
      if (scope.plan !== scope.points) return false;
      scopes.delete(depth);
    }
    return true;
  };
  const number = s => /^\d{1,10}$/.test(s) && Number(s) <= 1e9 ? Number(s) : null;
  const lines = text.split('\n'); if (lines.length > 3000000) return null;
  for (let line of lines) {
    line = line.replace(/\r$/, '');
    if (diagnostics !== null) { if (line === diagnostics + '...') diagnostics = null; continue; }
    if (line === 'TAP version 13') { if (header) return null; header = true; continue; }
    if (!header) continue; // npm and other launchers may print a preamble.
    if (/^[ \t]*Bail out!/i.test(line)) return null;
    let m;
    if ((m = /^( +)---$/.exec(line))) { diagnostics = m[1]; continue; }
    if ((m = /^( *)(not )?ok (\d+)(?: - .*|\s*)$/.exec(line))) {
      const indent = m[1].length;
      if (duration || scopes.get(0).plan !== null || Object.keys(counts).length || indent > 240 || indent % 4 || !closeBelow(indent)) return null;
      const scope = scopes.get(indent) ?? { points: 0, plan: null }; scopes.set(indent, scope);
      if (scope.plan !== null || number(m[3]) !== ++scope.points) return null;
      points++; if (m[2]) notOK++;
    } else if ((m = /^( *)1\.\.(\d+)(?: # SKIP.*)?$/.exec(line))) {
      const indent = m[1].length;
      if (duration || scopes.get(0).plan !== null || Object.keys(counts).length || indent > 240 || indent % 4 || !closeBelow(indent)) return null;
      const scope = scopes.get(indent) ?? { points: 0, plan: null }; scopes.set(indent, scope);
      const plan = number(m[2]); if (plan === null || scope.plan !== null || plan !== scope.points) return null;
      scope.plan = plan;
    } else if ((m = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (.*)$/.exec(line))) {
      const n = number(m[2]);
      if (duration || scopes.get(0).plan === null || n === null || Object.hasOwn(counts, m[1])) return null;
      counts[m[1]] = n;
    } else if ((m = /^# duration_ms (\d+(?:\.\d+)?)$/.exec(line))) {
      if (duration || Object.keys(counts).length !== 7 || !Number.isFinite(Number(m[1]))) return null;
      duration = true;
    } else if (/^(?: *)(?:not ok\b|ok\b|1\.\.)|^# (?:duration_ms|tests|suites|pass|fail|cancelled|skipped|todo)\b/.test(line)) return null;
  }
  if (!header || diagnostics !== null || !duration || !closeBelow(-1) ||
      points !== counts.tests + counts.suites || counts.tests !== counts.pass + counts.fail + counts.cancelled + counts.skipped + counts.todo ||
      notOK < counts.fail + counts.cancelled || notOK > counts.fail + counts.cancelled + counts.todo + counts.suites) return null;
  // Cancelled tests did not pass; TODOs cannot count as executed preservation checks.
  return [counts.pass + counts.fail + counts.cancelled, counts.fail + counts.cancelled, counts.skipped + counts.todo, ['node --test (TAP)']];
}
export function parseRunnerLog(text) {
  if (/^TAP version 13\r?$/m.test(text)) return parseNodeTAP(text);
  let pass = 0, failed = 0, skipped = 0, ran = null; const seen = new Set();
  const add = (runner, p, f, s) => { pass += p; failed += f; skipped += s; seen.add(runner); };
  for (let line of text.split('\n').slice(0, 3000000)) {
    line = line.replace(/\r$/, '').slice(0, 2000); let m;
    if (ran !== null && line.trim()) {
      m = /^(?:OK|FAILED)(?: \(([^)]*)\))?\s*$/.exec(line);
      if (m) { const w = Object.fromEntries([...(m[1] ?? '').matchAll(/(\w+)=(\d+)/g)].map(x => [x[1], Number(x[2])])), f = (w.failures ?? 0) + (w.errors ?? 0), sk = w.skipped ?? 0; add('unittest', Math.max(0, ran - f - sk), f, sk); }
      ran = null;
    }
    if ((m = /^Ran (\d+) tests? in [\d.]+s\s*$/.exec(line))) { ran = Number(m[1]); continue; }
    if ((m = /^(?:\[\w+\]\s*)?Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$/.exec(line))) { const [r, f, e, s] = m.slice(1).map(Number); add('maven', Math.max(0, r - f - e - s), f + e, s); }
    else if ((m = /^(\d+) tests? completed(?:, (\d+) failed)?(?:, (\d+) skipped)?\s*$/.exec(line))) { const [r, f, s] = m.slice(1).map(x => Number(x ?? 0)); add('gradle', Math.max(0, r - f - s), f, s); }
    else if ((m = /^test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;/.exec(line))) add('cargo', ...m.slice(1).map(Number));
    else if ((m = /^(?:=+ )?((?:\d+ [a-z]+(?:, )?)+) in [\d.]+s(?: \([\d:]+\))?(?: =+)?\s*$/.exec(line))) { const w = words(m[1]); add('pytest', (w.passed ?? 0) + (w.xpassed ?? 0) + (w.xfailed ?? 0), (w.failed ?? 0) + (w.error ?? 0) + (w.errors ?? 0), w.skipped ?? 0); }
    else if (/^(?:=+ )?no tests ran in [\d.]+s/.test(line)) add('pytest', 0, 0, 0);
    else if ((m = /^\s*--- (PASS|FAIL|SKIP): \S/.exec(line))) add('go test', Number(m[1] === 'PASS'), Number(m[1] === 'FAIL'), Number(m[1] === 'SKIP'));
    else if ((m = /^\{.*"Action":"(pass|fail|skip)".*"Test":"[^"]+"/.exec(line))) add('go test -json', Number(m[1] === 'pass'), Number(m[1] === 'fail'), Number(m[1] === 'skip'));
    else if ((m = /^(?:Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+),\s+Skipped:\s+(\d+)/.exec(line))) add('dotnet test', Number(m[2]), Number(m[1]), Number(m[3]));
    else if ((m = /^\s*Tests:\s+(.*\b\d+ total)\s*$/.exec(line))) { const w = words(m[1]); add('jest', w.passed ?? 0, w.failed ?? 0, w.skipped ?? 0); }
    else if ((m = /^\s*Tests\s{2,}(.*)\(\d+\)\s*$/.exec(line))) { const w = words(m[1]); add('vitest', w.passed ?? 0, w.failed ?? 0, w.skipped ?? 0); }
    else if ((m = /^\d+% tests passed, (\d+) tests? failed out of (\d+)/.exec(line))) add('ctest', Math.max(0, Number(m[2]) - Number(m[1])), Number(m[1]), 0);
    else if ((m = /^OK \((\d+) tests?, \d+ assertions?\)/.exec(line))) add('phpunit', Number(m[1]), 0, 0);
    else if ((m = /^(Tests: \d+, Assertions: \d+.*?)\.?\s*$/.exec(line))) { const w = Object.fromEntries([...m[1].matchAll(/([A-Za-z]+):\s*(\d+)/g)].map(x => [x[1].toLowerCase(), Number(x[2])])); const f = (w.failures ?? 0) + (w.errors ?? 0), sk = (w.skipped ?? 0) + (w.incomplete ?? 0); add('phpunit', Math.max(0, (w.tests ?? 0) - f - sk), f, sk); }
  }
  return seen.size && [pass + failed, failed, skipped].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9) ? [pass + failed, failed, skipped, [...seen].sort()] : null;
}
export function readLogs(io, paths) {
  const out = { files: 0, executed: 0, failed: 0, skipped: 0, runners: [], oldest: null, newest: null, unrecognised: [] };
  for (const file of [...new Set(paths)]) {
    let got;
    try { got = parseRunnerLog(io.read(file, 16 << 20).toString('utf8')); }
    catch (e) { out.unrecognised.push(`${clean(path.basename(file))}: ${clean(e.message)}`); io.gap(e.message); continue; }
    if (!got) { out.unrecognised.push(`${clean(path.basename(file))} (no summary line of a known runner)`); continue; }
    const mtime = stat(file).mtimeMs / 1000;
    out.files++; out.executed += got[0]; out.failed += got[1]; out.skipped += got[2]; out.runners = [...new Set([...out.runners, ...got[3]])].sort();
    out.oldest = Math.min(out.oldest ?? Infinity, mtime); out.newest = Math.max(out.newest ?? 0, mtime);
  }
  return out;
}

export function evidencePaths(io, baselinePath, text) {
  const adir = path.dirname(baselinePath), system = path.basename(adir), found = new Set();
  const add = parts => {
    if (!parts.length || parts.some(c => c === '.' || c === '..')) return;
    const f = io.inside(parts.join('/'), adir); if (f && (stat(f)?.isFile() || realDirectory(f))) found.add(f);
  };
  add(['baseline']);
  for (const line of text.split('\n').slice(0, 20000)) {
    if (!/^[ \t>*-]*\**[ \t]*(?:recorded|machine-readable)\b[^:\n]{0,40}:/i.test(line.slice(0, 4000))) continue;
    for (const m of line.slice(0, 4000).matchAll(/[A-Za-z0-9_.@+~-]+(?:\/[A-Za-z0-9_.@+~-]+)*\/?/g)) {
      const tok = m[0]; if (!EXT.test(tok) && !tok.endsWith('/')) continue;
      let parts = tok.split('/').filter(Boolean); if (parts[0] === 'analysis') parts = parts.length >= 3 && parts[1] === system ? parts.slice(2) : [];
      add(parts); if (found.size >= 50) return [...found];
    }
  }
  return [...found];
}
export function parseResultsJSON(data) {
  const obj = isObject(data) && (isObject(data.tests) || Array.isArray(data.tests)) ? data.tests : data, tests = dictionary();
  const status = v => statusOf(typeof v === 'string' ? v.toLowerCase().replace(/[^a-z]/g, '') : '');
  if (isObject(obj)) { const items = entries(obj).slice(0, 2000000); for (const [k, v] of items) if (status(v)) tests[k.slice(0, 400)] = status(v); if (Object.keys(tests).length < 0.9 * items.length) return null; }
  else if (Array.isArray(obj)) for (const e of obj.slice(0, 2000000)) if (isObject(e)) {
    const name = ['test', 'id', 'name', 'fullName', 'fullname'].map(k => e[k]).find(v => typeof v === 'string' && v), st = ['status', 'result', 'outcome'].map(k => status(e[k])).find(Boolean);
    if (name && st && !Object.hasOwn(tests, name.slice(0, 400))) tests[name.slice(0, 400)] = st;
  }
  return nonempty(tests) ? tests : null;
}
export function readBaselineEvidence(io, paths) {
  const out = { tests: null, counts: null, sources: [], considered: [], ignored: [], unreadable: [], conflicts: [], measured: false }, found = new Set(), tests = dictionary();
  for (const p of paths) {
    if (realDirectory(p)) {
      for (const [, f] of io.walk(p, { skipDirs: SKIP_DIRS, hidden: false, maxFiles: 2000 }).files) if (EXT.test(f)) found.add(f);
    } else if (EXT.test(p)) found.add(p);
  }
  const files = [...found].slice(0, 2000); out.considered = files.slice(0, 20).map(f => clean(path.basename(f), 80));
  const cat = st => BAD.has(st) ? 'BAD' : st;
  const merge = (more, label) => { for (const [k, v] of entries(more)) { if (!Object.hasOwn(tests, k)) tests[k] = v; else if (cat(tests[k]) !== cat(v)) out.conflicts.push(`${clean(k, 100)}: ${tests[k]} in one source, ${v} in ${label}`); } };
  const xml = files.filter(f => /\.(xml|trx)$/i.test(f));
  if (xml.length) { const got = readResults(io, xml); out.unreadable.push(...got.unreadable.slice(0, 5)); if (got.files) { merge(got.tests, 'the result files'); out.sources.push({ kind: 'result files', files: got.files, tests: Object.keys(got.tests).length }); } }
  for (const file of files.filter(f => /\.json$/i.test(f))) {
    const [obj, problem] = io.json(file, 200 << 20), name = clean(path.basename(file), 80);
    if (problem) { out.unreadable.push(`${name}: ${problem}`); continue; }
    const t = parseResultsJSON(obj);
    if (t) { merge(t, name); out.sources.push({ kind: 'machine-readable results', files: 1, tests: Object.keys(t).length, name }); } else out.ignored.push(name);
  }
  const logs = readLogs(io, files.filter(f => /\.(txt|log|out|tap)$/i.test(f)));
  if (logs.files) {
    out.sources.push({ kind: 'runner log', files: logs.files, executed: logs.executed, runners: logs.runners });
    if (nonempty(tests)) { const c = tally(values(tests)); if (c.executed !== logs.executed || c.fail + c.error !== logs.failed) out.conflicts.push(`The runner log says ${logs.executed} executed and ${logs.failed} failed; per-test results say ${c.executed} and ${c.fail + c.error}`); }
  }
  out.tests = nonempty(tests) ? tests : null;
  out.counts = logs.files && !out.tests ? { executed: logs.executed, failed: logs.failed, skipped: logs.skipped } : null;
  out.conflicts = out.conflicts.slice(0, 20); out.measured = Boolean(out.tests || out.counts); return out;
}
export function assessBaseline(base, measured) {
  const info = { kind: [base.tests, base.modules, base.totals].some(nonempty) ? 'typed' : 'none', sources: [], disagree: 0, examples: [], conflict: 0, conflictExamples: [],
    considered: measured?.considered?.slice(0, 20) ?? [], ignored: measured?.ignored?.slice(0, 10) ?? [], unreadable: measured?.unreadable?.slice(0, 5) ?? [], measuredTests: 0, measuredExecuted: null, measuredFailed: null };
  if (base.targetOnly) return { ...info, kind: 'target-only' };
  if (!measured?.measured) return info;
  info.kind = 'measured'; info.sources = measured.sources.slice(0, 10); info.conflict = measured.conflicts.length; info.conflictExamples = measured.conflicts.slice(0, 3).map(c => clean(c, 200));
  const [typed] = baselineCounts(base), cat = st => BAD.has(st) ? 'BAD' : st;
  if (measured.tests) {
    const c = tally(values(measured.tests)); Object.assign(info, { measuredTests: Object.keys(measured.tests).length, measuredExecuted: c.executed, measuredFailed: c.fail + c.error });
    if (nonempty(base.tests)) { const bad = entries(base.tests).filter(([t, st]) => cat(measured.tests[t] ?? '') !== cat(st)); info.disagree = bad.length; info.examples = bad.slice(0, 5).map(([t]) => clean(t, 120)); }
    else if (typed && (typed.executed !== c.executed || typed.fail + typed.error !== c.fail + c.error)) { info.disagree = 1; info.examples.push(`typed: ${typed.executed} executed, ${typed.fail + typed.error} failed; measured: ${c.executed} executed, ${c.fail + c.error} failed`); }
  } else {
    const m = measured.counts; info.measuredExecuted = m.executed; info.measuredFailed = m.failed;
    if (typed && (typed.executed !== m.executed || typed.fail + typed.error !== m.failed)) { info.disagree = 1; info.examples.push(`typed: ${typed.executed} executed, ${typed.fail + typed.error} failed; measured: ${m.executed} executed, ${m.failed} failed`); }
  }
  const t = base.totals;
  if ((Object.hasOwn(t, 'executed') && t.executed !== info.measuredExecuted) || ((Object.hasOwn(t, 'fail') || Object.hasOwn(t, 'error')) && (t.fail ?? 0) + (t.error ?? 0) !== info.measuredFailed)) {
    info.disagree++; info.examples.push(`Totals table disagrees with measured ${info.measuredExecuted} executed and ${info.measuredFailed} failed`);
  }
  return info;
}
export function compareBaseline(base, fresh) {
  const [before, source] = baselineCounts(base), now = tally(values(fresh.tests)), bt = base.tests, ft = fresh.tests;
  const rep = { baseline: { targetOnly: base.targetOnly, why: base.why, source: base.measuredTests ? 'measured results' : source, counts: before, assessment: base.assessment ?? null },
    fresh: { files: fresh.files, counts: now, unreadable: fresh.unreadable.slice(0, 20), unreadableCount: fresh.unreadable.length, oldest: fresh.oldest, newest: fresh.newest },
    regressions: [], flaky: [], newFailures: [], stillFailing: [], fixed: [], newlySkipped: [], missing: [], renamed: 0, missingModules: [], moduleDiffs: [], executedDrop: null, skippedGrowth: null, problems: [...fresh.problems], approved: [] };
  if (nonempty(bt)) {
    const missing = Object.keys(bt).filter(t => !Object.hasOwn(ft, t)), added = Object.keys(ft).filter(t => !Object.hasOwn(bt, t));
    for (const [t, b] of entries(bt)) {
      const f = ft[t]; if (!f) continue;
      if (b === 'PASS' && BAD.has(f)) (base.flaky.includes(t) ? rep.flaky : rep.regressions).push({ id: t, before: b, now: f });
      else if (BAD.has(b) && BAD.has(f)) rep.stillFailing.push(t);
      else if (BAD.has(b) && f === 'PASS') rep.fixed.push(t);
      else if (b === 'PASS' && f === 'SKIP') rep.newlySkipped.push(t);
      else if (b === 'SKIP' && BAD.has(f)) rep.newFailures.push(t);
    }
    const byClass = dictionary(); for (const t of missing) (byClass[t.split('#')[0]] ??= [[], []])[0].push(t); for (const t of added) (byClass[t.split('#')[0]] ??= [[], []])[1].push(t);
    for (const [klass, [gone, addedTests]] of entries(byClass)) {
      const bc = tally(entries(bt).filter(([t]) => t.split('#')[0] === klass).map(([, s]) => s)), fc = tally(entries(ft).filter(([t]) => t.split('#')[0] === klass).map(([, s]) => s));
      if (gone.length && addedTests.length && fc.executed >= bc.executed && fc.fail + fc.error <= bc.fail + bc.error) rep.renamed += gone.length;
      else { rep.missing.push(...gone); rep.newFailures.push(...addedTests.filter(t => BAD.has(ft[t]))); }
    }
  }
  for (const [name, b] of entries(base.modules)) {
    const f = fresh.classes[name] ?? fresh.modules[name] ?? fresh.suites[name];
    if (!f) { rep.missingModules.push(name); continue; }
    const issues = [];
    if (f.executed < b.pass + b.fail + b.error) issues.push(`${f.executed} tests executed, ${b.pass + b.fail + b.error} before`);
    if (f.skip > b.skip) issues.push(`${f.skip} skipped, ${b.skip} before`);
    if (!nonempty(bt) && f.fail + f.error > b.fail + b.error) rep.regressions.push({ id: name + ' (all its tests)', before: `${b.fail + b.error} failing`, now: `${f.fail + f.error} failing` });
    if (issues.length) rep.moduleDiffs.push({ module: name, problems: issues });
  }
  if (before && now.executed < before.executed) rep.executedDrop = { before: before.executed, now: now.executed };
  if (before && now.skip > before.skip) rep.skippedGrowth = { before: before.skip, now: now.skip };
  for (const [key, label] of [['regressions', 'passed before, fails now'], ['newFailures', 'not in the baseline, fails now']]) rep[key] = rep[key].filter(item => {
    const id = typeof item === 'string' ? item : item.id;
    if (!Object.hasOwn(base.approved, id)) return true;
    rep.approved.push({ id, reason: base.approved[id], was: label }); return false;
  });
  for (const k of ['regressions', 'flaky', 'newFailures', 'stillFailing', 'fixed', 'newlySkipped', 'missing', 'missingModules', 'moduleDiffs', 'approved']) { rep[k + 'Count'] = rep[k].length; rep[k] = rep[k].slice(0, 200); }
  rep.ok = now.executed > 0 && !rep.regressionsCount && !rep.newFailuresCount; return rep;
}
export function baselineRun(io, baselinePath, paths, measured = undefined) {
  const text = io.text(baselinePath, 16 << 20); if (text === null) throw new ProofInputError('BASELINE.md cannot be read');
  const base = parseBaseline(text);
  if (!base.targetOnly && ![base.modules, base.tests, base.totals].some(nonempty)) throw new ProofInputError('BASELINE.md has no readable per-test/per-module table, totals or target-only line');
  measured ??= readBaselineEvidence(io, evidencePaths(io, baselinePath, text));
  base.assessment = assessBaseline(base, measured);
  if (base.assessment.kind === 'measured' && measured.tests) { base.tests = measured.tests; base.measuredTests = true; }
  return compareBaseline(base, readResults(io, paths));
}
