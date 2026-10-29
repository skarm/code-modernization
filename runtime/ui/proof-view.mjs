// SPDX-License-Identifier: Apache-2.0
// Report projection of the original build_report.py proof view. This validates
// a saved pack's consistency; only proof-pack.mjs evaluates the evidence files.
import { CHECKS } from '../proof-pack.mjs';
import { clean, isObject } from '../proof-io.mjs';
const obj = v => isObject(v) ? v : {};
const list = (v, cap = 100) => Array.isArray(v) ? v.slice(0, cap) : [];
const words = (v, cap = 40) => list(v, cap).filter(v => typeof v === 'string').map(v => clean(v, 700));
const count = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;
const counts = (v, keys) => Object.fromEntries(keys.map(k => [k, count(obj(v)[k])]));
const VERDICTS = ['PROVEN', 'PARTLY PROVEN', 'NOT PROVEN'];
const required = ['tests', 'rules', 'same', 'fresh', 'canary', 'source'];
const verdictOf = checks => checks.some(c => c.state === 'fail') ? 'NOT PROVEN' : checks.some(c => c.state === 'gap') ? 'PARTLY PROVEN' : 'PROVEN';
const compare = v => isObject(v) ? { ...counts(v, ['cases', 'inputs', 'executed', 'same', 'differs', 'missing', 'withinTolerance']),
  tolerances: list(v.tolerances, 10).map(t => ({ rel: clean(t?.rel), abs: clean(t?.abs), why: clean(t?.why, 300), cases: count(t?.cases) })),
  approved: list(v.approved, 20).map(t => ({ id: clean(t?.id), why: clean(t?.why, 300) })), masks: list(v.masks, 10).map(t => ({ why: clean(t?.why, 300), cases: count(t?.cases) })) } : null;

function upliftView(ev) {
  const b = obj(ev.baselineEvidence), t = obj(ev.testsChanged), d = obj(ev.deltas);
  const file = t => ({ path: clean(t?.path, 300), lines: count(t?.lines), added: count(t?.added), removed: count(t?.removed), note: clean(t?.note) });
  const delta = t => ({ id: clean(t?.id), title: clean(t?.title, 200), why: clean(t?.why, 300), sites: words(t?.sites, 10) });
  return { baseline: Object.keys(b).length ? { kind: clean(b.kind), disagree: count(b.disagree), conflict: count(b.conflict), sources: list(b.sources, 10).filter(isObject).map(s => ({ kind: clean(s.kind), name: clean(s.name), tests: count(s.tests), executed: count(s.executed) })), examples: words(b.examples), conflictExamples: words(b.conflictExamples) } : null,
    testsChanged: Object.keys(t).length ? { checked: t.checked === true, why: clean(t.why, 300), legacyTests: count(t.legacyTests), workTests: count(t.workTests), counts: counts(t.counts, ['added', 'removed', 'changed']), removed: list(t.removed, 40).map(file), changed: list(t.changed, 40).map(file), added: list(t.added, 40).map(file) } : null,
    deltas: Object.keys(d).length ? { parsed: count(d.parsed), silent: count(d.silent), coveredCount: list(d.covered, 100000).length, uncoveredCount: list(d.uncovered, 100000).length, uncovered: list(d.uncovered, 40).map(delta), config: list(d.config, 40).map(delta), why: clean(d.why, 300) } : null };
}

export function proofView(raw) {
  if (!isObject(raw) || !Array.isArray(raw.modules)) return null;
  const problems = words(raw.problems);
  if (raw.modules.length > 1000) problems.push('The pack exceeds 1000 modules; its overview is incomplete.');
  const modules = list(raw.modules, 1000).filter(isObject).map(m => {
    const ev = obj(m.evidence), tests = counts(ev.tests, ['executed', 'failed', 'skipped']);
    const needed = [...required, ...(m.track === 'uplift' ? ['baseline', 'kept', 'deltas'] : [])];
    const checks = needed.map(id => {
      const c = list(m.checks, 20).find(c => c?.id === id);
      return { id, label: CHECKS[id], state: ['pass', 'gap', 'fail', 'na'].includes(c?.state) ? c.state : 'gap', detail: c ? clean(c.detail, 700) : 'This check is missing from VERIFICATION.json.' };
    });
    const downgrade = (id, state, detail) => { const c = checks.find(c => c.id === id); if (c && ['pass', 'na'].includes(c.state)) Object.assign(c, { state, detail }); };
    const p0 = list(obj(ev.rules).p0, 10000).filter(isObject).map(r => ({ id: clean(r.id), name: clean(r.name, 200), confidence: clean(r.confidence), status: clean(r.status), tests: count(r.tests), main: count(r.main), where: clean(r.where, 250) }));
    const eq = compare(ev.equivalence), fresh = compare(ev.fresh), uplift = m.track === 'uplift' ? upliftView(ev) : null;
    if (!tests.executed || tests.failed && m.track !== 'uplift') downgrade('tests', 'fail', 'The saved evidence records no executed tests or failing tests.');
    if (p0.some(r => r.status !== 'tested')) downgrade('rules', 'gap', 'Some P0 rules are not backed by a passing test.');
    if (!fresh || fresh.inputs < 10) downgrade('fresh', 'gap', 'Fewer than ten fresh inputs are recorded.');
    for (const [id, c] of [['same', eq], ['fresh', fresh]]) if (c?.differs || c?.missing) downgrade(id, 'fail', 'Some recorded cases differ or are missing.');
    if (uplift) {
      const { baseline: b, testsChanged: t, deltas: d } = uplift;
      if (b && b.kind !== 'target-only' && (b.kind !== 'measured' || b.disagree || b.conflict)) downgrade('baseline', 'gap', 'The saved baseline is not backed by consistent measurements.');
      if (!t?.checked || !t.legacyTests || t.counts.removed || t.counts.changed > t.legacyTests * .25) downgrade('kept', 'gap', 'The saved test comparison does not show the tests were kept.');
      if (!d?.parsed || d.uncoveredCount) downgrade('deltas', 'gap', 'The saved catalog has uncovered or missing deltas.');
    }
    const verdict = verdictOf(checks);
    if (m.verdict !== verdict) problems.push(`${clean(m.name)}: recorded ${clean(m.verdict)}, but the saved checks and counts give ${verdict}.`);
    const brief = obj(m.brief), people = list(brief.items, 40).map(i => ({ text: clean(i?.text, 300), where: clean(i?.where) }));
    return { name: clean(m.name, 120), track: clean(m.track), verdict, verifiedAt: clean(m.verifiedAt), checks,
      reasons: checks.filter(c => ['gap', 'fail'].includes(c.state)).map(c => `${c.label}: ${c.detail}`), passed: checks.filter(c => c.state === 'pass').map(c => `${c.label}: ${c.detail}`),
      tests, hasRules: isObject(ev.rules), p0, p0Counts: { tested: p0.filter(r => r.status === 'tested').length, notRun: p0.filter(r => r.status === 'named, not run').length, claimedOnly: p0.filter(r => r.status === 'claimed only').length, none: p0.filter(r => !['tested', 'named, not run', 'claimed only'].includes(r.status)).length },
      equivalence: eq, fresh, baseline: isObject(ev.baseline) ? counts(ev.baseline, ['regressionsCount', 'newFailuresCount', 'fixedCount', 'missingCount']) : null, uplift,
      canary: list(ev.canary, 10).map(c => ({ change: clean(c?.change, 300), testsFailed: count(c?.testsFailed), shown: c?.shown === true })),
      people, peopleCount: Math.max(count(brief.count), people.length), briefFound: brief.found === true,
      notProven: words(m.notProven), needsPerson: words(m.needsPerson), caveats: words(m.caveats) };
  });
  const totals = Object.fromEntries(VERDICTS.map(v => [v, modules.filter(m => m.verdict === v).length]));
  const verdict = !modules.length || totals['NOT PROVEN'] ? 'NOT PROVEN' : totals['PARTLY PROVEN'] || raw.modules.length > 1000 ? 'PARTLY PROVEN' : 'PROVEN';
  return { generated: clean(raw.generated), verdict, counts: totals, headline: `Proof: ${VERDICTS.filter(v => totals[v]).map(v => `${totals[v]} ${v}`).join(', ') || 'no module was verified'} (${modules.length} modules).`, modules, problems,
    legacy: obj(raw.legacy), tooling: list(raw.toolingOnly, 20).map(t => ({ name: clean(t?.name), path: clean(t?.path) })), rules: words(raw.rules), signoff: obj(raw.signoff) };
}
