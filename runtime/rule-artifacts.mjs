// SPDX-License-Identifier: Apache-2.0
// Deterministic adaptation of render_rules.py, with stable IDs across reruns.
import path from 'node:path';
import { hash, invariant, object } from './util.mjs';
import { WorkspaceFiles, atomicText } from './ui/files.mjs';
import { parseRules } from './ui/upstream/reader/rules.mjs';
import { MAX_LINE } from './ui/upstream/text.mjs';

const CATEGORIES = ['Calculation', 'Validation', 'Lifecycle', 'Policy'];
const citationCode = value => '`' + String(value ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029`|]/g, ' ').trim().slice(0, 2000) + '`';
export const singleLine = (value, limit = 500) => String(value ?? '').replace(/[\x00-\x1f\x7f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replace(/[\\`*_[\]#!|]/g, c => `\\${c}`);
export function splitCitation(value) {
  const str = String(value ?? '').trim();
  const match = /^`?([^`:\r\n]+):(\d+)(?:\s*[-–]\s*(\d+))?/.exec(str);
  return match ? { primary: `${match[1].trim()}:${match[2]}${match[3] ? '-' + match[3] : ''}`, also: str.slice(match[0].length).replace(/^[\s;,.–—`-]*(?:also\s+)?/i, '').replace(/`$/, '') }
    : { primary: str, also: '' };
}
export function ruleIdentity(rule) {
  const file = splitCitation(rule.source).primary.replace(/:\d+(?:-\d+)?$/, '');
  return hash([file, String(rule.name ?? '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()]);
}
export function assignRuleIds(rules, previous = '', ledger = {}) {
  object(ledger, 'rule ID ledger');
  const ids = { ...ledger }, owners = new Map(); let next = 1;
  for (const [key, id] of Object.entries(ids)) {
    invariant(/^[a-f0-9]{64}$/.test(key) && /^RULE-\d{3,}$/.test(id) && !owners.has(id), 'Malformed or conflicting rule ID ledger');
    owners.set(id, key); next = Math.max(next, Number(id.slice(5)) + 1);
  }
  for (const card of parseRules(previous).rules) {
    if (!/^RULE-\d{3,}$/.test(card.id)) continue;
    const key = ruleIdentity({ name: card.title, source: card.citations[0] ? `${card.citations[0].path}:${card.citations[0].from}` : '' });
    next = Math.max(next, Number(card.id.slice(5)) + 1);
    // Never silently remap an ID with existing human reviews.
    invariant(!owners.has(card.id) || owners.get(card.id) === key, `Existing rule identity conflicts with ledger: ${card.id}`);
    invariant(!ids[key] || ids[key] === card.id, 'Existing card has a conflicting rule ID');
    ids[key] = card.id; owners.set(card.id, key);
  }
  const seen = new Set();
  return { rules: rules.map(rule => {
    const key = ruleIdentity(rule); invariant(!seen.has(key), 'Duplicate rule identity; consolidate before rendering'); seen.add(key);
    if (!ids[key]) ids[key] = `RULE-${String(next++).padStart(3, '0')}`;
    return { ...rule, id: ids[key] };
  }), ledger: ids };
}
export function renderRuleArtifacts(system, result, previous = '', ledger = {}) {
  object(result, 'rules result');
  invariant(Array.isArray(result.confirmedRules), 'confirmedRules must be an array');
  const sorted = [...result.confirmedRules].sort((a, b) => (CATEGORIES.indexOf(a.category) + 1 || 99) - (CATEGORIES.indexOf(b.category) + 1 || 99)
    || String(a.priority).localeCompare(String(b.priority)) || String(a.source).localeCompare(String(b.source)) || String(a.name).localeCompare(String(b.name)));
  const numbered = assignRuleIds(sorted, previous, ledger), rules = numbered.rules;
  for (const r of rules) invariant(`### ${r.id}: ${singleLine(r.name, Infinity)}`.length <= MAX_LINE, 'Rule name exceeds the reader line limit');
  const doc = [`# Business Rules — ${singleLine(system)}`, '',
    `${rules.length} confirmed rule(s) in the supplied workflow result; ${(result.rejectedRules ?? []).length} rejected; ${(result.unresolvedRules ?? []).length} unresolved. This catalog does not grant human approval.`, '',
    '| ID | Name | Category | Priority | Source | Confidence |', '|---|---|---|---|---|---|'];
  for (const r of rules) doc.push(`| ${r.id} | ${singleLine(r.name)} | ${singleLine(r.category)} | ${singleLine(r.priority)} | ${citationCode(splitCitation(r.source).primary)} | ${singleLine(r.confidence)} |`);
  for (const category of [...CATEGORIES, 'Other']) {
    const group = rules.filter(r => (CATEGORIES.includes(r.category) ? r.category : 'Other') === category);
    if (!group.length) continue; doc.push('', `## ${category}`, '');
    for (const r of group) {
      const cite = splitCitation(r.source);
      doc.push(`### ${r.id}: ${singleLine(r.name, Infinity)}`, `**Category:** ${singleLine(r.category)}`, `**Priority:** ${singleLine(r.priority)}`,
        `**Source:** ${citationCode(cite.primary)}`, ...(cite.also ? [`**Also cited:** ${citationCode(cite.also)}`] : []),
        `**Plain English:** ${singleLine(r.plainEnglish, 4000)}`, '**Specification:**',
        `  Given ${singleLine(r.given, 4000)}`, `  When ${singleLine(r.when, 4000)}`, `  Then ${singleLine(r.then, 4000)}`);
      if (r.and) doc.push(`  And ${singleLine(r.and, 4000)}`);
      if (r.parameters) doc.push(`**Parameters:** ${singleLine(r.parameters, 4000)}`);
      if (r.edgeCases?.length) doc.push('**Edge cases handled:**', ...r.edgeCases.map(c => `- ${singleLine(c, 2000)}`));
      if (r.suspectedDefect) doc.push(`**Suspected defect:** ${singleLine(r.suspectedDefect, 4000)}`);
      doc.push(`**Confidence:** ${singleLine(r.confidence)}`);
      if (r.smeQuestion) doc.push(`❓ **SME question** — ${singleLine(r.smeQuestion, 4000)}`);
      doc.push('');
    }
  }
  const sme = rules.filter(r => r.confidence !== 'High' || r.smeQuestion || r.suspectedDefect);
  doc.push('## Rules requiring SME confirmation', '', ...(sme.length ? sme.map(r => `- **${r.id}**: ${singleLine(r.smeQuestion || r.suspectedDefect || 'Confirm this rule with a domain expert.')}`) : ['None flagged by the supplied result.']), '');
  const gaps = [...(result.coverageGaps ?? []), ...(result.failures ?? []).map(f => `${f.task}: ${f.error}`),
    ...(result.unresolvedRules ?? []).map(r => `Unresolved rule: ${r.name} (${r.source})`),
    ...(result.stats?.skippedModules ?? []).map(n => `Module not attempted: ${n}`), ...(result.stats?.failedModules ?? []).map(n => `Module extraction failed: ${n}`)];
  doc.push('## Coverage gaps', '', ...(gaps.length ? gaps.map(g => `- ${singleLine(g, 2000)}`) : [result.incomplete ? 'Workflow reports incomplete coverage; inspect its raw result.' : 'No gaps reported by the supplied result.']));
  if (result.rerunModules?.length) doc.push('', `Follow-up scope: ${result.rerunModules.length} shard(s) in rules_rerun.json.`);
  if (result.injectionSuspects?.length) doc.push('', '## Instruction-shaped source content', '', ...result.injectionSuspects.map(s => `- ${singleLine(s, 2000)}`));
  if (result.foldedRules?.length) doc.push('', '## Folded rule provenance', '', ...result.foldedRules.map(r => `- ${singleLine(r.name)} (${singleLine(r.source)}) → ${singleLine(r.into)}`));
  const objects = result.dataObjects ?? [], dto = [`# Data Objects — ${singleLine(system)}`, ''];
  for (const obj of objects) {
    dto.push(`## ${singleLine(obj.name)}`, `Source: ${singleLine(obj.source)}`, '', '| Field | Type | Note |', '|---|---|---|');
    for (const f of obj.fields ?? []) dto.push(`| ${singleLine(f.name)} | ${singleLine(f.type)} | ${singleLine(f.note, 2000)} |`);
    dto.push('', `Used by: ${(obj.consumedBy ?? []).map(c => singleLine(c)).join(', ')}`, '');
  }
  if (!objects.length) dto.push('No data objects were cataloged.');
  return { businessRules: doc.join('\n') + '\n', dataObjects: dto.join('\n') + '\n', ledger: numbered.ledger, rules };
}
export async function writeRuleArtifacts(layout, result) {
  const files = new WorkspaceFiles(layout.workspace), base = `analysis/${layout.system}`;
  const rendered = renderRuleArtifacts(layout.system, result, await files.optional(`${base}/BUSINESS_RULES.md`) ?? '', await files.json(`${base}/RULE_IDS.json`) ?? {});
  // IDs are reserved first: an interrupted publication may leave gaps, but never reuses an ID.
  atomicText(files, `${base}/RULE_IDS.json`, JSON.stringify(rendered.ledger, null, 2) + '\n');
  atomicText(files, `${base}/rules_result.json`, JSON.stringify(result, null, 2) + '\n');
  atomicText(files, `${base}/BUSINESS_RULES.md`, rendered.businessRules);
  atomicText(files, `${base}/DATA_OBJECTS.md`, rendered.dataObjects);
  atomicText(files, `${base}/rules_rerun.json`, JSON.stringify({ modules: result.rerunModules ?? [] }, null, 2) + '\n');
  return { businessRules: path.join(layout.analysis, 'BUSINESS_RULES.md'), dataObjects: path.join(layout.analysis, 'DATA_OBJECTS.md'), rules: rendered.rules.length };
}
