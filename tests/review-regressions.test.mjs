// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fixture, sample, workflowEngine } from './helpers.mjs';
import * as S from '../runtime/schemas.mjs';
import { runWorkflow } from '../runtime/workflows.mjs';
import { renderRuleArtifacts } from '../runtime/rule-artifacts.mjs';
import { parseRules } from '../runtime/ui/upstream/reader/rules.mjs';
import { readModel } from '../runtime/ui/model.mjs';
import { cardRevision, entryRevision } from '../runtime/ui/model.mjs';
import { saveReview } from '../runtime/ui/decisions.mjs';
import { atomicJSON } from '../runtime/util.mjs';
import { resolveLayout } from '../runtime/engine.mjs';
import { WorkspaceFiles } from '../runtime/ui/files.mjs';
import { withFileLock } from '../runtime/ui/lock.mjs';

test('extraction distinguishes deferred modules from attempted failures', async () => {
  const engine = workflowEngine('extract-rules', async spec => spec.id === 'rules-module-0'
    ? { ok: false, error: 'Worker failed' }
    : spec.id === 'rules-module-1' ? { ok: false, deferred: true, error: 'Stopped before launch' }
      : { result: sample(S.dataObjects) });
  const modules = ['failed', 'deferred'].map(name => ({ name, files: [`${name}.go`] }));
  const result = await runWorkflow(engine, { modules, batchSize: 8 });
  assert.deepEqual(result.stats.failedModules, ['failed']);
  assert.deepEqual(result.stats.skippedModules, ['deferred']);
  assert.deepEqual(result.rerunModules, modules);
  assert.equal(result.incomplete, true);
});

for (const source of ['src/Расчёт.cs:1-2', 'src/@scope/amount.ts:1-2', 'src/cafe\u0301.ts:1-2',
  'src/my file.ts:1-2', 'src/my  file.ts:1-2', 'src/(old)/amount.ts:1-2', 'src/[generated]/amount.ts:1-2', 'Makefile:1-2']) {
  test(`rule publication preserves the full citation and ID on rerun: ${source}`, () => {
    const rule = { ...sample(S.rule), name: 'Amount limit', source };
    const first = renderRuleArtifacts('billing', { confirmedRules: [rule] });
    assert.equal(parseRules(first.businessRules).rules[0].citations[0]?.path, source.split(':')[0]);
    const second = renderRuleArtifacts('billing', { confirmedRules: [rule] }, first.businessRules, first.ledger);
    assert.equal(second.rules[0].id, first.rules[0].id);
  });
}

test('a long rule name can be republished without losing its persistent identity', () => {
  const rule = { ...sample(S.rule), name: 'Amount threshold '.repeat(12).trim(), source: 'src/amount.ts:1' };
  const first = renderRuleArtifacts('billing', { confirmedRules: [rule] });
  assert.equal(parseRules(first.businessRules).rules[0].title, rule.name);
  const second = renderRuleArtifacts('billing', { confirmedRules: [rule] }, first.businessRules, first.ledger);
  assert.equal(second.rules[0].id, first.rules[0].id);
});

test('a current human review survives display sanitization of its title', async t => {
  const f = await fixture(t), rule = { ...sample(S.rule), name: 'Amount < limit [approved] '.repeat(8).trim(), source: 'main.go:1' };
  const rendered = renderRuleArtifacts('billing', { confirmedRules: [rule] });
  await fs.writeFile(path.join(f.layout.analysis, 'BUSINESS_RULES.md'), rendered.businessRules);
  const card = parseRules(rendered.businessRules).rules[0];
  await saveReview(f.workspace, 'billing', { id: card.id, verdict: 'confirmed', ruleRevision: cardRevision(card), reviewRevision: entryRevision(null) });
  const { data } = await readModel(f.workspace, { system: 'billing' });
  assert.deepEqual(data.staleReviews, []);
  assert.equal(data.reviews[card.id]?.verdict, 'confirmed');
});

test('rule publication rejects a heading longer than its reader can preserve', () => {
  const rule = { ...sample(S.rule), name: 'x'.repeat(4000), source: 'main.go:1' };
  assert.throws(() => renderRuleArtifacts('billing', { confirmedRules: [rule] }), /name.*limit/i);
});

for (const system of ['search-index', 'rejected-invoices', 'provenance']) {
  test(`a system name cannot hide its published rules as a summary section: ${system}`, async t => {
    const f = await fixture(t), layout = await resolveLayout(f.workspace, system, f.source);
    const rule = { ...sample(S.rule), name: 'Amount threshold', source: 'main.go:1' };
    const first = renderRuleArtifacts(system, { confirmedRules: [rule] });
    const parsed = parseRules(first.businessRules);
    assert.deepEqual(parsed.rules.map(r => r.id), [first.rules[0].id]);
    const second = renderRuleArtifacts(system, { confirmedRules: [rule] }, first.businessRules, first.ledger);
    assert.equal(second.rules[0].id, first.rules[0].id);
    await fs.writeFile(path.join(layout.analysis, 'BUSINESS_RULES.md'), second.businessRules);
    const { data } = await readModel(f.workspace, { system, scope: 'all' });
    assert.deepEqual(data.rules.map(r => r.id), [first.rules[0].id]);
    assert.deepEqual(data.reviewQueue, [first.rules[0].id]);
  });
}

test('standalone indexes and appendices still do not create review cards', () => {
  const rules = parseRules('# Index\n### RULE-900: Index entry\n# Business Rules — billing\n## Policy\n### RULE-001: Actual rule\n**Source:** `main.go:1`\n# Appendix\n### RULE-901: Summary entry\n');
  assert.deepEqual(rules.rules.map(r => r.id), ['RULE-001']);
});

test('the panel includes failing integration tests alongside passing unit tests', async t => {
  const f = await fixture(t), dir = path.join(f.workspace, 'modernized/billing/core');
  for (const [folder, name, failed] of [['surefire-reports', 'unit', false], ['failsafe-reports', 'integration', true]]) {
    await fs.mkdir(path.join(dir, 'target', folder), { recursive: true });
    await fs.writeFile(path.join(dir, 'target', folder, `TEST-${name}.xml`),
      `<testsuite tests="1" failures="${Number(failed)}"><testcase name="${name}">${failed ? '<failure/>' : ''}</testcase></testsuite>`);
  }
  const { data } = await readModel(f.workspace, { system: 'billing', track: 'transform' });
  const module = data.modules.find(m => m.dir === 'core');
  assert.equal(module.tests.tests, 2);
  assert.equal(module.tests.failures, 1);
  assert.equal(module.state, 'tests-red');
});

for (const track of ['transform', 'uplift']) {
  test(`an entirely skipped suite cannot finish a ${track} module`, async t => {
    const f = await fixture(t), dir = path.join(f.workspace, `modernized/billing${track === 'uplift' ? '-uplifted' : ''}/core`);
    await fs.mkdir(path.join(dir, 'tests'), { recursive: true });
    await fs.writeFile(path.join(dir, 'tests/main.test.mjs'), '// pending characterization\n');
    await fs.writeFile(path.join(dir, 'junit.xml'), '<testsuite tests="10" failures="0" errors="0" skipped="10"/>');
    await fs.writeFile(path.join(dir, 'TRANSFORMATION_NOTES.md'), '## Architecture review\nReviewed.\n');
    if (track === 'uplift') {
      await fs.mkdir(path.join(f.source, 'core'));
      await fs.writeFile(path.join(f.source, 'core/go.mod'), 'module core\n');
      await fs.writeFile(path.join(f.source, 'core/main.go'), 'package core\n');
      await fs.mkdir(path.join(f.source, 'other'));
      await fs.writeFile(path.join(f.source, 'other/go.mod'), 'module other\n');
    }
    const { data } = await readModel(f.workspace, { system: 'billing', track });
    const module = data.modules.find(m => m.dir === 'core');
    assert(module, 'The module with skipped tests remains visible');
    assert.equal(module.state, track === 'uplift' ? 'scaffolded' : 'tests-written');
    assert.equal(data.totals.done, 0);
  });
}

test('atomic JSON failures leave the prior state intact and remove temporary files', async t => {
  const f = await fixture(t), file = path.join(f.root, 'state.json');
  await atomicJSON(file, { prior: true });
  const circular = {}; circular.self = circular;
  await assert.rejects(atomicJSON(file, circular), /circular/i);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { prior: true });
  assert.deepEqual((await fs.readdir(f.root)).filter(n => n.startsWith('state.json.')), []);
});

test('a UI transaction retries when the prior owner releases its lock during inspection', async t => {
  const f = await fixture(t), files = new WorkspaceFiles(f.root);
  let release, entered;
  const held = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const owner = withFileLock(files, 'racing.lock', async () => { entered(); await held; });
  t.after(async () => { release(); await owner; });
  await ready;
  const read = files.json.bind(files);
  files.json = async rel => {
    const previous = await read(rel);
    release(); await owner;
    return previous;
  };
  assert.equal(await withFileLock(files, 'racing.lock', () => 'saved'), 'saved');
  assert.equal(await files.exists('racing.lock'), false);
});

// Execute the shipped panel handlers with a minimal browser surface. No model,
// network or simulated backend approval is involved in this routing regression.
async function panelContext() {
  const elements = new Map(), requests = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { dataset: {}, value: '', checked: true, classList: { toggle() {} },
      reset() {}, focus() {}, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
      querySelector() { return element(`${id}-submit`); } });
    return elements.get(id);
  };
  const context = vm.createContext({ URLSearchParams, requests, console,
    location: { search: '', hash: '', pathname: '/' }, history: { replaceState() {} },
    sessionStorage: { getItem() {}, setItem() {} }, localStorage: { getItem() {}, setItem() {} },
    document: { getElementById: element, documentElement: { dataset: {} }, querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    LiveConnection: class { start() {} restart() {} }, FormData: class { get() { return 'phase-1'; } },
  });
  const source = await fs.readFile(new URL('../assets/panel.mjs', import.meta.url), 'utf8');
  vm.runInContext(source.replace(/^import .*;\n/gm, ''), context);
  vm.runInContext(`
    system = 'first';
    model = {system, briefRevision: 'same-content', briefText: 'Reviewed plan',
      brief: {approval: {isSigned: false}, phases: [{number: 1, title: 'Pilot'}], openQuestions: 0}};
    api = async (route, input) => { requests.push({route, input, system}); };
    refresh = async () => {};
    openSign();
  `, context);
  return { context, element, requests };
}

test('a brief approval cannot move to another system with an identical brief', async () => {
  const { context, element, requests } = await panelContext();
  vm.runInContext("system = 'second'; model = {...model, system};", context);
  await element('sign-form').onsubmit({ preventDefault() {} });
  assert.equal(requests.length, 0);
  assert.match(element('sign-error').textContent, /selection changed/i);
});

test('the reviewed system still receives an explicitly submitted brief approval', async () => {
  const { element, requests } = await panelContext();
  await element('sign-form').onsubmit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].system, 'first');
  assert.equal(requests[0].input.briefRevision, 'same-content');
});

for (const ready of [false, true]) {
  test(`switching systems clears the old review card while the new model is ${ready ? 'waiting to render' : 'loading'}`, async () => {
    const { context, requests } = await panelContext();
    vm.runInContext(`
      view = 'review';
      model = {...model, reviews: {}, rules: [{id: 'RULE-001', priority: 'P0', confidence: 'Medium',
        revision: 'identical-card', reviewRevision: 'identical-review', citations: []}]};
      presentedRule = model.rules[0];
      const previous = model;
      system = 'second'; changeContext();
      ${ready ? "model = {...previous, system};" : ''}
    `, context);
    await vm.runInContext("decide('confirmed')", context);
    assert.equal(requests.length, 0, 'A decision for the old card must never reach the new system');
    assert.equal(vm.runInContext('busy', context), false, 'Pending data must not leave every decision locked');
  });
}
