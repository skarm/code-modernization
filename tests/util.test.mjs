import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './helpers.mjs';
import { appendPrivateJSONL, atomicJSON, hash, integer, name, overlaps, readJSON, redact,
  relative, safeMkdir, safeResolve, snapshot, stable, validate, within } from '../runtime/util.mjs';
import { record, string, count, array } from '../runtime/schemas.mjs';

for (const bad of ['../x', '/etc/passwd', 'C:\\Windows', 'x/../y', 'a//b', 'a/.', 'a.', 'a ', 'x\0y', 'a:b']) {
  test(`reject relative path ${JSON.stringify(bad)}`, () => assert.throws(() => relative(bad)));
}
for (const good of ['a/b.go', 'name with spaces/file.go', '日本語/main.go', 'a\\b.go']) {
  test(`accept quoted/data path ${good}`, () => assert.equal(typeof relative(good), 'string'));
}
test('identifiers, bounded integers and overlap checks', () => {
  assert.throws(() => name('../bad')); assert.throws(() => name('a.'));
  assert.equal(integer(undefined, 4, 1, 16, 'concurrency'), 4);
  assert.throws(() => integer(0, 4, 1, 16, 'concurrency'));
  assert.equal(overlaps('/a/b', '/a/bc'), false); assert.equal(overlaps('/A/B', '/a/b/c'), true);
  assert.equal(within('/a', '/a/b'), true);
});
test('canonical hash ignores property insertion order', () => assert.equal(hash({ a: 1, b: 2 }), hash({ b: 2, a: 1 })));
test('schema validation is structural and strict', () => {
  const schema = record({ value: string, n: count, values: array(string, 2) });
  validate(schema, { value: 'x', n: 0, values: [] });
  for (const value of [{ value: 'x' }, { value: 'x', n: -1, values: [] }, { value: 'x', n: 1.5, values: [] },
    { value: 'x', n: 1, values: ['a', 'b', 'c'] }, { value: 'x', n: 1, values: [], extra: 1 }]) assert.throws(() => validate(schema, value));
  assert.throws(() => validate({ type: 'string', pattern: 'x' }, 'x'), /Unsupported schema keyword/);
});
test('redaction covers token/password/private key in nested records', () => {
  const result = redact({ values: ['api_key=sk-' + 'x'.repeat(30), 'password: abcdef', '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----'] });
  assert(!stable(result).includes('abcdef')); assert(!stable(result).includes('x'.repeat(30))); assert(!stable(result).includes('\nsecret'));
});
test('atomic JSON roundtrip and event log append', async t => {
  const f = await fixture(t), file = path.join(f.root, 'data.json'), log = path.join(f.root, 'events.jsonl');
  await atomicJSON(file, { a: 1 }); await atomicJSON(file, { a: 2 }); assert.deepEqual(await readJSON(file), { a: 2 });
  await appendPrivateJSONL(log, { a: 1 }); await appendPrivateJSONL(log, { a: 2 });
  assert.equal((await fs.readFile(log, 'utf8')).trim().split('\n').length, 2);
});
test('state and event logs reject symlinks/hardlinks', async t => {
  const f = await fixture(t), target = path.join(f.source, 'main.go');
  for (const type of ['symlink', 'hardlink']) {
    const file = path.join(f.root, `${type}.json`);
    if (type === 'symlink') await fs.symlink(target, file); else await fs.link(target, file);
    await assert.rejects(atomicJSON(file, {})); await assert.rejects(appendPrivateJSONL(file, {}));
  }
});
test('safe output directory rejects symlink ancestor', async t => {
  const f = await fixture(t); await fs.symlink(f.source, path.join(f.workspace, 'alias'));
  await assert.rejects(safeMkdir(f.workspace, 'alias/x'), /Unsafe output/);
});
test('safeResolve rejects symlink escape', async t => {
  const f = await fixture(t); await fs.symlink(f.root, path.join(f.source, 'escape'));
  await assert.rejects(safeResolve(f.source, 'escape'), /escapes scope/);
});
test('snapshot detects content, mode and file list changes', async t => {
  const f = await fixture(t); const before = await snapshot(f.source);
  await fs.writeFile(path.join(f.source, 'main.go'), 'changed');
  assert.notEqual((await snapshot(f.source)).sha256, before.sha256);
  await fs.mkdir(path.join(f.source, '.git')); const beforeGit = await snapshot(f.source);
  await fs.writeFile(path.join(f.source, '.git', 'state'), 'ignored');
  assert.equal((await snapshot(f.source)).sha256, beforeGit.sha256);
});
test('writable snapshots reject symlinks and hardlinks', async t => {
  const f = await fixture(t); const dir = path.join(f.root, 'candidate'); await fs.mkdir(dir);
  await fs.symlink(path.join(f.source, 'main.go'), path.join(dir, 'alias'));
  await assert.rejects(snapshot(dir, { writable: true }), /symlink/);
  await fs.unlink(path.join(dir, 'alias')); await fs.link(path.join(f.source, 'main.go'), path.join(dir, 'alias'));
  await assert.rejects(snapshot(dir, { writable: true }), /hard-linked/);
});

test('Finder metadata never changes source or writable candidate snapshots', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, 'nested'));
  const before = await snapshot(f.source, { writable: true });
  for (const rel of ['.DS_Store', 'nested/.DS_Store']) await fs.writeFile(path.join(f.source, rel), 'Finder metadata');
  assert.deepEqual(await snapshot(f.source, { writable: true }), before);
  await fs.writeFile(path.join(f.source, '.DS_Store'), 'updated metadata');
  assert.deepEqual(await snapshot(f.source), before);
  await fs.unlink(path.join(f.source, '.DS_Store'));
  assert.deepEqual(await snapshot(f.source), before);
});
