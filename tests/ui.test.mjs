// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDemo } from '../examples/ui-demo.mjs';
import { readModel, sourceView } from '../runtime/ui/model.mjs';
import { saveReview, saveApproval } from '../runtime/ui/decisions.mjs';
import { proofView } from '../runtime/ui/proof-view.mjs';
import { reportData, renderReport, scriptJSON, writeReport } from '../runtime/ui/report.mjs';
import { WorkspaceFiles, atomicText, uiRedact } from '../runtime/ui/files.mjs';
import { startPanel } from '../runtime/ui/server.mjs';
import { equivalenceView } from '../runtime/ui/equivalence-view.mjs';
import { Engine } from '../runtime/engine.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'modernization-ui-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await createDemo(root);
  const dir = path.join(root, 'analysis/carddemo'), read = async f => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8'));
  return { root, dir, read, model: async () => (await readModel(root, { system: 'carddemo' })).data };
}
async function decision(f, id = 'RULE-003', verdict = 'discuss', note = 'SME question') {
  const r = (await f.model()).rules.find(r => r.id === id);
  return { id, verdict, note, ruleRevision: r.revision, reviewRevision: r.reviewRevision };
}

test('Finder metadata is absent from UI listings and cannot be read directly', async t => {
  const f = await fixture(t), files = new WorkspaceFiles(f.root);
  await fs.writeFile(path.join(f.root, '.DS_Store'), 'Finder metadata');
  await fs.writeFile(path.join(f.dir, '.DS_Store'), 'Finder metadata');
  assert(!(await files.list('.')).some(entry => entry.name === '.DS_Store'));
  assert(!(await files.list('analysis/carddemo')).some(entry => entry.name === '.DS_Store'));
  await assert.rejects(files.read('analysis/carddemo/.DS_Store'), /Finder metadata/);
  assert.equal(await files.exists('.DS_Store'), false);
  const demoRoot = path.join(f.root, 'finder-demo');
  await fs.mkdir(demoRoot); await fs.writeFile(path.join(demoRoot, '.DS_Store'), 'Finder metadata');
  await createDemo(demoRoot);
  assert.equal((await readModel(demoRoot, { system: 'carddemo' })).data.demo, true);
});

test('UI reads original artifacts into stages, weighted tiles, phases and rule cards', async t => {
  const f = await fixture(t), m = await f.model();
  assert.equal(m.system, 'carddemo'); assert.equal(m.demo, true); assert.equal(m.tiles.length, 28);
  assert.equal(m.rules.length, 4); assert.equal(m.brief.phases.length, 2);
  assert.equal(m.brief.approval.isSigned, false); assert.equal(m.next.action, 'sign');
  assert.equal(m.proof.verdict, 'PROVEN'); assert.equal(m.modules.length, 3);
  assert.equal(m.byNode.COCRDSLC.state, 'tests-red'); assert.equal(m.proofs.coactupc.state, 'proven');
  assert.deepEqual(m.reviewQueue, ['RULE-003', 'RULE-002']);
  assert.equal(m.session.agents.length, 3); assert.equal(m.session.active, 0);
  const area = m.tiles.reduce((sum, tile) => sum + tile.rect.w * tile.rect.h, 0);
  assert.equal(area, 160 * 42);
});

test('UI empty workspace has a usable front door and invalid system never falls back', async t => {
  const f = await fixture(t), empty = path.join(f.root, 'empty'); await fs.mkdir(empty);
  assert.equal((await readModel(empty)).data.system, null);
  await assert.rejects(readModel(f.root, { system: 'absent' }), /not present/);
  await assert.rejects(readModel(f.root, { system: '../bad' }), /identifier/);
  await assert.rejects(readModel(f.root, { track: 'invented' }), /track/);
});

test('rule queue and filter retain upstream selection and order', async t => {
  const f = await fixture(t);
  const all = (await readModel(f.root, { system: 'carddemo', scope: 'all' })).data;
  assert.deepEqual(all.reviewQueue, ['RULE-003', 'RULE-002', 'RULE-001', 'RULE-004']);
  const one = (await readModel(f.root, { system: 'carddemo', scope: 'all', filter: 'truncat' })).data;
  assert.deepEqual(one.reviewQueue, ['RULE-003']);
});

test('review saves original ledger and Markdown without editing extracted rules', async t => {
  const f = await fixture(t), before = await fs.readFile(path.join(f.dir, 'BUSINESS_RULES.md'), 'utf8');
  await saveReview(f.root, 'carddemo', await decision(f));
  const ledger = await f.read('RULE_REVIEWS.json');
  assert.equal(ledger.reviews['RULE-003'].verdict, 'discuss');
  assert.equal(ledger.reviews['RULE-003'].note, 'SME question');
  assert.equal(ledger.reviews['RULE-001'].verdict, 'confirmed');
  assert.equal(ledger.version, 1);
  assert.match(await fs.readFile(path.join(f.dir, 'RULE_REVIEWS.md'), 'utf8'), /Needs discussion/);
  assert.equal(await fs.readFile(path.join(f.dir, 'BUSINESS_RULES.md'), 'utf8'), before);
  assert((await f.model()).attention.some(s => s.includes('under discussion')));
});

test('review read-merges other cards and rejects a stale decision for the same card', async t => {
  const f = await fixture(t), input = await decision(f), other = await decision(f, 'RULE-002', 'wrong');
  await saveReview(f.root, 'carddemo', other);
  await saveReview(f.root, 'carddemo', input);
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-002'].verdict, 'wrong');
  await assert.rejects(saveReview(f.root, 'carddemo', input), e => e.status === 409);
});

test('changed rule rejects old consent and invalidates a saved review', async t => {
  const f = await fixture(t), input = await decision(f);
  await saveReview(f.root, 'carddemo', input);
  const file = path.join(f.dir, 'BUSINESS_RULES.md');
  await fs.writeFile(file, (await fs.readFile(file, 'utf8')).replace('0.13', '0.14'));
  await assert.rejects(saveReview(f.root, 'carddemo', input), /rule changed/);
  const model = await f.model();
  assert.deepEqual(model.staleReviews, ['RULE-003']); assert(!model.reviews['RULE-003']);
  assert.match(model.next.text, /modernize-review/);
  await saveReview(f.root, 'carddemo', await decision(f));
  assert.equal((await f.model()).staleReviews.length, 0);
});

test('review can retain, replace, clear a note, and retract just its own verdict', async t => {
  const f = await fixture(t); await saveReview(f.root, 'carddemo', await decision(f));
  const keep = await decision(f, 'RULE-003', 'confirmed'); delete keep.note;
  await saveReview(f.root, 'carddemo', keep);
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-003'].note, 'SME question');
  await saveReview(f.root, 'carddemo', await decision(f, 'RULE-003', 'confirmed', ''));
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-003'].note, undefined);
  await saveReview(f.root, 'carddemo', await decision(f, 'RULE-003', 'retract'));
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-003'], undefined);
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-001'].verdict, 'confirmed');
});

test('malformed ledgers and unsafe decisions never replace existing files', async t => {
  const f = await fixture(t), input = await decision(f), file = path.join(f.dir, 'RULE_REVIEWS.json');
  for (const text of ['{broken', JSON.stringify({ system: 'other', version: 1, reviews: {} }), JSON.stringify({ system: 'carddemo', version: 1, reviews: { 'RULE-009': { verdict: 'wrong' } } })]) {
    await fs.writeFile(file, text);
    await assert.rejects(saveReview(f.root, 'carddemo', input));
    assert.equal(await fs.readFile(file, 'utf8'), text);
  }
  await assert.rejects(saveReview(f.root, 'carddemo', { ...input, id: '__proto__' }), /rule ID/);
  await assert.rejects(saveReview(f.root, 'carddemo', { ...input, note: 'bad\nline' }), /plain line/);
});

test('review can save during an SDK run and serializes only other reviewers', async t => {
  const f = await fixture(t), input = await decision(f), folder = path.join(f.root, 'analysis/.codex-sdk');
  await fs.mkdir(folder); const lock = path.join(folder, 'coordinator.lock'); await fs.writeFile(lock, 'other writer');
  await saveReview(f.root, 'carddemo', input);
  assert.equal(await fs.readFile(lock, 'utf8'), 'other writer');
  await fs.writeFile(path.join(f.dir, '.review.lock'), 'another reviewer');
  await assert.rejects(saveReview(f.root, 'carddemo', await decision(f)), e => e.status === 409);
});

test('brief approval requires explicit identity, scope, confirmation and current revision', async t => {
  const f = await fixture(t), m = await f.model(), file = path.join(f.dir, 'MODERNIZATION_BRIEF.md'), original = await fs.readFile(file, 'utf8');
  const input = { name: 'Demo Approver, SME', covers: 'phase-1', confirm: true, briefRevision: m.briefRevision };
  await assert.rejects(saveApproval(f.root, 'carddemo', { ...input, confirm: false }), /confirmation/);
  await assert.rejects(saveApproval(f.root, 'carddemo', { ...input, name: '' }), /actual approver/);
  await assert.rejects(saveApproval(f.root, 'carddemo', { ...input, covers: 'both' }), /Choose/);
  await fs.appendFile(file, '\nA changed requirement.\n');
  await assert.rejects(saveApproval(f.root, 'carddemo', input), e => e.status === 409);
  assert.match(await fs.readFile(file, 'utf8'), /Approved by: ___/);
  await fs.writeFile(file, original);
  await saveApproval(f.root, 'carddemo', input);
  const signed = await fs.readFile(file, 'utf8');
  assert.equal(signed, original.replace('Approved by: ________________  Date: __________', `Approved by: Demo Approver, SME  Date: ${new Date().toISOString().slice(0, 10)}`).replace('Approval covers: Phase 1 only | Full plan', 'Approval covers: Phase 1 only'));
  assert.equal((await f.model()).brief.approval.covers, 'phase-1');
  assert.deepEqual((await f.read('VERIFICATION.json')).signoff, {});
  await assert.rejects(saveApproval(f.root, 'carddemo', { ...input, briefRevision: (await f.model()).briefRevision }), /already has an approval/);
});

test('source view is bounded, redacted and enriched with real rule/map context', async t => {
  const f = await fixture(t), file = 'app/cbl/CBACT04C.cbl';
  await fs.appendFile(path.join(f.root, 'legacy/carddemo', file), 'password=supersecretvalue\n');
  const s = await sourceView(f.root, 'carddemo', file, 8, 20);
  assert.match(s.xray.text, /RULE-003/); assert.match(s.text, /COMPUTE INTEREST/);
  assert(!s.text.includes('supersecretvalue')); assert.match(s.text, /REDACTED/);
  await assert.rejects(sourceView(f.root, 'carddemo', '../../outside', 1, 20));
  await assert.rejects(sourceView(f.root, 'carddemo', '.env', 1, 20));
  await assert.rejects(sourceView(f.root, 'carddemo', file, 0, 20));
  await assert.rejects(sourceView(f.root, 'carddemo', file, 1, 201));
});

test('revised brief invalidates the old approval and preserves it on renewed approval', async t => {
  const f = await fixture(t), m = await f.model();
  await saveApproval(f.root, 'carddemo', { name: 'First Reviewer, SME', covers: 'phase-1', confirm: true, briefRevision: m.briefRevision });
  assert.equal((await f.model()).approvalStale, false);
  await fs.appendFile(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), '\nAdditional exit criterion.\n');
  const changed = await f.model(); assert.equal(changed.approvalStale, true); assert.equal(changed.next.action, 'sign');
  await saveApproval(f.root, 'carddemo', { name: 'Second Reviewer, Owner', covers: 'full', confirm: true, briefRevision: changed.briefRevision });
  assert.equal((await f.model()).approvalStale, false);
  assert.equal((await f.read('UI_APPROVAL_CONTEXT.json')).history[0].by, 'First Reviewer, SME');
});

test('equivalence table counts case verdicts and supports both comparator formats', () => {
  const base = { selfCheck: { passed: true }, cases: [{ id: 'one', status: 'same', nonempty: true, sha256: { legacy: 'a'.repeat(64), new: 'a'.repeat(64) } }], totals: { cases: 99, executed: 99 } };
  assert.equal(equivalenceView(base).state, 'green'); assert.equal(equivalenceView(base).tally.cases, 1); assert(equivalenceView(base).problems.length);
  base.cases[0].sha256.new = 'b'.repeat(64);
  assert.equal(equivalenceView(base).cases[0].verdict, 'inconsistent'); assert.equal(equivalenceView(base).state, 'red');
  base.cases[0] = { id: 'one', verdict: 'differs-approved', empty: false };
  assert.equal(equivalenceView(base).state, 'red');
  base.cases[0].approvedDifference = 'Approved by a person';
  assert.equal(equivalenceView(base).state, 'green');
});

test('reader permits the legacy root link but refuses descendant links and private artifacts', async t => {
  const f = await fixture(t), moved = path.join(f.root, 'original');
  await fs.rename(path.join(f.root, 'legacy/carddemo'), moved);
  await fs.symlink(moved, path.join(f.root, 'legacy/carddemo'));
  assert.equal((await f.model()).rules.length, 4);
  assert.match((await sourceView(f.root, 'carddemo', 'app/cbl/COACTUPC.cbl')).text, /IDENTIFICATION/);
  await fs.symlink(path.join(f.dir, 'MODERNIZATION_BRIEF.md'), path.join(moved, 'link.md'));
  await assert.rejects(sourceView(f.root, 'carddemo', 'link.md'), /Symbolic link/);
  const files = new WorkspaceFiles(f.root);
  await assert.rejects(files.read('analysis/carddemo/SECRETS.local.md'), /Private/);
});

test('UI supports the runner SOURCE contract without a legacy symlink and dotted system names', async t => {
  const f = await fixture(t), source = path.join(f.root, 'source');
  await fs.rename(path.join(f.root, 'legacy/carddemo'), source);
  await fs.writeFile(path.join(f.dir, 'SOURCE'), source + '\n');
  assert.match((await sourceView(f.root, 'carddemo', 'app/cbl/COACTUPC.cbl')).text, /IDENTIFICATION/);
  await fs.rename(f.dir, path.join(f.root, 'analysis/card.demo'));
  assert.equal((await readModel(f.root, { system: 'card.demo' })).data.system, 'card.demo');
});

test('uplift and reimagine views follow their own artifacts and stage rails', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'DELTA_CATALOG.md'), '# Delta catalog\n\n### DELTA-001: Update runtime\n**Category:** Behavioral-silent\n**Source:** `pom.xml:1-2`\n');
  await fs.writeFile(path.join(f.dir, 'BASELINE.md'), '# Baseline\n\n| Module | Pass | Fail | Error | Skip |\n|---|---|---|---|---|\n| core | 20 | 1 | 0 | 0 |\n');
  let m = (await readModel(f.root, { system: 'carddemo', track: 'uplift' })).data;
  assert.equal(m.track, 'uplift'); assert(m.stages.some(s => s.key === 'deltas' && s.isDone)); assert(m.stages.some(s => s.key === 'baseline' && s.isDone));
  assert.match(m.next.text, /modernize-uplift/);
  await fs.writeFile(path.join(f.dir, 'AI_NATIVE_SPEC.md'), '# Specification\n');
  m = (await readModel(f.root, { system: 'carddemo', track: 'reimagine' })).data;
  assert.equal(m.track, 'reimagine'); assert(m.stages.some(s => s.key === 'spec' && s.isDone)); assert.equal(m.percent, null);
});

test('map proof chips agree with the report when saved verdicts contradict their counts', async t => {
  const f = await fixture(t), proof = await f.read('VERIFICATION.json');
  proof.modules[0].evidence.tests.executed = 0;
  await fs.writeFile(path.join(f.dir, 'VERIFICATION.json'), JSON.stringify(proof));
  const model = await f.model();
  assert.equal(model.proofs.coactupc.verdict, 'NOT PROVEN');
  assert.equal(model.tiles.find(t => t.id === 'COACTUPC').proof, 'not');
  assert.equal(model.proof.modules[0].verdict, 'NOT PROVEN');
});

test('unsafe Markdown mirror is rejected before the review JSON can change', async t => {
  const f = await fixture(t), input = await decision(f), before = await fs.readFile(path.join(f.dir, 'RULE_REVIEWS.json'), 'utf8');
  await fs.symlink(path.join(f.root, 'unrelated'), path.join(f.dir, 'RULE_REVIEWS.md'));
  await assert.rejects(saveReview(f.root, 'carddemo', input), /Symbolic link/);
  assert.equal(await fs.readFile(path.join(f.dir, 'RULE_REVIEWS.json'), 'utf8'), before);
});

test('atomic interface outputs refuse symlinks and hardlinks', async t => {
  const f = await fixture(t), files = new WorkspaceFiles(f.root), external = path.join(f.root, 'unrelated');
  await fs.writeFile(external, 'keep');
  await fs.symlink(external, path.join(f.dir, 'REPORT.html'));
  assert.throws(() => atomicText(files, 'analysis/carddemo/REPORT.html', 'replacement'), /Symbolic link/);
  await fs.unlink(path.join(f.dir, 'REPORT.html')); await fs.link(external, path.join(f.dir, 'REPORT.html'));
  assert.throws(() => atomicText(files, 'analysis/carddemo/REPORT.html', 'replacement'), /unshared/);
  assert.equal(await fs.readFile(external, 'utf8'), 'keep');
});

test('report reuses original renderer, embeds safe JSON and pins executable scripts by hash', async t => {
  const f = await fixture(t), html = await renderReport(f.root, 'carddemo');
  assert(!html.includes('@@DATA@@')); assert(!html.includes('@@CSP@@'));
  assert.match(html, /mermaid-lib/); assert.match(html, /connect-src 'none'/);
  const data = JSON.parse(/id="report-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.system, 'carddemo'); assert.equal(data.demo, true);
  assert.equal(data.glance.topology.measure, 'lines'); assert.equal(data.glance.topology.granularity, 'module');
  assert(data.sections.some(s => s.id === 'proof')); assert(data.sections.some(s => s.id === 'diagrams'));
  const app = /<script id="app">([\s\S]*?)<\/script>/.exec(html)[1];
  const sha = createHash('sha256').update(app).digest('base64'); assert(html.includes(`'sha256-${sha}'`));
  const attack = '</script><img src=x onerror=alert(1)>\u2028';
  assert(!scriptJSON({ attack }).includes('<')); assert.equal(JSON.parse(scriptJSON({ attack })).attack, attack);
  const output = await writeReport(f.root, 'carddemo');
  assert.equal(output, path.join(f.dir, 'REPORT.html'));
  const saved = await fs.readFile(output, 'utf8');
  assert.equal(JSON.parse(/id="report-data">([\s\S]*?)<\/script>/.exec(saved)[1]).system, 'carddemo');
});

test('a report without topology preserves byte/file units and unmapped dependencies', async t => {
  const f = await fixture(t); await fs.unlink(path.join(f.dir, 'topology.json'));
  const data = await reportData(f.root, 'carddemo');
  assert.equal(data.glance.topology.measure, 'bytes');
  assert.equal(data.glance.topology.granularity, 'file');
  assert(data.glance.topology.loc > 0);
  const facts = data.sections.find(s => s.id === 'diagrams').parts.find(p => p.t === 'facts').items;
  assert.deepEqual(facts, [['Files', String(data.glance.topology.modules)], ['Source bytes', String(data.glance.topology.loc)], ['Dependencies', 'Not mapped']]);
});

test('report excludes secrets and marks oversized artifacts as omitted', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'SECRETS.local.md'), 'private-do-not-publish');
  await fs.writeFile(path.join(f.dir, 'ASSESSMENT.md'), '# Assessment\napi_key="private-do-not-publish"\n');
  const data = await reportData(f.root, 'carddemo');
  assert(!JSON.stringify(data).includes('private-do-not-publish'));
  assert.match(JSON.stringify(data), /REDACTED/);
  await fs.writeFile(path.join(f.dir, 'ASSESSMENT.md'), 'x'.repeat(5 << 20));
  assert.match(JSON.stringify(await reportData(f.root, 'carddemo')), /size limit|exceeds/);
});

test('UI redacts quoted credential fields and refuses credential JSON files', async t => {
  const f = await fixture(t), files = new WorkspaceFiles(f.root);
  assert.equal(uiRedact('{"password": "hidden", "api_key":"also-hidden"}'), '{"password": "[REDACTED]", "api_key":"[REDACTED]"}');
  assert.equal(uiRedact({ access_token: 'hidden', text: "{'secret':'hidden'}" }).access_token, '[REDACTED]');
  await assert.rejects(files.read('legacy/carddemo/credentials.json'), /Private/);
  await assert.rejects(files.read('legacy/carddemo/.aws/config'), /Private/);
});

test('saved proof presentation never accepts a forged PROVEN headline', async t => {
  const f = await fixture(t), proof = await f.read('VERIFICATION.json');
  proof.modules[0].evidence.tests.executed = 0;
  let view = proofView(proof); assert.equal(view.verdict, 'NOT PROVEN'); assert(view.problems.length);
  proof.modules[0].evidence.tests.executed = 42; proof.modules[0].checks.pop();
  view = proofView(proof); assert.equal(view.verdict, 'PARTLY PROVEN');
  proof.modules[0].evidence.fresh.inputs = 2;
  assert.equal(proofView(proof).modules[0].checks.find(c => c.id === 'fresh').state, 'gap');
});

test('runner cooperative cancellation is scoped to the current run generation', async t => {
  const f = await fixture(t), engine = new Engine();
  engine.runDir = f.dir; engine.state = { id: 'test-run', controlToken: 'current-generation' }; engine.abort = new AbortController();
  await fs.writeFile(path.join(f.dir, 'cancel.json'), JSON.stringify({ version: 1, runId: 'test-run', controlToken: 'old-generation' }));
  await engine.checkCancellation(); assert.equal(engine.abort.signal.aborted, false);
  await fs.writeFile(path.join(f.dir, 'cancel.json'), JSON.stringify({ version: 1, runId: 'test-run', controlToken: 'current-generation' }));
  await engine.checkCancellation(); assert.equal(engine.abort.signal.aborted, true);
  assert.match(engine.abort.signal.reason.message, /modernization panel/);
});

test('HTTP panel binds loopback, authenticates reads and blocks cross-origin decisions', async t => {
  const f = await fixture(t), panel = await startPanel({ workspace: f.root, system: 'carddemo', view: 'review', scope: 'p0', filter: 'interest cents' });
  t.after(() => panel.close());
  assert.equal(panel.server.address().address, '127.0.0.1');
  assert.equal(new URL(panel.url).searchParams.get('scope'), 'p0');
  assert.equal(new URL(panel.url).searchParams.get('filter'), 'interest cents');
  const headers = { 'X-Modernization-Token': panel.token };
  assert.equal((await fetch(panel.origin + '/api/model')).status, 401);
  const main = await fetch(panel.origin + '/'); assert.match(main.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  let r = await fetch(panel.origin + '/api/model', { headers }); assert.equal(r.status, 200); assert.equal((await r.json()).system, 'carddemo');
  r = await fetch(panel.origin + '/api/model', { headers: { ...headers, Origin: 'https://attacker.invalid' } }); assert.equal(r.status, 403);
  const input = await decision(f);
  r = await fetch(panel.origin + '/api/review', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(r.status, 422);
  r = await fetch(panel.origin + '/api/review', { method: 'POST', headers: { ...headers, Origin: panel.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(r.status, 200);
  assert.equal((await f.read('RULE_REVIEWS.json')).reviews['RULE-003'].verdict, 'discuss');
  r = await fetch(panel.origin + '/api/review', { method: 'POST', headers: { ...headers, Origin: panel.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); assert.equal(r.status, 409);
  r = await fetch(panel.origin + '/api/source?file=../../outside', { headers }); assert.equal(r.status, 422);
  r = await fetch(panel.origin + '/api/report', { headers }); assert.equal(r.status, 200); assert.match(await r.text(), /report-data/);
  r = await fetch(panel.origin + '/api/report?track=reimagine', { headers }); assert.equal(r.status, 200);
  assert.match(await r.text(), /"track":\{"label":"reimagine"/);
  const rel = path.join(f.dir, '.codex-sdk/runs/demo-run');
  await fs.writeFile(path.join(rel, 'state.json'), JSON.stringify({ id: 'demo-run', status: 'running', supportsCancellation: true, controlToken: 'this-generation' }));
  r = await fetch(panel.origin + '/api/stop', { method: 'POST', headers: { ...headers, Origin: panel.origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ runId: 'demo-run' }) });
  assert.equal(r.status, 200); assert.equal(JSON.parse(await fs.readFile(path.join(rel, 'cancel.json'), 'utf8')).controlToken, 'this-generation');
});
