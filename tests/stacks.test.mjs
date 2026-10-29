// SPDX-License-Identifier: Apache-2.0
// Selected assertions from Anthropic stacks.test.ts at c8874f5ad883, replayed
// against the real Node readers. These fixtures do not execute any target stack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot } from '../runtime/ui/upstream/reader/progress.mjs';
import { discoverEstate } from '../runtime/ui/upstream/reader/discover.mjs';
import { tilesOf } from '../runtime/ui/upstream/map/estate.mjs';
import { memoryFs, MAVEN_UPLIFT, PHP_NO_MAP, DOTNET_REWRITE, NODE_REWRITE, REIMAGINE, LEGACY_ONLY, PYTHON_BIG } from './fixtures/upstream-stacks.mjs';
import { FULL } from './fixtures/upstream-workspace.mjs';
const read = (files, options = {}) => readSnapshot(memoryFs(files), new Map(), { commandPrefix: '$modernize-', nowMs: 0, ...options });
test('original Maven uplift shows matching, failing and changed-but-untested modules separately', async () => {
  const s = await read(MAVEN_UPLIFT); assert.equal(s.track, 'uplift'); assert.equal(s.estate.granularity, 'build module');
  assert.equal(s.byNode.get('shop-core').state, 'reviewed'); assert.equal(s.byNode.get('shop-web').state, 'tests-red'); assert.equal(s.byNode.get('shop-batch').state, 'scaffolded');
  assert(s.attention.includes('shop-web: 3 failing, the baseline had 0')); assert.equal(s.stages.find(s => s.key === 'baseline').detail, '78 tests');
});
test('original PHP estate excludes assets and docs without requiring a topology', async () => {
  const s = await read(PHP_NO_MAP); assert.equal(s.estate.source, 'tree'); assert.equal(s.estate.units.length, 27);
  assert.equal(s.estate.granularity, 'file'); assert.deepEqual(s.estate.languages, [{ name: 'PHP', share: 1 }]);
  assert.equal(s.next.text, '$modernize-assess webshop');
});
test('original .NET mixed-language solution reads its project tiles and real TRX fixture counts', async () => {
  const s = await read(DOTNET_REWRITE); assert.deepEqual(s.estate.units.map(u => u.name).sort(), ['Ledger.Core', 'Ledger.Web']);
  assert.deepEqual(s.estate.languages.map(l => l.name), ['C#', 'VB.NET', 'ASP.NET']); assert.equal(s.byNode.get('Ledger.Core').tests.tests, 14);
  assert.equal(s.byNode.get('Ledger.Core').state, 'tests-green');
});
test('original Node monorepo accepts observed tests only for the explicitly matching module', async () => {
  const before = await read(NODE_REWRITE); assert.equal(before.modules[0].state, 'tests-written');
  const after = await read(NODE_REWRITE, { observed: new Map([['modernized/portal/billing', { tests: 9, failures: 0, errors: 0, skipped: 1, reports: 1 }]]) });
  assert.equal(after.modules[0].state, 'tests-green'); assert.equal(after.byNode.get('packages/billing').tests.tests, 9);
  assert.deepEqual(after.estate.units.map(u => u.name).sort(), ['auth', 'billing', 'portal', 'ui']);
});
test('original Perl-to-Python reimagine keeps untested scaffolds visible', async () => {
  const s = await read(REIMAGINE); assert.equal(s.track, 'reimagine');
  assert.deepEqual(s.modules.map(m => `${m.dir}:${m.state}`).sort(), ['accounts:tests-green', 'billing:scaffolded']);
  assert(s.attention.includes('billing: scaffolded with no acceptance tests')); assert.equal(s.percent, null);
});
test('original legacy-only COBOL estate remains unanalysed and offers the front door', async () => {
  const s = await read(LEGACY_ONLY); assert.equal(s.system, 'ops'); assert(s.stages.every(stage => !stage.isDone));
  assert.deepEqual(s.estate.languages, [{ name: 'COBOL', share: 1 }]); assert.equal(s.next.text, '$modernize ops');
});
test('original large Python estate aggregates directories and marks incomplete inventory budgets', async () => {
  const s = await read(PYTHON_BIG); assert.equal(s.estate.units.length, 6); assert.equal(s.estate.granularity, 'directory');
  const estate = await discoverEstate(memoryFs(PYTHON_BIG), 'legacy/erp', 'erp', { dirs: 3, entries: 80000 });
  assert.equal(estate.isPartial, true);
});
test('original stack tiles preserve complete area allocation and never exceed their frame', async () => {
  for (const fixture of [MAVEN_UPLIFT, PHP_NO_MAP, DOTNET_REWRITE, NODE_REWRITE, REIMAGINE, LEGACY_ONLY, PYTHON_BIG, FULL]) {
    const s = await read(fixture), tiles = tilesOf(s, 160, 42);
    assert.equal(tiles.reduce((n, t) => n + t.rect.w * t.rect.h, 0), 160 * 42);
    assert(tiles.every(t => t.rect.x >= 0 && t.rect.y >= 0 && t.rect.x + t.rect.w <= 160 && t.rect.y + t.rect.h <= 42));
  }
});
test('original mapped COBOL-to-Java workspace retains rules, human brief and tested module links', async () => {
  const s = await read(FULL); assert.equal(s.system, 'billing'); assert.equal(s.track, 'transform');
  assert.equal(s.estate.source, 'map'); assert.equal(s.byNode.get('INTCALC').tests.tests, 12);
  assert(s.rules.rules.some(r => r.id === 'P0-001')); assert.equal(s.brief.approval.isSigned, true);
});
