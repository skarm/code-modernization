// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { readModel } from './model.mjs';
import { atomicText, uiRedact as redact } from './files.mjs';
import { clean } from '../proof-io.mjs';
import { equivalenceView } from './equivalence-view.mjs';

export const scriptJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
const ASSETS = new URL('../../assets/', import.meta.url);
const DOCS = [
  ['overview', 'Overview', ['INTENT.md', 'PREFLIGHT.md']], ['assessment', 'Assessment', ['ASSESSMENT.md']],
  ['diagrams', 'Diagrams', []], ['rules', 'Business rules', ['BUSINESS_RULES.md', 'RULE_REVIEWS.md', 'DATA_OBJECTS.md']],
  ['brief', 'Brief', ['MODERNIZATION_BRIEF.md']], ['security', 'Security', ['SECURITY_FINDINGS.md']],
  ['delta', 'Delta catalog & baseline', ['DELTA_CATALOG.md', 'BASELINE.md', 'PLAYBOOK.md']],
  ['spec', 'Spec & architecture', ['AI_NATIVE_SPEC.md', 'REIMAGINED_ARCHITECTURE.md']], ['build', 'Build notes', []],
  ['proof', 'Proof', ['VERIFICATION.md']], ['equivalence', 'Equivalence', []],
];

function ruleBlocks(text, rules) {
  const byId = new Map(rules.map(r => [r.id, r])), blocks = [];
  let buffer = [], active = null, level = 0, fence = '';
  const flush = () => {
    if (active) blocks.push({ k: 'rule', id: active.id, title: active.title, heading: active.id, p: active.priority, conf: active.confidence ?? '', cat: active.category ?? '', defect: Boolean(active.defect), cites: active.citations.map(c => `${c.path}:${c.from}-${c.to}`), body: buffer.join('\n') });
    else if (buffer.join('').trim()) blocks.push({ k: 'md', text: buffer.join('\n') });
    buffer = []; active = null;
  };
  for (const line of text.split('\n')) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().replaceAll(fence[0], '').trim()) fence = ''; }
    else if (f) fence = f[1];
    else {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line), card = /^#{3,4}\s+([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+[a-z]?)\s*[·:\-–—]/.exec(line);
      if (card && byId.has(card[1])) { flush(); active = byId.get(card[1]); level = heading[1].length; continue; }
      if (active && heading && heading[1].length <= level) flush();
    }
    buffer.push(line);
  }
  flush(); return blocks;
}

export async function reportData(workspace, system, { track = 'auto' } = {}) {
  const { files, snapshot, data: model } = await readModel(workspace, { system, track }, { skipSession: true });
  if (!snapshot) throw new Error('There is no system to report');
  const base = `analysis/${snapshot.system}/`, found = [], sections = [], notes = []; let equivalence = null;
  let budget = 6 << 20;
  const read = async rel => {
    try {
      const content = await files.optional(rel);
      if (content === null) return null;
      const s = await files.stat(rel); found.push([rel.startsWith(base) ? rel.slice(base.length) : rel, `${Math.ceil(s.size / 1024)} KB`, new Date(s.mtimeMs).toISOString().slice(0, 10)]);
      if (Buffer.byteLength(content) > budget) { notes.push(`${rel} was left out because the report reached its size limit.`); return null; }
      budget -= Buffer.byteLength(content); return redact(content);
    } catch (e) { notes.push(`${rel}: ${clean(e.message, 200)}`); return null; }
  };
  for (const [id, title, names] of DOCS) {
    const parts = [];
    for (const filename of names) {
      const text = await read(base + filename); if (text === null) continue;
      if (filename === 'BUSINESS_RULES.md' && model.rules.length) {
        const blocks = ruleBlocks(text, model.rules);
        parts.push({ t: 'rules', name: filename, blocks, reviews: Object.fromEntries(Object.entries(model.reviews).map(([k, v]) => [k, v.verdict])) });
      } else parts.push({ t: 'md', name: filename, text });
    }
    if (id === 'diagrams') {
      const figures = [];
      for (const e of await files.list(base)) if (e.kind === 'file' && e.name.endsWith('.mmd')) { const src = await read(base + e.name); if (src !== null) figures.push({ name: e.name, src }); }
      if (figures.length) parts.push({ t: 'figures', items: figures });
      if (snapshot.estate) parts.unshift({ t: 'facts', items: [
        [snapshot.estate.granularity === 'file' ? 'Files' : 'Modules', String(snapshot.totals.modules)],
        [snapshot.estate.measure === 'bytes' ? 'Source bytes' : 'Lines of code', String(snapshot.totals.loc)],
        ['Dependencies', snapshot.topology ? String(snapshot.topology.edges.length) : 'Not mapped'],
      ] });
      if (await files.exists(base + 'TOPOLOGY.html')) parts.push({ t: 'link', href: 'TOPOLOGY.html', text: 'Open the interactive topology map' });
    }
    if (id === 'build') for (const suffix of ['', '-uplifted', '-reimagined']) {
      const root = `modernized/${snapshot.system}${suffix}`;
      const dirs = [{ name: '', kind: 'dir' }, ...await files.list(root)];
      for (const d of dirs.filter(e => e.kind === 'dir').slice(0, 200)) for (const n of ['TRANSFORMATION_NOTES.md', 'UPLIFT_NOTES.md', 'README.md']) {
        const rel = `${root}/${d.name ? d.name + '/' : ''}${n}`, text = await read(rel);
        if (text !== null) parts.push({ t: 'md', name: rel, text });
      }
    }
    if (id === 'proof' && model.proof) parts.unshift({ t: 'proof', proof: model.proof });
    if (id === 'equivalence') {
      for (const f of ['EQUIVALENCE.json', 'FRESH_EQUIVALENCE.json']) {
        const raw = await read(base + f); if (raw === null) continue;
        let eq = null; try { eq = equivalenceView(JSON.parse(raw)); } catch { /* Shown as unusable below. */ }
        if (eq) { parts.push({ t: 'p', text: f }, { t: 'equiv', eq }); if (f === 'EQUIVALENCE.json') equivalence = eq; }
        else parts.push({ t: 'p', text: `${f} could not be used; equivalence is not proven.` });
      }
    }
    if (parts.length || id === 'overview') sections.push({ id, title, parts });
  }
  for (const filename of ['topology.json', 'VERIFICATION.json', 'RULE_REVIEWS.json', 'UI_REVIEW_CONTEXT.json', 'UI_APPROVAL_CONTEXT.json']) if (await files.exists(base + filename)) {
    const s = await files.stat(base + filename); found.push([filename, `${Math.ceil(s.size / 1024)} KB`, new Date(s.mtimeMs).toISOString().slice(0, 10)]);
  }
  sections[0].parts.unshift({ t: 'table', head: ['Artifact', 'Size', 'Modified'], rows: found.sort((a, b) => a[0].localeCompare(b[0], 'en')) });
  if (notes.length || model.problems.length) sections[0].parts.unshift({ t: 'list', title: 'Notes about this report', items: [...notes, ...model.problems] });
  if (model.demo) sections[0].parts.unshift({ t: 'p', text: 'DEMO: synthetic workspace for interface testing. Its results do not describe a real modernization.' });
  const byPriority = {};
  for (const r of model.rules) if (r.priority) byPriority[r.priority] = (byPriority[r.priority] ?? 0) + 1;
  return { v: 1, system: snapshot.system, demo: model.demo, generated: new Date().toISOString(),
    glance: { track: { label: snapshot.track === 'transform' ? 'rewrite' : snapshot.track, why: 'Read from saved modernization artifacts' },
      topology: snapshot.estate ? { modules: snapshot.totals.modules, loc: snapshot.totals.loc,
        measure: snapshot.estate.measure, granularity: snapshot.estate.granularity,
        languages: snapshot.estate.languages.map(l => l.name) } : null,
      rules: model.rules.length ? { total: model.rules.length, byPriority, defects: model.rules.filter(r => r.defect).length, reviews: Object.fromEntries(['confirmed', 'wrong', 'discuss'].map(v => [v, Object.values(model.reviews).filter(r => r.verdict === v).length])) } : null,
      proof: model.proof, equivalence, steps: snapshot.stages.map(s => ({ key: s.key, label: s.label, done: s.isDone })),
      next: snapshot.next ? { command: snapshot.next.text, why: snapshot.next.reason } : null }, sections };
}

export async function renderReport(workspace, system, options) {
  const data = await reportData(workspace, system, options);
  let template = fs.readFileSync(new URL('report-template.html', ASSETS), 'utf8');
  template = template.replaceAll('Claude', 'Codex');
  const app = /<script id="app">([\s\S]*?)<\/script>/.exec(template)[1];
  const needsDiagrams = data.sections.some(s => s.parts.some(p => p.t === 'figures' || p.t === 'md' && /```mermaid\b/.test(p.text)));
  const lib = needsDiagrams ? fs.readFileSync(new URL('vendor/mermaid.min.js', ASSETS), 'utf8') : '';
  const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
  const csp = `default-src 'none'; script-src ${sha(app)}${lib ? ' ' + sha(lib) : ''}; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'none'`;
  const fills = { CSP: csp, DATA: scriptJSON(data), MERMAID: lib ? `<script id="mermaid-lib">${lib}</script>` : '' };
  return template.replace(/@@(CSP|DATA|MERMAID)@@/g, (_match, key) => fills[key]);
}

export async function writeReport(workspace, system) {
  const html = await renderReport(workspace, system), files = new (await import('./files.mjs')).WorkspaceFiles(workspace);
  const rel = `analysis/${system}/REPORT.html`;
  atomicText(files, rel, html); return files.resolve(rel);
}
