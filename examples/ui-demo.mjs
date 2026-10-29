// SPDX-License-Identifier: Apache-2.0
// Synthetic artifacts for UI development. These are not modernization evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHECKS } from '../runtime/proof-pack.mjs';
import { isFinderMetadata } from '../runtime/util.mjs';

export async function createDemo(workspace) {
  await fs.mkdir(workspace, { recursive: true });
  if ((await fs.readdir(workspace)).some(entry => !isFinderMetadata(entry))) throw new Error('The demo needs an empty directory; existing files were not changed.');
  const write = async (file, value) => { const full = path.join(workspace, file); await fs.mkdir(path.dirname(full), { recursive: true }); await fs.writeFile(full, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n'); };
  const system = 'carddemo', a = `analysis/${system}/`, m = `modernized/${system}/`;
  const groups = [
    ['Accounts', ['COACTUPC', 'COACTVWC', 'COACCT01', 'COACCT02', 'COACCT03', 'COACCT04']],
    ['Cards', ['COCRDLIC', 'COCRDUPC', 'COCRDSLC', 'COCRD001', 'COCRD002']],
    ['Transactions', ['COTRN00C', 'COTRN01C', 'COTRN02C', 'COTRN03C', 'COTRN04C', 'COTRN05C']],
    ['Batch', ['CBACT01C', 'CBACT02C', 'CBACT03C', 'CBACT04C', 'CBTRN01C', 'CBTRN02C']],
    ['Identity', ['COSGN00C', 'COMEN01C', 'COUSR00C', 'COUSR01C', 'COUSR02C']],
  ];
  const modules = groups.flatMap(([group, names], gi) => names.map((id, i) => ({ id, name: id, kind: 'module', language: 'cobol', file: `app/cbl/${id}.cbl`, loc: 130 + ((gi * 631 + i * 417) % 3800) })));
  await write(a + 'DEMO.json', { synthetic: true, purpose: 'Interface demonstration only; no production claims' });
  await write(a + 'INTENT.md', '# Intent\n\nDEMO: synthetic credit-card system. Rewrite COBOL into Java 21 / Spring. Preserve ledger behavior.\n');
  await write(a + 'PREFLIGHT.md', '# Preflight\n\nDEMO: synthetic artifacts. Source and target are local demonstration files.\n');
  await write(a + 'ASSESSMENT.md', '# System assessment\n\nDEMO: a synthetic COBOL credit-card application with account, card, transaction and batch domains.\n\n## Risks\n\n- Preserve rounding and daily balance boundaries.\n- Review suspected defects before treating them as an oracle.\n');
  await write(a + 'topology.json', { system, root: { id: system, name: 'CardDemo', kind: 'system', children: groups.map(([domain, names]) => ({ id: `domain:${domain}`, name: domain, kind: 'domain', children: modules.filter(n => names.includes(n.id)) })) }, edges: [{ source: 'COACTUPC', target: 'COACCT01', kind: 'call' }, { source: 'CBACT04C', target: 'COACCT01', kind: 'read' }], entryPoints: ['COSGN00C'], deadEnds: [], observations: ['DEMO topology; module sizes are illustrative.'], flows: [{ name: 'Update account', persona: 'Operator', steps: [{ label: 'Validate update', nodes: ['COACTUPC'] }, { label: 'Persist account', nodes: ['COACCT01'] }] }] });
  for (const mod of modules) await write(`legacy/${system}/${mod.file}`, `       IDENTIFICATION DIVISION.\n       PROGRAM-ID. ${mod.id}.\n       DATA DIVISION.\n       WORKING-STORAGE SECTION.\n       01 DAILY-RATE PIC 9V9(8).\n       01 BALANCE PIC 9(9)V99.\n       01 INTEREST PIC 9(7)V99.\n       PROCEDURE DIVISION.\n           COMPUTE INTEREST = BALANCE * DAILY-RATE\n           GOBACK.\n`);
  const cards = [
    ['RULE-001', 'Account balance cannot exceed the limit', 'COACTUPC', 'Validation', 'High', 'An account update is rejected when the resulting balance exceeds its approved limit.', 'an account with a limit of 5000 and a balance of 4900', 'a debit of 200 is requested', 'the debit is rejected', '', ''],
    ['RULE-002', 'An inactive card cannot authorize a transaction', 'COCRDSLC', 'Policy', 'Medium', 'Only active cards may authorize a new transaction.', 'a card with inactive status', 'an authorization is requested', 'the transaction is declined', '', 'Does the business allow authorization during a pending card renewal?'],
    ['RULE-003', 'Interest uses the daily balance and truncates cents', 'CBACT04C', 'Calculation', 'Medium', 'Daily interest is calculated from the account balance and daily rate. The stored result truncates fractions of a cent.', 'a balance of 1000 and a daily rate of 0.000137', 'the daily interest batch runs', 'the posted interest is 0.13', 'The calculation truncates 0.137 to 0.13. Confirm whether truncation is intentional.', 'Should the replacement preserve truncation or record an approved rounding change?'],
    ['RULE-004', 'Rejected transactions leave the balance unchanged', 'COTRN01C', 'Lifecycle', 'High', 'A rejected transaction does not update the account balance.', 'an account balance of 250', 'a transaction is rejected', 'the balance remains 250', '', ''],
  ];
  await write(a + 'BUSINESS_RULES.md', '# Business rules\n\nDEMO: synthetic rules for interface testing.\n\n## Interest & accounts\n\n' + cards.map(([id, title, file, category, confidence, statement, given, when, then, defect, sme]) => `### ${id}: ${title}\n**Category:** ${category}\n**Priority:** P0\n**Source:** \`app/cbl/${file}.cbl:8-10\`\n**Plain English:** ${statement}\n**Specification:**\n  Given ${given}\n  When ${when}\n  Then ${then}\n${defect ? `**Suspected defect:** ${defect}\n` : ''}**Confidence:** ${confidence}${sme ? ' — SME question: ' + sme : ''}\n\n`).join(''));
  await write(a + 'MODERNIZATION_BRIEF.md', '# Modernization brief: CardDemo → Java 21 / Spring\n\nDEMO: synthetic plan.\n\n**Target stack:** `java-spring`\n\n## Phased plan\n\n#### Phase 1 — Pilot account update · Size S · Risk Medium\nCommand: $modernize-transform carddemo COACTUPC "java-spring"\nModules: COACTUPC\nExit criteria:\n- [x] Characterization tests pass\n- [x] Architecture review completed\n\n#### Phase 2 — Cards and transactions · Size L · Risk High\nModules: COCRDSLC, COTRN01C, CBACT04C\nExit criteria:\n- [ ] Resolve flagged P0 rules\n- [ ] Preserve all approved behavior\n\n## Open questions\n- [ ] Confirm interest rounding policy\n\n## Approval\nApproved by: ________________  Date: __________\nApproval covers: Phase 1 only | Full plan\n');
  await write(a + 'ARCHITECTURE.mmd', 'flowchart LR\n  Operator --> Accounts\n  Accounts --> Ledger\n  Cards --> Transactions\n  Transactions --> Ledger\n  Batch --> Ledger\n');
  for (const [i, id] of ['COACTUPC', 'COCRDSLC', 'COTRN01C'].entries()) {
    await write(m + id + '/TRANSFORMATION_NOTES.md', `# ${id}\n\nDEMO: synthetic build notes.\n\n${i === 0 ? '## Architecture review\nReviewed 2026-10-15. No open findings.\n' : 'Scaffold prepared; review is pending.\n'}`);
    await write(m + id + '/src/Main.java', `// DEMO module ${id}\nclass Main {}\n`);
    if (i < 2) await write(m + id + '/target/surefire-reports/TEST-demo.xml', `<testsuite name="Demo" tests="${i === 0 ? 42 : 12}" failures="${i === 0 ? 0 : 1}" errors="0" skipped="0"><testcase classname="Demo" name="RULE-001 demo"/></testsuite>`);
  }
  const evidence = { tests: { executed: 42, failed: 0, skipped: 0 }, fresh: { inputs: 12, executed: 12, same: 12, differs: 0, missing: 0 }, equivalence: { cases: 18, executed: 18, same: 18, differs: 0, missing: 0 }, rules: { p0: [{ id: 'RULE-001', name: cards[0][1], confidence: 'High', status: 'tested', tests: 4, main: 2, where: 'AccountTest.java:24' }] }, canary: [{ change: 'DEMO: invert the limit guard', testsFailed: 3, shown: true }] };
  const verifiedAt = new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC';
  await write(a + 'VERIFICATION.json', { system, version: 1, generated: verifiedAt, evaluator: 'SYNTHETIC-DEMO', overall: { verdict: 'PROVEN' }, modules: [{ name: 'COACTUPC', track: 'rewrite', verdict: 'PROVEN', verifiedAt, checks: Object.entries(CHECKS).slice(0, 6).map(([id, label]) => ({ id, label, state: 'pass', detail: 'DEMO: synthetic evidence for interface testing.' })), evidence, brief: { found: true, count: 1, items: [{ text: 'Confirm pilot acceptance', where: 'Phase 1' }] }, notProven: ['DEMO only. These results do not prove a real migration.'] }], problems: [], signoff: {} });
  await write(a + 'RULE_REVIEWS.json', { system, version: 1, reviews: { 'RULE-001': { verdict: 'confirmed', at: '2026-10-15T10:00:00Z', title: cards[0][1], note: 'DEMO: example reviewer note.' } } });
  const run = a + '.codex-sdk/runs/demo-run/';
  await write(run + 'state.json', { version: 2, id: 'demo-run', workflow: 'extract-rules', status: 'completed', createdAt: '2026-10-15T10:00:00Z', tasks: Object.fromEntries(['validation', 'calculation', 'lifecycle'].map((id, i) => [id, { role: 'business-rules-extractor', status: 'completed', workingDirectory: path.join(workspace, 'legacy/carddemo'), startedAt: '2026-10-15T10:00:00Z', finishedAt: '2026-10-15T10:01:00Z', error: i > 0 ? 'DEMO: source reader could not open the requested file' : null }])) });
  await write(a + 'VERIFICATION.md', '# Verification\n\nDEMO: all values are synthetic. See the proof section for the interface example.\n');
  await write(a + 'EQUIVALENCE.json', { evaluator: 'SYNTHETIC-DEMO', selfCheck: { passed: true, detail: 'DEMO synthetic comparator self-check' }, totals: { cases: 3, executed: 3 }, cases: ['balance-boundary', 'declined-card', 'daily-interest'].map(id => ({ id, title: `DEMO: ${id}`, verdict: 'same', empty: false, reason: 'DEMO: synthetic matching output', legacySha256: 'a'.repeat(64), newSha256: 'a'.repeat(64) })) });
  return { workspace, system };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error('Usage: node examples/ui-demo.mjs EMPTY_DIRECTORY');
  console.log(JSON.stringify(await createDemo(path.resolve(process.argv[2])), null, 2));
}
