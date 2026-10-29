// SPDX-License-Identifier: Apache-2.0
// Mechanical observation comparison, not a business-equivalence or release verdict.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicJSON, hash, invariant, object, readJSON, redact, relative, safeResolve, text, within } from './util.mjs';
import { PLUGIN_VERSION } from './version.mjs';
import { regexSpans } from './regex-mask.mjs';

const MARK = Buffer.from('\0<MASK>\0');
const MAX_FILE_BYTES = 32 * 1024 * 1024, MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const abs = n => n < 0n ? -n : n;

function decimal(value) {
  const s = String(value);
  invariant(s.length <= 64, 'Numeric token exceeds 64 characters');
  const m = /^([+-]?)(\d*\.?\d+|\d+\.)(?:e([+-]?\d+))?$/i.exec(s);
  invariant(m, 'Invalid decimal token');
  const fraction = m[2].includes('.') ? m[2].split('.')[1].length : 0;
  const exponent = Number(m[3] ?? 0) - fraction;
  invariant(Number.isSafeInteger(exponent) && Math.abs(exponent) <= 1000, 'Decimal exponent exceeds supported range');
  return { n: BigInt((m[1] === '-' ? '-' : '') + m[2].replace('.', '')), e: exponent };
}
function align(a, b) {
  const e = Math.min(a.e, b.e);
  return [a.n * 10n ** BigInt(a.e - e), b.n * 10n ** BigInt(b.e - e), e];
}
function greater(a, b) { const [x, y] = align(a, b); return x > y; }
function tolerance(spec) {
  if (spec === undefined || spec === null) return null;
  object(spec, 'tolerance');
  const rel = spec.rel ?? 0, absolute = spec.abs ?? 0;
  invariant(typeof rel === 'number' && Number.isFinite(rel) && rel >= 0 && rel <= 0.01, 'Relative tolerance must be between 0 and 0.01');
  invariant(typeof absolute === 'number' && Number.isFinite(absolute) && absolute >= 0 && absolute <= 1e-6, 'Absolute tolerance must be between 0 and 1e-6');
  invariant(rel > 0 || absolute > 0, 'Tolerance must have a positive bound');
  text(spec.why, 'tolerance reason', 1000);
  return { rel, abs: absolute, why: spec.why, relative: decimal(rel), absolute: decimal(absolute) };
}
function* tokens(bytes) {
  const value = bytes.toString('latin1');
  const pattern = /(\d+(?:\.\d+){2,})|([-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let start = 0;
  for (const match of value.matchAll(pattern)) {
    if (match[1] !== undefined) continue; // Dotted identifiers remain literal text.
    if (match.index > start) yield { numeric: false, value: value.slice(start, match.index) };
    yield { numeric: true, value: match[0] }; start = match.index + match[0].length;
  }
  if (start < value.length) yield { numeric: false, value: value.slice(start) };
}
function equal(a, b, tol) {
  if (a.equals(b)) return { same: true, toleratedNumbers: 0 };
  if (!tol) return { same: false, toleratedNumbers: 0 };
  const left = tokens(a), right = tokens(b);
  let toleratedNumbers = 0;
  while (true) {
    const l = left.next(), r = right.next();
    if (l.done || r.done) return { same: l.done && r.done, toleratedNumbers };
    const x = l.value, y = r.value;
    if (x.value === y.value) continue;
    if (!x.numeric || !y.numeric || !/[.eE]/.test(x.value) || !/[.eE]/.test(y.value)) return { same: false, toleratedNumbers };
    const dx = decimal(x.value), dy = decimal(y.value), [nx, ny, e] = align(dx, dy);
    const diff = { n: abs(nx - ny), e }, scale = { n: abs(nx) > abs(ny) ? abs(nx) : abs(ny), e };
    const relativeBound = { n: tol.relative.n * scale.n, e: tol.relative.e + scale.e };
    if (greater(diff, tol.absolute) && greater(diff, relativeBound)) return { same: false, toleratedNumbers };
    toleratedNumbers++;
  }
}
async function ranges(specs, bytes, upstream = false, budget) {
  invariant(specs === undefined || Array.isArray(specs), 'mask must be an array');
  invariant((specs?.length ?? 0) <= 32, 'At most 32 masks per case');
  const out = [];
  for (let spec of specs ?? []) {
    object(spec, 'mask');
    invariant(Object.hasOwn(spec, 'regex') !== Object.hasOwn(spec, 'bytes'), 'Each mask needs exactly one of bytes or regex');
    if (!upstream || spec.why) text(spec.why, 'mask reason', 1000);
    if (Object.hasOwn(spec, 'regex')) {
      text(spec.regex, 'mask regex', 2048);
      if (budget) { invariant(++budget.regexRuns <= 1000 && Date.now() < budget.deadline, 'Regex comparison exceeded its aggregate work budget'); }
      out.push(...await regexSpans(bytes, spec.regex, { timeoutMs: budget ? Math.max(1, Math.min(2000, budget.deadline - Date.now())) : 2000 })); continue;
    }
    if (upstream && typeof spec.bytes === 'number') spec = { ...spec, bytes: String(spec.bytes) };
    text(spec.bytes, 'mask byte ranges', 2000);
    for (const part of spec.bytes.split(',')) {
      const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
      invariant(m, 'Invalid byte mask range');
      const start = Number(m[1]), end = Number(m[2] ?? m[1]);
      invariant(Number.isSafeInteger(start) && Number.isSafeInteger(end) && end >= start && end < Number.MAX_SAFE_INTEGER, 'Invalid byte mask range');
      out.push([start, end + 1]);
    }
  }
  const merged = [];
  for (const [start, end] of out.sort((a, b) => a[0] - b[0])) {
    if (merged.length && start <= merged.at(-1)[1]) merged.at(-1)[1] = Math.max(end, merged.at(-1)[1]);
    else merged.push([start, end]);
  }
  return merged;
}
function masked(bytes, spans) {
  const parts = []; let pos = 0, hidden = 0;
  for (const [start, rawEnd] of spans) {
    if (start >= bytes.length) continue;
    const end = Math.min(bytes.length, rawEnd);
    parts.push(bytes.subarray(pos, start), MARK); hidden += end - start; pos = end;
  }
  parts.push(bytes.subarray(pos));
  return { bytes: Buffer.concat(parts), hidden };
}
async function sensitivity(bytes, spans, tol, masks, upstream, budget) {
  if (!bytes.length) return false;
  let at = 0;
  for (const [start, end] of spans) { if (at < start) break; if (at < end) at = end; }
  if (at >= bytes.length) return false;
  const differs = async pos => {
    const changed = Buffer.from(bytes); changed[pos] ^= 1;
    const changedSpans = masks?.some(m => Object.hasOwn(m, 'regex')) ? await ranges(masks, changed, upstream, budget) : spans;
    return !equal(masked(bytes, spans).bytes, masked(changed, changedSpans).bytes, tol).same;
  };
  if (!await differs(at)) return false;
  if (tol) {
    const pattern = /(\d+(?:\.\d+){2,})|([-+]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
    let checked = 0;
    for (const m of bytes.subarray(0, 1 << 20).toString('latin1').matchAll(pattern)) {
      if (checked++ >= 200) break;
      if (!m[2] || !/[.eE]/.test(m[2]) || spans.some(([a, b]) => a <= m.index && m.index < b)) continue;
      const pos = m.index + m[0].search(/[0-9]/);
      if (!await differs(pos)) return false;
    }
  }
  return true;
}
async function observation(base, file, budget, proofIO) {
  if (proofIO) proofIO.resolve(path.resolve(base, relative(file, 'observation path')));
  const full = await safeResolve(base, relative(file, 'observation path'));
  const st = await fs.stat(full);
  invariant(st.isFile() && st.size <= MAX_FILE_BYTES, 'Observation is not a regular file or exceeds 32 MiB');
  budget.bytes += st.size;
  invariant(budget.bytes <= MAX_TOTAL_BYTES, 'Observations exceed the 256 MiB comparison budget');
  const bytes = proofIO ? proofIO.read(full, MAX_FILE_BYTES) : await fs.readFile(full);
  invariant(bytes.length === st.size, 'Observation changed while being read');
  return { bytes, full, sha256: digest(bytes) };
}

export async function compareCases(casesFile, { proofIO, upstream = false } = {}) {
  if (proofIO) proofIO.resolve(casesFile);
  const file = await fs.realpath(casesFile), base = path.dirname(file);
  const spec = object(proofIO ? proofIO.json(file)[0] : await readJSON(file), 'case manifest');
  invariant(Array.isArray(spec.cases) && (upstream || spec.cases.length > 0) && spec.cases.length <= 5000, 'cases must contain at most 5000 observations');
  const approved = spec.approvedInputs === undefined ? {} : object(spec.approvedInputs, 'approvedInputs');
  for (const reason of Object.values(approved)) text(reason, 'approved input reason', 10000);
  const ids = new Set(), records = [], budget = { bytes: 0, regexRuns: 0, deadline: Date.now() + 30000 }, protectedFiles = new Set([file]);
  let selfChecks = 0;
  for (let index = 0; index < spec.cases.length; index++) {
    let item = spec.cases[index];
    if (upstream && item && typeof item === 'object') item = { ...item, id: String(item.id || `C${String(index + 1).padStart(2, '0')}`).slice(0, 80),
      input: typeof item.input === 'string' && item.input.trim() ? item.input : undefined };
    object(item, 'case'); text(item.id, 'case id', 200);
    invariant(!ids.has(item.id), `Duplicate case id: ${item.id}`); ids.add(item.id);
    const input = item.input ?? item.id; text(input, 'case input', 200);
    const record = { id: item.id, input, legacy: item.legacy, new: item.new, status: 'missing' };
    for (const field of ['legacy', 'new']) {
      try { protectedFiles.add(path.resolve(base, relative(item[field], 'observation path'))); } catch { /* Report invalid paths below. */ }
    }
    try {
      const tol = tolerance(Object.hasOwn(item, 'tolerance') ? item.tolerance : spec.tolerance);
      const old = await observation(base, item.legacy, budget, proofIO); protectedFiles.add(old.full);
      const current = await observation(base, item.new, budget, proofIO); protectedFiles.add(current.full);
      const spans = await ranges(item.mask, old.bytes, upstream, budget), newSpans = item.mask?.some(m => Object.hasOwn(m, 'regex')) ? await ranges(item.mask, current.bytes, upstream, budget) : spans;
      const left = masked(old.bytes, spans), right = masked(current.bytes, newSpans);
      const compared = equal(left.bytes, right.bytes, tol);
      const approval = item.approvedDifference ?? (Object.hasOwn(approved, input) ? approved[input] : undefined);
      if (approval !== undefined) text(approval, 'approved difference reason', 10000);
      Object.assign(record, { status: compared.same ? 'same' : approval ? 'differs-approved' : 'differs',
        sha256: { legacy: old.sha256, new: current.sha256 }, bytes: { legacy: old.bytes.length, new: current.bytes.length },
        maskedBytes: { legacy: left.hidden, new: right.hidden }, masks: item.mask ?? [],
        toleratedNumbers: compared.toleratedNumbers, nonempty: old.bytes.length > 0 && current.bytes.length > 0,
        ...(tol ? { tolerance: { rel: tol.rel, abs: tol.abs, why: tol.why } } : {}),
        ...(approval ? { approvedDifference: approval } : {}) });
      record.selfCheckPassed = await sensitivity(old.bytes, spans, tol, item.mask, upstream, budget);
      if (record.selfCheckPassed) selfChecks++;
    } catch (error) { record.status = 'missing'; record.reason = String(error.message); }
    records.push(record);
  }
  const gaps = records.filter(r => r.status === 'missing').map(r => `${r.id}: ${r.reason}`);
  for (const r of records) if (r.status !== 'missing' && !r.selfCheckPassed) gaps.push(`${r.id}: no unmasked nonempty observation passed the mutation self-check`);
  const totals = Object.fromEntries(['same', 'differs', 'differs-approved', 'missing'].map(status => [status, records.filter(r => r.status === status).length]));
  Object.assign(totals, { cases: records.length, executed: records.filter(r => r.status !== 'missing').length,
    differsApproved: totals['differs-approved'], sameWithinTolerance: records.filter(r => r.toleratedNumbers > 0).length });
  const passed = totals.differs === 0 && gaps.length === 0 && records.some(r => r.nonempty) && selfChecks > 0;
  const report = { system: typeof spec.system === 'string' ? spec.system : '', date: new Date().toISOString(),
    evaluator: 'codex-node-comparator', pluginVersion: PLUGIN_VERSION, manifestFingerprint: hash(spec),
    cases: records, totals, inputGroups: { total: new Set(records.map(r => r.input)).size,
      comparedNonempty: new Set(records.filter(r => r.nonempty && ['same', 'differs-approved'].includes(r.status)).map(r => r.input)).size },
    coverageGaps: gaps, selfCheck: { passed: gaps.length === 0 && selfChecks > 0, checkedCases: selfChecks },
    passed, incomplete: !passed, behaviorEquivalenceProven: false };
  // Paths used only to prevent report output from overwriting inputs; not model claims.
  return { report: redact(report), base, protectedFiles };
}

export async function writeComparison(comparison, output = 'EQUIVALENCE.json') {
  const file = path.resolve(comparison.base, text(output, 'comparison output', 2000));
  invariant(within(comparison.base, file) && file !== comparison.base, 'Comparison output must stay in the cases directory');
  const parent = path.relative(comparison.base, path.dirname(file));
  if (parent) await safeResolve(comparison.base, parent.split(path.sep).join('/'), { directory: true, noLinks: true });
  invariant(!comparison.protectedFiles.has(file), 'Comparison output would overwrite an input');
  await atomicJSON(file, comparison.report);
  return file;
}
