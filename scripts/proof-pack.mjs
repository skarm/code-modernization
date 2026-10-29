#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Positional CLI compatible with upstream proof_pack.py; runtime is entirely Node.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildProofPack, writeProofPack } from '../runtime/proof-pack.mjs';
import { redact } from '../runtime/util.mjs';
import { clean } from '../runtime/proof-io.mjs';

export async function main(argv = process.argv.slice(2)) {
  const positional = []; let workspace = process.cwd(), seenWorkspace = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log('node scripts/proof-pack.mjs SYSTEM [MODULE] [--workspace DIR]\nExit 0: PROVEN; 1: PARTLY PROVEN / NOT PROVEN; 2: unusable input.'); return 0; }
    if (argv[i] === '--workspace') {
      if (seenWorkspace || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('--workspace needs one directory');
      workspace = path.resolve(argv[++i]); seenWorkspace = true;
    } else if (argv[i].startsWith('-')) throw new Error('Unknown option: ' + argv[i]);
    else positional.push(argv[i]);
  }
  if (positional.length < 1 || positional.length > 2) throw new Error('Expected SYSTEM [MODULE] [--workspace DIR]');
  const pack = await buildProofPack(positional[0], workspace, positional[1] ?? null), outputs = await writeProofPack(pack, workspace);
  console.log(`${pack.system}: ${pack.overall.verdict}`);
  for (const m of pack.modules) { console.log(`  ${clean(m.name, 60)} (${m.track}): ${m.verdict}, tests executed: ${m.evidence.tests.executed}, failed ${m.evidence.tests.failed}`); for (const r of m.reasons) console.log('    - ' + r); }
  for (const t of pack.toolingOnly) console.log(`  ${clean(t.name, 60)} (${t.track}): test tooling, not judged`);
  console.log(`Wrote ${clean(outputs.markdown, 2000)} and ${clean(outputs.json, 2000)}`);
  return pack.overall.verdict === 'PROVEN' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().then(code => { process.exitCode = code; }).catch(e => { console.error('proof-pack: ' + redact(String(e.message))); process.exitCode = 2; });
