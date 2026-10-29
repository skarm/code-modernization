// SPDX-License-Identifier: Apache-2.0
import { withFileLock } from './lock.mjs';
import { WorkspaceFiles, atomicText, outputPath } from './files.mjs';
import { parseRules } from './upstream/reader/rules.mjs';
import { parseBrief } from './upstream/reader/brief.mjs';
import { ledgerMarkdown } from './upstream/review/deck.mjs';
import { signBrief } from './upstream/sign.mjs';
import { cardRevision, entryRevision } from './model.mjs';
import { hash, invariant, name } from '../util.mjs';
import { isObject } from '../proof-io.mjs';

export class Conflict extends Error { constructor(message) { super(message); this.status = 409; } }
function unchanged(actual, expected, message) { if (actual !== expected) throw new Conflict(message); }
function line(value, label, max) {
  invariant(typeof value === 'string' && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), `${label} must be one plain line of at most ${max} characters`);
  return value.trim();
}
async function locked(workspace, system, work) {
  name(system); const files = new WorkspaceFiles(workspace), dir = `analysis/${system}`;
  invariant(await files.exists(dir), 'Analysis directory is missing');
  // Human decisions have their own serialized writer. Running tasks use pinned
  // context; the runner revalidates a new revision before launching more writes.
  return withFileLock(files, `${dir}/.review.lock`, () => work(files, dir));
}

export async function saveReview(workspace, system, input) {
  invariant(isObject(input), 'Expected a review decision');
  invariant(typeof input.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(input.id) && !['constructor', 'prototype', '__proto__'].includes(input.id), 'Invalid rule ID');
  invariant(['confirmed', 'wrong', 'discuss', 'retract'].includes(input.verdict), 'Invalid rule verdict');
  const note = input.note === undefined ? undefined : line(input.note, 'Review note', 500);
  return locked(workspace, system, async (files, dir) => {
    const rulesText = await files.read(`${dir}/BUSINESS_RULES.md`), rule = parseRules(rulesText).byId.get(input.id);
    invariant(rule, 'The rule is missing');
    unchanged(cardRevision(rule), input.ruleRevision, 'This rule changed. Read the current card before deciding.');
    const raw = await files.json(`${dir}/RULE_REVIEWS.json`) ?? { system, version: 1, reviews: {} };
    invariant(isObject(raw) && isObject(raw.reviews) && raw.system === system && raw.version === 1, 'Existing review ledger is invalid; it was not replaced');
    invariant(Object.entries(raw.reviews).every(([id, r]) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id) && isObject(r) && ['confirmed', 'wrong', 'discuss'].includes(r.verdict) && typeof r.at === 'string' && (r.title === undefined || typeof r.title === 'string') && (r.note === undefined || typeof r.note === 'string')), 'Existing review entries are invalid; the ledger was not replaced');
    unchanged(entryRevision(raw.reviews[input.id]), input.reviewRevision, 'Someone changed this review. Reload it before saving.');
    if (input.verdict === 'retract') delete raw.reviews[input.id];
    else raw.reviews[input.id] = { verdict: input.verdict, at: new Date().toISOString(), title: rule.title,
      ...(note === undefined ? raw.reviews[input.id]?.note ? { note: raw.reviews[input.id].note } : {} : note ? { note } : {}) };
    const context = await files.json(`${dir}/UI_REVIEW_CONTEXT.json`) ?? { version: 1, cards: {} };
    invariant(isObject(context) && isObject(context.cards), 'Review context is invalid');
    context.cards[input.id] = cardRevision(rule);
    for (const file of ['RULE_REVIEWS.json', 'RULE_REVIEWS.md', 'UI_REVIEW_CONTEXT.json']) outputPath(files, `${dir}/${file}`);
    // Recheck the card immediately before publication; unrelated ledger entries
    // are merged from the latest file while the review lock is held.
    unchanged(hash(await new WorkspaceFiles(workspace).read(`${dir}/BUSINESS_RULES.md`)), hash(rulesText), 'Rules changed during the decision. Reload before saving.');
    atomicText(files, `${dir}/RULE_REVIEWS.json`, JSON.stringify(raw, null, 2) + '\n');
    atomicText(files, `${dir}/RULE_REVIEWS.md`, ledgerMarkdown(system, raw.reviews));
    atomicText(files, `${dir}/UI_REVIEW_CONTEXT.json`, JSON.stringify(context, null, 2) + '\n');
    return { id: input.id, verdict: input.verdict, saved: true };
  });
}

export async function saveApproval(workspace, system, input) {
  invariant(isObject(input) && input.confirm === true, 'Explicit approval confirmation is required');
  const who = line(input.name, 'Approver name and role', 160);
  invariant(who.length >= 2 && !/[`*<>|]/.test(who) && !/^(?:unknown|anonymous|_+)$/i.test(who), 'Enter the actual approver name and role');
  invariant(['phase-1', 'full'].includes(input.covers), 'Choose Phase 1 only or Full plan');
  return locked(workspace, system, async (files, dir) => {
    const file = `${dir}/MODERNIZATION_BRIEF.md`, text = await files.read(file);
    unchanged(hash(text), input.briefRevision, 'The brief changed. Read and approve the current revision.');
    const brief = parseBrief(text);
    invariant(brief.phases.length > 0, 'The brief has no readable phases');
    const contextFile = `${dir}/UI_APPROVAL_CONTEXT.json`;
    const context = await files.json(contextFile) ?? { version: 1, history: [] };
    invariant(isObject(context) && Array.isArray(context.history) && context.history.length < 500, 'Approval history is invalid or full');
    invariant(!brief.approval.isSigned || context.approvedRevision && context.approvedRevision !== hash(text), 'The brief already has an approval; use an explicit plan revision to preserve its history');
    const changed = signBrief(text, who, new Date().toISOString().slice(0, 10), input.covers);
    invariant(changed, 'The brief has no Approved by block');
    if (brief.approval.isSigned) context.history.push({ ...brief.approval, previousApprovedRevision: context.approvedRevision, supersededAt: new Date().toISOString() });
    context.approvedRevision = hash(changed); context.system = system;
    outputPath(files, file); outputPath(files, contextFile);
    atomicText(files, file, changed);
    atomicText(files, contextFile, JSON.stringify(context, null, 2) + '\n');
    return { saved: true, name: who, covers: input.covers, briefRevision: hash(changed) };
  });
}
