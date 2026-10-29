// SPDX-License-Identifier: Apache-2.0
// Original report case table, supporting both upstream and Node comparator fields.
import { clean, isObject } from '../proof-io.mjs';
export function equivalenceView(raw) {
  if (!isObject(raw) || !Array.isArray(raw.cases)) return null;
  const tally = { cases: 0, executed: 0, same: 0, differs: 0, 'differs-approved': 0, missing: 0, inconsistent: 0, unknown: 0 }, problems = [], rows = [];
  for (const c of raw.cases.slice(0, 10000).filter(isObject)) {
    const word = c.verdict ?? c.status;
    let verdict = ['same', 'differs', 'differs-approved', 'missing'].includes(word) ? word : 'unknown';
    const legacySha256 = clean(c.legacySha256 ?? c.sha256?.legacy), newSha256 = clean(c.newSha256 ?? c.sha256?.new);
    const masked = (Array.isArray(c.masked) ? c.masked : Array.isArray(c.masks) ? c.masks.map(m => m.why || 'Declared byte/regex mask') : []).slice(0, 20).map(m => clean(m, 200));
    const tolerance = isObject(c.tolerance) && Number(c.toleratedNumbers) > 0;
    if (verdict === 'same' && (c.firstDiff || !masked.length && !tolerance && /^[a-f0-9]{64}$/.test(legacySha256) && /^[a-f0-9]{64}$/.test(newSha256) && legacySha256 !== newSha256) || verdict === 'differs-approved' && !String(c.approvedDifference ?? '').trim()) verdict = 'inconsistent';
    tally[verdict]++; tally.cases++;
    if (['same', 'differs', 'differs-approved', 'inconsistent'].includes(verdict)) tally.executed++;
    const row = { id: clean(c.id, 80), title: clean(c.title ?? c.input), verdict, reason: clean(c.reason, 500), legacyPath: clean(c.legacyPath ?? c.legacy, 300), newPath: clean(c.newPath ?? c.new, 300), legacySha256, newSha256, masked,
      approvedDifference: clean(c.approvedDifference, 500), note: clean(c.note, 500), empty: c.empty === true || c.nonempty === false,
      ...(isObject(c.firstDiff) ? { firstDiff: { offset: Number(c.firstDiff.offset) || 0, line: Number(c.firstDiff.line) || 0, at: Number(c.firstDiff.at) || 0, legacy: clean(c.firstDiff.legacy, 200), new: clean(c.firstDiff.new, 200) } } : {}) };
    if (isObject(c.bytes) && isObject(c.maskedBytes)) row.sizes = Object.fromEntries(['legacy', 'new'].map(k => [k, [Number(c.bytes[k]) || 0, Number(c.maskedBytes[k]) || 0]]));
    if (verdict === 'inconsistent') problems.push(`Case ${row.id}: its saved verdict contradicts its own evidence.`);
    rows.push(row);
  }
  if (raw.cases.length > 10000) problems.push('Only the first 10000 cases could be counted; the result is incomplete.');
  const check = { passed: typeof raw.selfCheck?.passed === 'boolean' ? raw.selfCheck.passed : null, detail: clean(raw.selfCheck?.detail, 300), recorded: isObject(raw.selfCheck) };
  if (!check.recorded) problems.push('No comparator self-check is recorded.');
  if (raw.totals && (raw.totals.cases !== tally.cases || raw.totals.executed !== tally.executed)) problems.push('Saved totals disagree with the case list; the case list was used.');
  const empty = tally.executed > 0 && rows.filter(r => r.verdict !== 'missing').every(r => r.empty);
  const failed = !tally.executed || empty || tally.differs + tally.missing + tally.inconsistent + tally.unknown > 0 || check.passed === false || raw.cases.length > 10000;
  const headline = !tally.executed ? 'Equivalence not proven: no case was executed.' : empty ? 'Equivalence not proven: every output was empty.' : failed ? `Equivalence not proven: ${tally.differs} differing, ${tally.missing} missing, ${tally.inconsistent + tally.unknown} contradictory or unrecognised cases.` : `Outputs match on all ${tally.executed} executed cases${tally['differs-approved'] ? ` (${tally['differs-approved']} with an approved difference)` : ''}.`;
  const endpoint = v => ({ label: clean(v?.label, 300), command: clean(v?.command, 300) });
  return { state: failed ? 'red' : 'green', headline, problems, selfCheck: check, generated: clean(raw.generated ?? raw.date), tally, legacy: endpoint(raw.legacy), new: endpoint(raw.new), cases: rows.slice(0, 2000), cut: Math.max(0, rows.length - 2000) };
}
