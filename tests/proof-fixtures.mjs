// SPDX-License-Identifier: Apache-2.0
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export const corpus = JSON.parse(gunzipSync(fs.readFileSync(new URL('./fixtures/proof-pack-upstream.json.gz', import.meta.url))));
export function materialize(t, spec) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'proof-parity-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of spec.files) {
    const full = path.join(root, file.path); fs.mkdirSync(path.dirname(full), { recursive: true });
    if (file.link) fs.symlinkSync(file.link.replaceAll('{{WORKSPACE}}', root), full);
    else { const bytes = Buffer.from(Buffer.from(file.base64, 'base64').toString('binary').replaceAll('{{WORKSPACE}}', Buffer.from(root).toString('binary')), 'binary'); fs.writeFileSync(full, bytes); fs.utimesSync(full, file.mtime, file.mtime); }
  }
  return root;
}
export const rewriteFixture = t => materialize(t, corpus.cases.find(c => c.id.includes('ProofVerdicts.test_all_evidence_is_proven:')));
export function put(root, rel, text, when = 1700000020) {
  const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); fs.utimesSync(file, when, when); return file;
}
