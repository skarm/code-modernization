// SPDX-License-Identifier: Apache-2.0
// Native Node port of Anthropic's proof_pack.py and its evidence checks.
// Upstream: anthropics/claude-plugins-official, c8874f5ad883 (Apache-2.0).
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { EvidenceIO, clean, dictionary, isObject, ProofInputError, realDirectory, slash, stat, utc } from './proof-io.mjs';
import { BAD, readResults, readLogs, tally, evidencePaths, readBaselineEvidence, assessBaseline, parseBaseline, baselineRun } from './proof-results.mjs';
import { discoverModules, DOC_EXT, moduleView, NO_RUN, NOTE_NAMES, NOT_RUN, runEvidence, SKIP_DIRS, toolingOnly, traceRules } from './proof-rules.mjs';
import { deltaCoverage, testsChanged } from './proof-uplift.mjs';
import { compareCases } from './compare.mjs';
import { atomicJSON, isFinderMetadata, name, safeMkdir, within } from './util.mjs';
import { PLUGIN_VERSION } from './version.mjs';

export { ProofInputError } from './proof-io.mjs';
export const VERDICTS = ['PROVEN', 'PARTLY PROVEN', 'NOT PROVEN'];
export const CHECKS = { tests: 'Tests ran', rules: 'Rules traced', same: 'Same behavior', fresh: 'Fresh inputs', canary: 'Canary', source: 'Source untouched', baseline: 'Baseline measured', kept: 'Tests kept', deltas: 'Deltas covered' };
const SOURCE_METHOD = 'by modification time, and no version-control tool was run';
export const RULES_TEXT = [
  'PROVEN needs every applicable check to pass: six checks, and for an uplift three more (7 to 9). Any failed check means NOT PROVEN; an incomplete check without failures means PARTLY PROVEN.',
  '1. Tests ran: at least one test executed, none failed or was skipped without a reason, and no result file is older than the code (two seconds of filesystem tolerance). Counts are read from JUnit/TRX results or a saved recognized runner log; typed counts cannot reach PROVEN. Uplift failures are judged against its baseline.',
  '2. Rules traced (rewrite/reimagine): every P0 rule the module answers for is named by an actually passing test, or by a test file whose class ran and passed, on a line not marked skipped or pending. Notes, skipped tests and summary counts cannot back a rule.',
  '3. Same behavior: development cases are compared again from their saved output bytes, with no missing or differing case. Explicitly approved differences are listed. For uplift, a baseline comparison may stand in: no regression, new failure, missing test/module, newly skipped test or drop in executed tests.',
  '4. Fresh inputs: at least 10 new input groups, excluding empty outputs and outputs identical to development outputs, ran on legacy and new code without a difference. When legacy could not run, the best verdict is PARTLY PROVEN.',
  '5. Canary: a deliberate break has its own result file or saved raw runner log showing additional failing tests beyond the clean run. Notes and typed counts are claims.',
  '6. Source untouched: no regular file under legacy/<system> is newer than PREFLIGHT.md (or the oldest top-level analysis file); links below the source root are not followed. An incomplete walk cannot pass. This is a timestamp check, not an immutability proof.',
  '7. Baseline measured (uplift): raw results, per-test JSON or a recognized runner log under baseline/ or on a Recorded:/Machine-readable: line backs BASELINE.md. Measured sources and the typed table must agree.',
  '8. Tests kept (uplift): legacy has test files, none was removed, and no more than 25% changed. Changed files are listed for human review; weakened assertions cannot be detected.',
  '9. Deltas covered (uplift): every Behavioral-silent code delta has its cited file stem named as a whole token by a test. Configuration-only sites are listed for a person. A mention does not prove that behavior was exercised.',
  'Unreadable, unsafe, changed or truncated evidence prevents PROVEN. The evaluator reads evidence only; it runs no project command, model, network request or version-control tool.',
  'Open questions, unticked criteria and human sign-off never change the computed verdict. Test-only build tooling is listed separately and is not counted as a business module.',
];
const row = (id, state, detail) => ({ id, label: CHECKS[id], state, detail: clean(detail, 700) });
const nint = v => Number.isInteger(v) && v >= 0 && v <= 1e9 ? v : null;
const pathsOf = v => (Array.isArray(v) ? v : [v]).slice(0, 20).filter(v => typeof v === 'string' && v);
const sum = (items, key) => items.reduce((n, e) => n + e[key], 0);
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k] === undefined ? '' : o[k]]));
const caseModule = s => s.name.toLowerCase();

export function loadTestRuns(io, adir) {
  const [obj, problem] = io.json(path.join(adir, 'equivalence/test-runs.json'));
  const out = { present: isObject(obj), problems: problem ? [problem] : [], date: '', legacy: { ran: null, how: '', why: '' }, suites: [], canaries: [], leftOut: [] };
  if (!isObject(obj)) { if (obj !== null) out.problems.push('test-runs.json is not an object'); return out; }
  out.date = clean(obj.date, 40); out.leftOut = (Array.isArray(obj.leftOut) ? obj.leftOut : []).slice(0, 20).filter(v => typeof v === 'string' && v.trim()).map(v => clean(v, 200));
  const lg = isObject(obj.legacy) ? obj.legacy : {}; out.legacy = { ran: typeof lg.ran === 'boolean' ? lg.ran : null, how: clean(lg.how, 300), why: clean(lg.why, 300) };
  for (const s of (Array.isArray(obj.suites) ? obj.suites : []).slice(0, 200)) if (isObject(s)) out.suites.push({ module: clean(s.module, 100), name: clean(s.name, 120), command: clean(s.command, 300), date: clean(s.date, 40),
    executed: nint(s.executed), failed: nint(s.failed), skipped: nint(s.skipped), skippedReason: clean(s.skippedReason, 300), note: clean(s.note, 300), junit: pathsOf(s.junit), log: pathsOf(s.log) });
  for (const c of (Array.isArray(obj.canaries) ? obj.canaries : []).slice(0, 50)) if (isObject(c)) out.canaries.push({ module: clean(c.module, 100), change: clean(c.change, 300), testsFailed: nint(c.testsFailed), junit: pathsOf(c.junit), log: pathsOf(c.log) });
  if ((obj.suites?.length ?? 0) > 200 || (obj.canaries?.length ?? 0) > 50) io.gap('test-runs.json exceeds the suite/canary limits');
  return out;
}
function suitesFor(ctx, subject) {
  const others = new Set(ctx.subjects.filter(s => s.track !== 'uplift').map(caseModule));
  return ctx.runs.suites.filter(s => { const mod = s.module.toLowerCase(); return !mod ? ctx.subjects.length === 1 : subject.track === 'uplift' ? !others.has(mod) && (!ctx.unit || mod === ctx.unit.toLowerCase() || mod === caseModule(subject)) : mod === caseModule(subject); });
}
function workspacePaths(ctx, paths) {
  return paths.flatMap(p => {
    const full = path.resolve(ctx.io.root, p);
    if (!within(ctx.io.root, full)) { ctx.io.gap('A result path is outside the workspace'); return []; }
    const safe = ctx.io.inside(full); return safe ? [safe] : [];
  });
}
function suiteResults(ctx, suite) {
  if (ctx.parsed.has(suite)) return ctx.parsed.get(suite);
  const { io } = ctx, ev = { name: suite.name, command: suite.command, date: suite.date, note: suite.note, notes: [], source: suite.executed !== null ? 'reported' : 'none', files: 0, newest: null, oldest: null, written: '',
    executed: suite.executed ?? 0, failed: suite.failed ?? 0, skipped: suite.skipped ?? 0, skippedNoReason: suite.skippedReason ? 0 : suite.skipped ?? 0 };
  const mismatch = () => { for (const key of ['executed', 'failed', 'skipped']) if (suite[key] !== null && suite[key] !== ev[key]) ev.notes.push(`Suite reported ${suite[key]} ${key}, files show ${ev[key]}; files were used`); };
  let parsed = null;
  const junit = workspacePaths(ctx, suite.junit);
  if (junit.length) {
    const fresh = readResults(io, junit); ev.notes.push(...fresh.unreadable.slice(0, 3).map(v => 'result file not used: ' + v));
    if (fresh.files) {
      const c = tally(Object.values(fresh.tests)); Object.assign(ev, { source: 'result files', files: fresh.files, newest: fresh.newest, oldest: fresh.oldest, written: utc(fresh.newest), executed: c.executed, failed: c.fail + c.error, skipped: c.skip,
        skippedNoReason: suite.skippedReason ? 0 : Object.entries(fresh.tests).filter(([id, st]) => st === 'SKIP' && !fresh.skipReasons[id]).length }); parsed = fresh; mismatch();
    } else ev.notes.push('No readable result file was found');
  }
  if (!parsed) {
    const logs = workspacePaths(ctx, suite.log);
    if (logs.length) {
      const got = readLogs(io, logs); ev.notes.push(...got.unrecognised.slice(0, 3).map(v => 'log not used: ' + v));
      if (got.files) { Object.assign(ev, pick(got, ['files', 'newest', 'oldest', 'executed', 'failed', 'skipped']), { source: 'runner log', written: utc(got.newest), skippedNoReason: suite.skippedReason ? 0 : got.skipped }); ev.notes.push('Counts read from summary lines of ' + got.runners.join(', ')); mismatch(); }
    }
  }
  const result = [ev, parsed]; ctx.parsed.set(suite, result); return result;
}
function referenceTime(io, adir) {
  const file = path.join(adir, 'PREFLIGHT.md'), preflight = stat(file); if (preflight?.isFile()) { io.watch(file); return preflight.mtimeMs / 1000; }
  if (!realDirectory(adir)) return null;
  const times = fs.readdirSync(adir).filter(n => !isFinderMetadata(n)).flatMap(n => { const file = path.join(adir, n), s = stat(file); if (!s?.isFile()) return []; io.watch(file); return [s.mtimeMs / 1000]; }); return times.length ? Math.min(...times) : null;
}
export function sourceCheck(io, system, adir) {
  const root = io.legacy(system), entry = path.join(io.root, 'legacy', system), ref = referenceTime(io, adir);
  const out = { state: 'unknown', method: SOURCE_METHOD, detail: '', files: [], path: 'legacy/' + system, target: stat(entry)?.isSymbolicLink() && root ? clean(root, 300) : '' };
  if (!root) return { ...out, detail: `legacy/${system} was not found, so it was not checked` };
  if (ref === null) return { ...out, detail: 'No PREFLIGHT.md or other analysis file dates the analysis' };
  const walk = io.walk(root, { hidden: false, skipDirs: new Set(['.git']), maxFiles: 400000 });
  for (const [, f] of walk.files) io.watch(f);
  const newer = walk.files.filter(([, f]) => stat(f).mtimeMs / 1000 > ref).map(([r]) => clean(r, 200));
  const incomplete = walk.cut || walk.links > 0;
  if (walk.links) io.gap('Links below the legacy source root were skipped; their contents were not checked');
  return { ...out, state: newer.length ? 'changed' : incomplete ? 'unknown' : 'clean', files: newer.slice(0, 20), detail: newer.length ? `${newer.length} file(s) changed after the analysis started` : incomplete ? 'The source walk could not fully check every path' : `no file changed after the analysis started (${walk.files.length} files compared)` };
}
export function briefItems(text, module, track) {
  if (!text) return { found: false, phase: '', items: [], count: 0 };
  const lines = text.split('\n').map(l => l.slice(0, 2000)), phases = []; let cur = null;
  for (const line of lines) {
    const m = /^#{2,5}\s+Phase\s+(\d+)\b/.exec(line);
    if (m) { cur = { n: Number(m[1]), title: clean(line.replace(/^[# ]+/, '').split(/\s[—-]\s/)[0], 60), command: '', modules: [], exit: [], inExit: false }; phases.push(cur); }
    else if (/^#{1,3}\s/.test(line)) cur = null;
    else if (cur) {
      const k = /^\s*(Command|Modules)\s*:\s*(.*)$/.exec(line);
      if (k?.[1] === 'Command') cur.command = k[2].toLowerCase();
      else if (k) cur.modules = k[2].split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean);
      else if (/^\s*Exit criteria\s*:/.test(line)) cur.inExit = true;
      else if (/^\s*(Entry criteria|Scale|Risk|Command|Modules)\s*:/.test(line)) cur.inExit = false;
      else if (cur.inExit) { const c = /^\s*[-*]\s*\[ \]\s*(.*)$/.exec(line); if (c) cur.exit.push(clean(c[1], 300)); }
    }
  }
  const verb = { rewrite: 'transform', reimagine: 'reimagine', uplift: 'uplift' }[track], byName = track !== 'uplift' ? phases.filter(p => p.modules.includes(module.toLowerCase())) : [];
  const mine = byName.length ? byName : phases.filter(p => p.command.includes(verb)), phaseN = mine.length ? Math.min(...mine.map(p => p.n)) : null;
  const items = mine.flatMap(p => p.exit.map(t => ({ text: t, where: p.title + ' exit criterion' }))); let level = null;
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) { if (/^(?:\d+[.)]?\s*)?open questions|^7[.):\s]/i.test(h[2])) level = h[1].length; else if (level !== null && h[1].length <= level) level = null; continue; }
    const c = level ? /^\s*[-*]\s*\[ \]\s*(.*)$/.exec(line) : null;
    if (c) { const tag = /\[before Phase (\d+)\]/i.exec(c[1]); if (!(tag && phaseN !== null && Number(tag[1]) > phaseN)) items.push({ text: clean(c[1].replaceAll('**', ''), 300), where: 'open question, section 7' }); }
  }
  return { found: true, phase: mine.length === 1 ? mine[0].title : '', items: items.slice(0, 40), count: items.length };
}
function checkTests(g, uplift, comparable) {
  let r;
  if (!g.suites.length) r = row('tests', 'fail', 'No test run is recorded for this module, so nothing executed. Record a real run in equivalence/test-runs.json.');
  else if (g.suites.every(e => e.source === 'none')) r = row('tests', 'gap', 'No test result could be read: no parsed result file, recognized runner log or reported counts.');
  else if (!g.executed) r = row('tests', 'fail', `Nothing executed: no test ran (${g.skipped} skipped).`);
  else if (g.failed && !(uplift && comparable)) r = row('tests', 'fail', `${g.failed} of ${g.executed} executed tests failed.`);
  else if (g.skippedNoReason && !(uplift && comparable)) r = row('tests', 'gap', `${g.skippedNoReason} tests were skipped with no reason given.`);
  else if (g.stale) r = row('tests', 'gap', 'Some result files are older than the code, so this was not a clean run of the current code.');
  else if (g.suites.some(e => ['none', 'reported'].includes(e.source))) r = row('tests', 'gap', 'Some suite counts were typed in rather than read from result files or runner logs.');
  else r = row('tests', 'pass', `${g.executed} tests executed, ${g.failed} failed${uplift && g.failed ? ' (judged against baseline)' : ''}, ${g.skipped} skipped.`);
  const notes = g.suites.map(e => e.note).filter(Boolean).join(' '); if (notes) r.detail = clean(r.detail + ' Note: ' + notes, 700); return r;
}
function checkRules(ctx, subject, evidence, caveats) {
  if (subject.track === 'uplift') return row('rules', 'na', 'An uplift keeps the code; the baseline comparison stands in for business-rule tracing.');
  if (!ctx.trace) return row('rules', 'gap', ctx.traceProblem);
  if (!ctx.trace.rules.length) return row('rules', 'gap', "BUSINESS_RULES.md has no rule cards in the form '### RULE-001: name'.");
  const view = moduleView(ctx.trace, subject.rel), p0 = view.rows.filter(r => r.priority === 'P0'), missing = p0.filter(r => r.status !== 'tested'), unrun = p0.filter(r => r.status === NOT_RUN);
  evidence.rules = { tied: view.tied, counted: view.rows.length, outOfScope: view.outOfScope, totals: view.totals, p0NoTests: missing.map(r => r.id), namedNotRun: unrun.map(r => r.id).slice(0, 100), perTestResults: Boolean(ctx.ran[subject.rel]?.known),
    p0: p0.slice(0, 100).map(r => ({ ...pick(r, ['id', 'name', 'confidence', 'status', 'main', 'tests', 'claimed', 'by']), where: clean(r.at || r.samples.tests[0] || r.samples.main[0] || '', 200) })) };
  if (!view.tied) caveats.push('Nothing ties a rule to this module by name, so every rule was counted.');
  if (missing.length) return row('rules', 'gap', `${missing.length} of ${p0.length} P0 rules have no actually passing test: ${missing.slice(0, 12).map(r => `${r.id} (${r.status})`).join(', ')}.`);
  return row('rules', 'pass', p0.length ? `All ${p0.length} P0 rules are backed by a test that ran and passed.` : `No rule this module answers for is rated P0 (${view.rows.length} rules counted).`);
}
function baselineState(ctx, paths, evidence, caveats, person) {
  const file = path.join(ctx.adir, 'BASELINE.md'), text = ctx.io.text(file);
  if (text === null) return { state: 'gap', detail: 'BASELINE.md is missing or unreadable.', comparable: false, info: null };
  const measured = readBaselineEvidence(ctx.io, evidencePaths(ctx.io, file, text)), info = assessBaseline(parseBaseline(text), measured);
  if (!paths.length) return { state: 'gap', detail: 'BASELINE.md exists, but no result files can be compared with it.', comparable: false, info };
  let b;
  try { b = baselineRun(ctx.io, file, paths, measured); } catch (e) { return { state: 'gap', detail: clean(e.message, 300), comparable: false, info }; }
  const keys = ['ok', 'regressionsCount', 'newFailuresCount', 'fixedCount', 'missingCount', 'missingModulesCount', 'moduleDiffsCount', 'renamed', 'executedDrop', 'skippedGrowth', 'stillFailingCount', 'newlySkippedCount', 'flakyCount', 'approvedCount'];
  evidence.baseline = { ...pick(b, keys), source: b.baseline.source, targetOnly: b.baseline.targetOnly, why: b.baseline.why, before: b.baseline.counts, now: b.fresh.counts,
    approved: b.approved.slice(0, 40), regressions: b.regressions.slice(0, 40), newFailures: b.newFailures.slice(0, 40), fixed: b.fixed.slice(0, 40), missing: b.missing.slice(0, 40) };
  if (b.fixedCount) person.push(`${b.fixedCount} tests failed before and pass now; review whether these are intended fixes.`);
  if (b.flakyCount) caveats.push(`${b.flakyCount} tests declared flaky flipped and were not counted as regressions.`);
  if (b.approvedCount) caveats.push(`${b.approvedCount} test differences approved in BASELINE.md were not counted.`);
  if (b.renamed) caveats.push(`${b.renamed} test names changed without their class getting worse and were counted as renamed.`);
  if (b.baseline.targetOnly || !b.baseline.counts) return { state: 'gap', detail: `The baseline is target-only: ${b.baseline.why || 'the old version did not run here'}.`, comparable: false, info };
  if (b.regressionsCount || b.newFailuresCount) return { state: 'fail', detail: `${b.regressionsCount} tests passed before and fail now; ${b.newFailuresCount} new or previously skipped tests fail now.`, comparable: true, info };
  const gaps = [[b.missingCount, 'baseline tests did not run'], [b.missingModulesCount, 'baseline modules are missing'], [b.moduleDiffsCount, 'modules ran fewer tests or skipped more'], [b.newlySkippedCount, 'previously passing tests are skipped']].filter(([n]) => n).map(([n, t]) => `${n} ${t}`);
  if (b.executedDrop) gaps.push(`executed tests dropped from ${b.executedDrop.before} to ${b.executedDrop.now}`);
  return { state: gaps.length ? 'gap' : 'pass', detail: gaps.length ? gaps.join('; ') + '.' : `No regression: ${b.fresh.counts.executed} tests executed against ${b.baseline.counts.executed} in the baseline (${b.baseline.source}).`, comparable: true, info };
}
function checkBaseline(info, evidence) {
  if (!info) return row('baseline', 'na', 'No BASELINE.md to check; see Same behavior.'); evidence.baselineEvidence = info;
  if (info.kind === 'target-only') return row('baseline', 'na', 'BASELINE.md is target-only; the old version was not measured here.');
  if (['typed', 'none'].includes(info.kind)) return row('baseline', 'gap', 'BASELINE.md is typed by hand: no per-test results or raw recognized runner log backs it. Save evidence under baseline/ or name it on a Recorded: line.');
  if (info.conflict) return row('baseline', 'gap', 'Baseline sources disagree: ' + info.conflictExamples.join('; '));
  if (info.disagree) return row('baseline', 'gap', `Measured results and the typed baseline disagree on ${info.disagree} tests or counts: ${info.examples.join('; ')}`);
  return row('baseline', 'pass', `Baseline is measured: ${info.measuredExecuted} executed, ${info.measuredFailed} failed; BASELINE.md agrees with its evidence.`);
}
function checkKept(tc, person) {
  if (!tc.checked) return row('kept', 'gap', 'Test files could not be compared: ' + tc.why);
  const c = tc.counts;
  if (c.added || c.removed || c.changed) person.push(`Review changed test files: ${c.changed} changed, ${c.added} added, ${c.removed} removed. Weakened assertions cannot be detected.`);
  if (!tc.legacyTests) return row('kept', 'gap', tc.why + ` (${tc.workTests} test files in the working copy).`);
  if (tc.cut) return row('kept', 'gap', 'The test-file comparison could not finish.');
  if (c.removed || c.changed > 0.25 * tc.legacyTests) return row('kept', 'gap', `${c.removed} legacy test files are missing; ${c.changed} of ${tc.legacyTests} changed (${Math.round(tc.share * 100)}%). More than 25% changed or a removal requires review.`);
  return row('kept', 'pass', `No legacy test file removed; ${c.changed} of ${tc.legacyTests} changed (${Math.round(tc.share * 100)}%); ${c.added} added. Review the list.`);
}
function checkDeltas(dc, person) {
  if (!dc.parsed) return row('deltas', 'gap', dc.why);
  if (dc.config.length) person.push(`${dc.config.length} Behavioral-silent deltas cite build/configuration files; decide how to check them.`);
  if (dc.uncovered.length) return row('deltas', 'gap', `${dc.uncovered.length} of ${dc.silent} Behavioral-silent deltas have no test naming their site: ${dc.uncovered.slice(0, 4).map(d => `${d.id} (${d.why})`).join('; ')}.`);
  return row('deltas', 'pass', dc.silent ? `All ${dc.covered.length} code deltas have their site's file named by a test; ${dc.config.length} configuration-only deltas need human review.` : `${dc.parsed} deltas in the catalog; none is Behavioral-silent.`);
}
function casesPaths(ctx, subject) {
  for (const [base, shared] of [[path.join(ctx.adir, 'equivalence', subject.name), false], [path.join(ctx.adir, 'equivalence'), ctx.subjects.length > 1]]) {
    const cases = path.join(base, 'cases.json'), fresh = path.join(base, 'fresh-cases.json'); if (stat(cases) || stat(fresh)) return { cases: stat(cases) ? cases : '', fresh: stat(fresh) ? fresh : '', shared };
  }
  return { cases: '', fresh: '', shared: false };
}
async function judge(ctx, file) {
  if (!file) return [null, null];
  try {
    ctx.io.resolve(file); const comparison = await compareCases(file, { proofIO: ctx.io, upstream: true }), r = comparison.report;
    const cases = r.cases.map(c => ({ ...c, verdict: c.status, legacySha256: c.sha256?.legacy ?? '', newSha256: c.sha256?.new ?? '', empty: c.bytes?.legacy === 0 && c.bytes?.new === 0,
      masked: (c.masks ?? []).map(m => `${Object.hasOwn(m, 'bytes') ? 'bytes ' + m.bytes : 'regex ' + m.regex}${m.why ? ' (' + m.why + ')' : ''}`), ...(c.toleratedNumbers ? { withinTolerance: { differing: c.toleratedNumbers } } : {}) }));
    const nonempty = cases.filter(c => c.status !== 'missing' && c.bytes?.legacy > 0);
    const totals = { cases: cases.length, executed: cases.filter(c => c.status !== 'missing').length, same: r.totals.same, differs: r.totals.differs, differsApproved: r.totals['differs-approved'], missing: r.totals.missing, sameWithinTolerance: cases.filter(c => c.withinTolerance).length };
    return [{ ...r, cases, totals, selfCheck: { passed: nonempty.length ? nonempty.every(c => c.selfCheckPassed) : null, detail: r.selfCheck.detail ?? '' } }, null];
  } catch (e) { return [null, clean(e.message, 300)]; }
}
function summaryOf(rec) {
  const masks = new Map(), tolerances = new Map();
  for (const c of rec.cases) {
    for (const m of c.masked) { const why = /\(([^()]*)\)\s*$/.exec(m)?.[1]?.trim() ?? 'no reason given: ' + m; if (!masks.has(why)) masks.set(why, new Set()); masks.get(why).add(c.id); }
    if (c.withinTolerance && c.tolerance) { const t = c.tolerance, key = JSON.stringify(t); if (!tolerances.has(key)) tolerances.set(key, { ...t, cases: 0 }); tolerances.get(key).cases++; }
  }
  const t = rec.totals;
  return { ...pick(t, ['cases', 'executed', 'same', 'differs', 'missing']), selfCheck: rec.selfCheck.passed, withinTolerance: t.sameWithinTolerance ?? 0, tolerances: [...tolerances.values()].slice(0, 10),
    approved: rec.cases.filter(c => c.verdict === 'differs-approved').slice(0, 40).map(c => ({ id: c.id, why: clean(c.approvedDifference, 300) })), masks: [...masks].sort(([a], [b]) => a.localeCompare(b)).slice(0, 10).map(([why, ids]) => ({ why, cases: ids.size })),
    differing: rec.cases.filter(c => ['differs', 'missing'].includes(c.verdict)).slice(0, 40).map(c => ({ id: c.id, reason: clean(c.reason || 'Saved outputs differ', 300) })) };
}
function checkSame(ctx, subject, paths, dev, problem, base, evidence, caveats) {
  let state = null, detail = '';
  if (dev) {
    const s = evidence.equivalence = summaryOf(dev), failed = !s.executed || s.differs || s.missing || s.selfCheck === false || dev.cases.every(c => c.empty);
    state = failed ? 'fail' : 'pass'; detail = `${s.executed} of ${s.cases} development cases executed: ${s.same} same, ${s.differs} differ, ${s.missing} missing; comparator self-check ${s.selfCheck === null ? 'not applicable' : s.selfCheck ? 'passed' : 'FAILED'}.`;
    if (s.approved.length) detail += ` ${s.approved.length} approved differences listed.`;
    const [recorded] = ctx.io.json(path.join(ctx.adir, 'EQUIVALENCE.json'));
    if (isObject(recorded?.totals) && ['cases', 'executed', 'same', 'differs', 'differsApproved', 'missing'].some(k => recorded.totals[k] !== dev.totals[k])) caveats.push('EQUIVALENCE.json does not match a fresh comparison of its cases.');
    if (paths.shared) caveats.push('Equivalence cases are shared by multiple modules, not attributed to this module alone.');
  } else if (problem) caveats.push(problem);
  if (subject.track === 'uplift') return row('same', state === 'fail' || base.state === 'fail' ? 'fail' : base.comparable ? base.state : state === 'pass' ? 'pass' : 'gap', [base.detail, detail].filter(Boolean).join(' '));
  if (state) return row('same', state, detail);
  return row('same', 'gap', stat(path.join(ctx.adir, 'EQUIVALENCE.json')) ? 'EQUIVALENCE.json exists but its cases were not found or could not be judged again.' : 'No usable equivalence cases were recorded; saved legacy and new outputs were not compared.' + (problem ? ' ' + problem : ''));
}
function checkFresh(ctx, paths, dev, legacyRan, frs, problem, evidence) {
  if (!legacyRan) return row('fresh', 'gap', 'Legacy could not run here' + (ctx.runs.legacy.why ? ` (${ctx.runs.legacy.why})` : '') + '; proof rests on recorded traces and cannot be PROVEN.');
  if (!frs) return row('fresh', 'gap', 'No usable fresh-input comparison (equivalence/fresh-cases.json)' + (problem ? ': ' + problem : '.'));
  const s = summaryOf(frs), hashes = new Set((dev?.cases ?? []).map(c => c.legacySha256).filter(Boolean)), ran = new Set(['same', 'differs', 'differs-approved']);
  const reused = new Set(frs.cases.filter(c => ran.has(c.verdict) && hashes.has(c.legacySha256)).map(c => c.id)), counted = frs.cases.filter(c => ran.has(c.verdict) && !reused.has(c.id) && !c.empty);
  Object.assign(s, { reused: [...reused].sort().slice(0, 40), comparisons: counted.length, inputs: new Set(counted.map(c => c.input || c.id)).size, needed: 10 }); evidence.fresh = s;
  if (ctx.runs.leftOut.length) s.leftOut = ctx.runs.leftOut;
  if (s.differs || s.missing || s.selfCheck === false) return row('fresh', 'fail', `${s.differs} fresh comparisons differ and ${s.missing} are missing; ${s.differing.slice(0, 5).map(d => `${d.id}: ${d.reason}`).join('; ') || 'the comparator self-check failed'}.`);
  if (s.inputs < 10) return row('fresh', 'gap', `Only ${s.inputs} new input groups counted; at least 10 are needed (${reused.size} repeated development outputs excluded).`);
  return row('fresh', 'pass', `${s.inputs} new input groups and ${s.comparisons} comparisons ran on legacy and new code without unapproved differences.`);
}
export function canariesIn(text) {
  const found = [];
  for (const line of (text ?? '').split('\n').filter(l => l.slice(0, 2000).includes('anary')).slice(0, 500)) {
    for (const m of line.slice(0, 600).matchAll(/Canary[^:\n|]{0,20}:\s*(.{1,300}?)\s*(?:→|->|=>|,)\s*(\d[\d,]*)\s+tests?\s+(?:failed|went red|failing)/gi)) found.push([clean(m[1], 200), Number(m[2].replaceAll(',', ''))]);
  }
  return found;
}
function checkCanary(ctx, subject, evidence, cleanBad, cleanFailed) {
  const shown = [], claimed = [], others = new Set(ctx.subjects.filter(s => s.track !== 'uplift').map(caseModule));
  for (const c of ctx.runs.canaries) {
    const mod = c.module.toLowerCase(); if (mod && mod !== caseModule(subject) && !(subject.track === 'uplift' && !others.has(mod))) continue;
    const junit = workspacePaths(ctx, c.junit), logs = workspacePaths(ctx, c.log); let failed = null, where = [];
    if (junit.length) { const fresh = readResults(ctx.io, junit); if (fresh.files) { failed = Object.entries(fresh.tests).filter(([t, st]) => BAD.has(st) && !cleanBad.has(t)).length; where = junit; } }
    if (failed === null && logs.length) { const got = readLogs(ctx.io, logs); if (got.files) { failed = Math.max(0, got.failed - cleanFailed); where = logs; } }
    const record = { change: c.change, testsFailed: failed ?? c.testsFailed, shown: failed !== null, where: where.slice(0, 3).map(p => slash(path.relative(ctx.io.root, p))) };
    (failed === null ? claimed : shown).push(record);
  }
  for (const n of NOTE_NAMES) for (const [change, testsFailed] of canariesIn(ctx.io.text(path.join(subject.path, n)))) claimed.push({ change, testsFailed, shown: false, where: [] });
  evidence.canary = [...shown, ...claimed].slice(0, 10);
  const silent = shown.find(c => c.testsFailed === 0);
  if (silent) return row('canary', 'fail', `A deliberate break ran and no additional test failed: ${silent.change || 'no description'}.`);
  if (shown.length) return row('canary', 'pass', `${shown.length} canary runs shown by real results/logs; the first caused ${shown[0].testsFailed} additional failures.`);
  return row('canary', 'gap', claimed.length ? 'Canary is claimed in notes/counts but no result file or raw runner log demonstrates it.' : 'No canary is recorded, so tests were never shown able to fail.');
}
function checkSource(ctx) {
  const src = ctx.source; return row('source', src.state === 'clean' ? 'pass' : 'gap', `${src.path}: ${src.detail}. Checked ${src.method}.${src.files.length ? ' First: ' + src.files.slice(0, 3).join(', ') : ''}`);
}
function notProven(subject, ev, legacyRan) {
  const out = ['Equivalence and fresh inputs are samples; behavior on untried inputs is not proven.'];
  if (!legacyRan) out.push('Legacy could not run here; recorded outputs and traces are only as trustworthy as their recording.');
  for (const key of ['equivalence', 'fresh']) {
    for (const m of ev[key]?.masks ?? []) out.push('Ignored fields may hide differences: ' + m.why);
    for (const t of ev[key]?.tolerances ?? []) out.push(`Declared tolerance permits numeric differences (relative ${t.rel}, absolute ${t.abs}): ${t.why}`);
  }
  if (ev.equivalence?.approved.length || ev.fresh?.approved.length || ev.baseline?.approvedCount) out.push('A human-approved difference is a decision, not evidence.');
  out.push('Speed, capacity, security, concurrency and unexercised behavior are not covered.');
  out.push(subject.track === 'uplift' ? 'Weakened assertions are not detected; a test naming a delta site does not demonstrate that it exercises the changed behavior.' : 'Behavior not extracted as a rule has no rule to trace; a name in a test does not establish assertion quality.');
  out.push('The canary demonstrates sensitivity to some change; timestamps do not establish source immutability.');
  out.push('The verdict does not replace the review and sign-off of the system owners.'); return out;
}
async function evaluate(subject, ctx) {
  const uplift = subject.track === 'uplift', evidence = {}, caveats = [], person = [], per = [], xml = [], cleanBad = new Set(); let oldest = null;
  for (const s of suitesFor(ctx, subject)) {
    const [ev, fresh] = suiteResults(ctx, s); per.push(ev); caveats.push(...ev.notes.map(n => `${ev.name || 'suite'}: ${n}`));
    if (ev.oldest !== null) oldest = Math.min(oldest ?? Infinity, ev.oldest);
    if (fresh) { xml.push(...workspacePaths(ctx, s.junit)); for (const [id, st] of Object.entries(fresh.tests)) if (BAD.has(st)) cleanBad.add(id); }
  }
  const walk = ctx.io.walk(subject.path, { skipDirs: SKIP_DIRS }), newest = walk.files.filter(([r]) => !DOC_EXT.has(path.extname(r).toLowerCase())).reduce((n, [, f]) => Math.max(n, stat(f).mtimeMs / 1000), 0);
  const g = { ...Object.fromEntries(['executed', 'failed', 'skipped', 'skippedNoReason'].map(k => [k, sum(per, k)])), suites: per, stale: oldest !== null && newest > oldest + 2 };
  evidence.tests = { ...pick(g, ['executed', 'failed', 'skipped', 'skippedNoReason', 'stale']), suites: per.slice(0, 20).map(e => pick(e, ['name', 'command', 'date', 'note', 'source', 'files', 'written', 'executed', 'failed', 'skipped'])) };
  const base = uplift ? baselineState(ctx, [...new Set(xml)], evidence, caveats, person) : null, paths = casesPaths(ctx, subject);
  const [dev, devProblem] = await judge(ctx, paths.cases), [fresh, freshProblem] = await judge(ctx, paths.fresh);
  let legacyRan = ctx.runs.legacy.ran; if (uplift && evidence.baseline?.targetOnly) legacyRan = false; if (legacyRan === null) legacyRan = Boolean(fresh?.totals.executed);
  evidence.legacy = { ...ctx.runs.legacy, ran: legacyRan };
  const checks = [checkTests(g, uplift, Boolean(base?.comparable)), checkRules(ctx, subject, evidence, caveats), checkSame(ctx, subject, paths, dev, devProblem, base, evidence, caveats), checkFresh(ctx, paths, dev, legacyRan, fresh, freshProblem, evidence), checkCanary(ctx, subject, evidence, cleanBad, g.failed), checkSource(ctx)];
  if (uplift) { evidence.testsChanged = testsChanged(ctx.io, ctx.io.legacy(ctx.system), subject.path); evidence.deltas = deltaCoverage(ctx.io, ctx.io.text(path.join(ctx.adir, 'DELTA_CATALOG.md')), subject.path); checks.push(checkBaseline(base.info, evidence), checkKept(evidence.testsChanged, person), checkDeltas(evidence.deltas, person)); }
  const record = { name: subject.name, track: subject.track, path: subject.rel, verdict: '', reasons: [], passed: [], checks, evidence, caveats: caveats.slice(0, 20), needsPerson: person.slice(0, 10), brief: briefItems(ctx.brief, subject.name, subject.track), notProven: notProven(subject, evidence, legacyRan), verifiedAt: ctx.now };
  return refreshVerdict(record);
}
function refreshVerdict(m) {
  m.verdict = m.checks.some(c => c.state === 'fail') ? 'NOT PROVEN' : m.checks.some(c => c.state === 'gap') ? 'PARTLY PROVEN' : 'PROVEN';
  m.reasons = m.checks.filter(c => ['fail', 'gap'].includes(c.state)).map(c => `${c.label}: ${c.detail}`);
  m.passed = m.checks.filter(c => c.state === 'pass').map(c => `${c.label}: ${c.detail}`); return m;
}
export function overall(pack) {
  const counts = Object.fromEntries(VERDICTS.map(v => [v, pack.modules.filter(m => m.verdict === v).length]));
  pack.overall = { verdict: counts['NOT PROVEN'] || !pack.modules.length ? 'NOT PROVEN' : counts['PARTLY PROVEN'] ? 'PARTLY PROVEN' : 'PROVEN', counts }; return pack;
}
export async function buildProofPack(system, workspace, module = null, { now, io = new EvidenceIO(workspace) } = {}) {
  name(system, 'system'); if (module !== null) name(module, 'module');
  const adir = io.resolve(`analysis/${system}`), subjects = discoverModules(io, system);
  if (!subjects.length) throw new ProofInputError(`Nothing is built under modernized/ for ${system}`);
  if (subjects.length > 1000) throw new ProofInputError('More than 1000 built modules; divide the workspace into systems');
  let unit = null;
  if (module && !subjects.some(s => caseModule(s) === module.toLowerCase())) {
    if (!subjects.some(s => s.track === 'uplift' && realDirectory(path.join(s.path, module)))) throw new ProofInputError(`No built module or uplift unit named ${module}`);
    unit = module;
  }
  const runs = loadTestRuns(io, adir), ctx = { io, adir, system, subjects, runs, unit, now: now ?? utc(Date.now() / 1000), brief: io.text(path.join(adir, 'MODERNIZATION_BRIEF.md')), source: sourceCheck(io, system, adir), parsed: new Map(), ran: dictionary(), trace: null, traceProblem: '' };
  for (const s of subjects.filter(s => s.track !== 'uplift')) ctx.ran[s.rel] = runEvidence(suitesFor(ctx, s).map(suite => suiteResults(ctx, suite)[1]));
  try { ctx.trace = traceRules(io, system, ctx.ran); } catch (e) { ctx.traceProblem = clean(e.message, 300); }
  const tooling = subjects.filter(s => s.track !== 'uplift' && toolingOnly(io, s.path)), modules = [];
  for (const s of [...subjects].sort((a, b) => caseModule(a).localeCompare(caseModule(b)))) if (!tooling.includes(s)) modules.push(await evaluate(s, ctx));
  const problems = [...runs.problems]; if (!runs.present) problems.push('equivalence/test-runs.json was not found, so no test run is recorded.'); if (tooling.length && !modules.length) problems.push('Every built folder contains only test tooling; there is no business module to judge.');
  io.unchanged();
  if (io.problems.length) {
    problems.push(...io.problems);
    for (const m of modules) { const check = m.checks.find(c => c.id === 'tests'); if (check.state !== 'fail') { check.state = 'gap'; check.detail = clean(check.detail + ' Evidence could not be completely read or remained unstable; see report problems.', 700); } refreshVerdict(m); }
  }
  const pack = overall({ v: 1, evaluator: 'codex-node-proof-pack', pluginVersion: PLUGIN_VERSION, upstreamCommit: 'c8874f5ad883e26428f483ffa4d537cc81489e64', system: clean(system, 100), generated: ctx.now, asked: clean(module ?? '', 100), rules: RULES_TEXT,
    legacy: { ...ctx.source, ran: runs.legacy.ran }, problems: [...new Set(problems)], modules, toolingOnly: tooling.map(s => ({ name: clean(s.name, 100), track: s.track, path: clean(s.rel, 200) })), signoff: { name: '', role: '', date: '', decision: '' },
    evidenceFiles: [...io.observed].map(([file, s]) => ({ path: slash(path.relative(io.root, file)), sha256: s.sha256, bytes: s.size })), sourceCheckIsImmutabilityProof: false });
  Object.defineProperty(pack, '_io', { value: io }); return pack;
}

// Markdown is text-only evidence; escape HTML, links, table syntax and directives
// from project-controlled names, notes, commands and approvals before publishing.
const md = value => clean(value, 2000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}[\]()#+!|]/g, '\\$&');
export function renderProofMarkdown(pack) {
  const lines = [`# Verification: ${md(pack.system)}`, '', `Computed by the Node proof pack on ${md(pack.generated)}. Evaluator: codex-node-proof-pack.`, '', `**Overall: ${pack.overall.verdict}**`, '', ...pack.problems.map(p => '- ' + md(p))];
  if (pack.asked) lines.push('', `Asked about ${md(pack.asked)}. Every built module is judged again from current evidence; previous verdicts are not reused.`);
  lines.push('', `Legacy source: ${md(pack.legacy.path)}. Checked ${md(pack.legacy.method)}.`, '', '| Module | Track | Verdict | Executed | Failed |', '|---|---|---|---:|---:|');
  for (const m of pack.modules) lines.push(`| ${md(m.name)} | ${m.track} | ${m.verdict} | ${m.evidence.tests.executed} | ${m.evidence.tests.failed} |`);
  if (pack.toolingOnly.length) lines.push('', '## Test tooling (not judged)', '', ...pack.toolingOnly.map(t => '- ' + md(t.path)));
  for (const m of pack.modules) {
    const ev = m.evidence;
    lines.push('', `## ${md(m.name)}: ${m.verdict}`, '', `Track: ${m.track}. Folder: ${md(m.path)}. Checked ${md(m.verifiedAt)}.`, '', '| Check | Result | Detail |', '|---|---|---|', ...m.checks.map(c => `| ${c.label} | ${c.state} | ${md(c.detail)} |`), '', '### Tests executed', '', ...ev.tests.suites.map(s => `- ${md(s.name || 'suite')}: ${md(s.command)}; from ${md(s.source)}: ${s.executed} executed, ${s.failed} failed, ${s.skipped} skipped. ${md(s.note)}`));
    if (ev.rules?.p0.length) lines.push('', '### P0 business rules', '', '| Rule | Name | Status | Evidence |', '|---|---|---|---|', ...ev.rules.p0.map(r => `| ${md(r.id)} | ${md(r.name)} | ${md(r.status)} | ${md(r.where)} |`));
    for (const [key, label] of [['equivalence', 'Development cases, judged again'], ['fresh', 'Fresh inputs']]) if (ev[key]) {
      const e = ev[key]; lines.push('', '### ' + label, '', `${e.executed} of ${e.cases} comparisons executed: ${e.same} same, ${e.differs} differ, ${e.missing} missing.`);
      if (key === 'fresh') lines.push(`${e.inputs} new input groups counted; ${e.reused.length} repeated development outputs excluded.`);
      lines.push(...e.approved.map(a => `- Approved difference ${md(a.id)}: ${md(a.why)}`), ...e.masks.map(a => `- Ignored by comparison: ${md(a.why)} (${a.cases} cases)`), ...e.tolerances.map(t => `- Tolerance (relative ${t.rel}, absolute ${t.abs}): ${md(t.why)}`), ...e.differing.map(d => `- ${md(d.id)}: ${md(d.reason)}`));
    }
    if (ev.baseline) { const b = ev.baseline; lines.push('', '### Baseline comparison', '', `${b.regressionsCount} regressions, ${b.newFailuresCount} new failures, ${b.fixedCount} fixed, ${b.missingCount} missing, ${b.renamed} renamed.`, ...b.regressions.map(r => `- Regression: ${md(r.id)} (${md(r.before)} → ${md(r.now)})`), ...b.newFailures.map(r => '- New failure: ' + md(r)), ...b.approved.map(r => `- Approved difference: ${md(r.id)} (${md(r.reason)})`)); }
    if (ev.baselineEvidence) lines.push('', '### Baseline evidence', '', `Kind: ${md(ev.baselineEvidence.kind)}. ${ev.baselineEvidence.disagree} typed/measured disagreements; ${ev.baselineEvidence.conflict} source conflicts.`, ...ev.baselineEvidence.examples.map(s => '- ' + md(s)), ...ev.baselineEvidence.conflictExamples.map(s => '- ' + md(s)));
    if (ev.testsChanged) { const t = ev.testsChanged; lines.push('', '### Test files changed during the uplift', '', `${t.legacyTests} legacy test files; ${t.workTests} in working copy. ${t.counts.changed} changed, ${t.counts.removed} removed, ${t.counts.added} added.`, ...t.removed.map(s => '- Removed: ' + md(s.path)), ...t.added.map(s => '- Added: ' + md(s.path)), ...t.changed.map(s => `- Changed: ${md(s.path)} (+${s.added} −${s.removed} lines; ${md(s.note)})`)); }
    if (ev.deltas) lines.push('', '### Version changes and the tests that name them', '', `${ev.deltas.parsed} deltas; ${ev.deltas.silent} Behavioral-silent. ${ev.deltas.covered.length} covered, ${ev.deltas.uncovered.length} uncovered, ${ev.deltas.config.length} configuration-only.`, ...ev.deltas.uncovered.map(d => `- ${md(d.id)}: ${md(d.why)}`), ...ev.deltas.config.map(d => `- For a person: ${md(d.id)} (${d.sites.map(md).join(', ')})`));
    lines.push('', '### Canary evidence', '', ...ev.canary.map(c => `- ${md(c.change)}: ${c.shown ? c.testsFailed + ' additional failing tests' : 'claimed only'}; ${c.where.map(md).join(', ')}`));
    if (m.caveats.length) lines.push('', '### Caveats', '', ...m.caveats.map(c => '- ' + md(c)));
    if (ev.fresh?.leftOut) lines.push('', 'Inputs left out: ' + ev.fresh.leftOut.map(md).join('; '));
    lines.push('', '### Waiting for a person', '', ...m.brief.items.map(i => `- [ ] ${md(i.text)} [${md(i.where)}]`), ...m.needsPerson.map(s => '- [ ] ' + md(s)), '', '### What this does not prove', '', ...m.notProven.map(s => '- ' + md(s)));
  }
  lines.push('', '## Sign-off', '', 'A person fills this in. The evaluator leaves it blank.', '', '- Name: ________________', '- Role: ________________', '- Date: __________', '- Decision: accept / accept with conditions / reject', '', '## How each verdict is computed', '', ...pack.rules.flatMap(s => [s, '']));
  return lines.join('\n') + '\n';
}
export async function writeProofPack(pack, workspace) {
  const io = pack._io ?? new EvidenceIO(workspace); io.resolve(`analysis/${pack.system}`);
  if (pack._io) { const before = io.problems.length; io.unchanged(); if (io.problems.length !== before) throw new ProofInputError('Evidence changed before report publication; run verification again'); }
  const adir = await safeMkdir(io.root, `analysis/${pack.system}`), json = path.join(adir, 'VERIFICATION.json'), markdown = path.join(adir, 'VERIFICATION.md');
  for (const file of [json, markdown]) { const s = stat(file); if (s && (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1)) throw new ProofInputError('Verification output is a link or not a regular private file'); if (io.observed.has(file)) throw new ProofInputError('Verification output would overwrite input evidence'); }
  const temporary = markdown + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temporary, renderProofMarkdown(pack), { flag: 'wx', mode: 0o600 }); await atomicJSON(json, pack); fs.renameSync(temporary, markdown); }
  finally { fs.rmSync(temporary, { force: true }); }
  return { json, markdown };
}
