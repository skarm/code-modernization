// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { regexSpans } from '../runtime/regex-mask.mjs';
for (const [source, bytes, expected] of [
  [String.raw`([A-Z])\1`, 'XAABCCZ', [[1, 3], [4, 6]]],
  [String.raw`(?P<letter>A)(?P=letter)`, 'BAAC', [[1, 3]]],
  [String.raw`(a)?\1b|b`, 'b aab', [[0, 1], [2, 5]]],
  [String.raw`(a)?(?(1)b|c)`, 'ab c', [[0, 2], [3, 4]]],
  [String.raw`(?P<letter>a)?(?(letter)b|c)`, 'ab c', [[0, 2], [3, 4]]],
  [String.raw`(?i:a)B`, 'aB AB ab', [[0, 2], [3, 5]]],
  [String.raw`(?i:a(?-i:B))`, 'aB AB ab', [[0, 2], [3, 5]]],
  [String.raw`(?a:\w+)-(?u:\w+)`, 'a-é½', [[0, 4]]],
  [String.raw`(?ai)é[A-Z]+`, 'ÉA éAz', [[3, 6]]],
  [String.raw`(?>a+).`, 'aaab', [[0, 4]]],
  [String.raw`a++a`, 'aaa', []],
  [String.raw`(?<=a(?:bc))d`, 'abcd', [[3, 4]]],
  [String.raw`(?<=a{2})b`, 'aab', [[2, 3]]],
  [String.raw`[\W]+`, 'é½_!?', [[3, 5]]],
  [String.raw`(?i)\u00e9\141`, 'Éa', [[0, 2]]],
  [String.raw`\N{LATIN SMALL LETTER E WITH ACUTE}[\N{LF}]`, 'é\n', [[0, 2]]],
  [String.raw`(?>\v)`, '\n\v\f', [[1, 2]]],
]) test(`advanced Python-compatible byte mask ${source}`, async () => {
  assert.deepEqual(await regexSpans(Buffer.from(bytes, 'latin1'), source, { timeoutMs: 4000 }), expected);
});
for (const source of [String.raw`(a)?\2`, String.raw`(?<=a|bc)d`, String.raw`(?<=a+)b`, String.raw`(?i:a`, String.raw`(?P<x>a)(?P<x>b)`, String.raw`(*ACCEPT)`]) test(`invalid Python syntax is never widened: ${source}`, async () => {
  await assert.rejects(regexSpans(Buffer.from('abc'), source));
});
for (const [source, bytes] of [[String.raw`(?>a)|$`, 'a'], [String.raw`(?>)`, ''], [String.raw`(?i:^a*)`, 'b']]) test(`advanced zero-length match is a gap: ${source}`, async () => {
  await assert.rejects(regexSpans(Buffer.from(bytes), source, { timeoutMs: 4000 }), /Zero-length/);
});
