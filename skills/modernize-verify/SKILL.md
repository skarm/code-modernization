---
name: modernize-verify
description: "Independently examine real tests, mutation sensitivity and fresh old/new behavior; report gaps without repairing the candidate."
metadata:
  argument-hint: "<system> [module]"
  upstream-source: "commands/modernize-verify.md"
---

# modernize-verify

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-verify.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
SDK routing applies to evidence collection/review; final proof calculation is a local Node command.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-verify <system> [module]`. Arguments are semantic values, not shell interpolation.

Read [VERIFICATION.md](../../references/VERIFICATION.md) IN FULL before proceeding.
Collect real runner/comparator evidence, then run the bundled deterministic Node proof pack.
Its verdict is computed from files by fixed rules. It is scoped evidence, not a formal proof
or production sign-off; do not replace it with a model's assessment.

## Independence and scope

Use a fresh independent Codex SDK thread for evaluation when available; supply artifacts and
code, not the implementation agent's optimistic summary. If no independent execution is
available, report that limitation in the separate review; the mechanical verdict still
comes from the proof command, never from a claimed independent model opinion.
Select real modules/build units from the brief/topology/notes, not test-only folders.
For uplift use the full candidate and its baseline; for reimagine enumerate all approved
services and unimplemented capabilities. The proof command rejudges every built module.
Its optional module records the request; an uplift unit narrows suites, never hides failures.

Verification may write its own evidence/reports and scratch copies, but must NOT repair
the deliverable, tests, development inputs, oracles or approvals to improve the verdict.
Unsafe commands/targets require resolution; never hit production to obtain missing proof.

## Evidence collection

1. Check the approved contract, unresolved human questions and P0 RULE coverage. An ID
   only in a README, skipped test or nonexecuted method is not covered; tie each obligation
   to a specific actually passing test. Review wrong/discuss decisions rather than blindly
   treating every extracted card as a contract.
2. Run the full applicable suite with the real target runner. Preserve exact command,
   working directory, exit code, raw reports and logs. Capture pipeline failures correctly.
   Missing tools, zero executed or only skipped tests do not prove anything. Parser/raw
   evidence must distinguish failures, skips and expected approved baseline exceptions.
3. Run a real canary in a complete disposable copy, including required parent build files.
   Mutate a behavior exercised by a passing test, demonstrate a new failure, preserve the
   diff/commands/reports and discard the copy. A textual promise or failing build is not
   proof that a meaningful behavior test detected a change.
4. Recompute development comparisons from unmodified cases/inputs, refreshed real output
   from the candidate and legitimate old observations. Preserve existing approvedInputs/
   approvedDifference decisions. Never normalize an unapproved difference away.
   Use the installed `scripts/modernize.mjs compare --cases <absolute cases.json>` for
   supported byte/decimal comparisons. Inspect coverageGaps, selfCheck and hashes; a
   successful comparison is one evidence source, not the final behavior verdict.
5. Add at least TEN new unique semantic inputs per judged module, distinct from development
   cases; they are input groups, not output-file count or repeated status variants. Include
   relevant boundaries and failures. Actually run both old and new implementations and
   save outputs under equivalence/fresh. Missing legacy execution/oracles limits proof.
6. Compare meaningful payload/state/output with a mechanically executed comparator as
   specified in the reference. If the available tools cannot implement a required mask
   or tolerance safely, record a gap; manual visual matching is not machine equivalence.
7. For uplift compare measured old/new per-test results, pre-existing failures, changed
   test selection and silent-delta coverage. Removed tests or a change to over a quarter
   of the test files need explicit review; a smaller change can still be a material gap.
8. Check source protection and artifact freshness with actual available host facilities.
   Timestamps alone do not establish immutability. Don't claim OS isolation from role text.

## Verdict and handoff

Save the original evidence paths/shapes described in the reference, then execute:

```sh
node "<PLUGIN_ROOT>/scripts/proof-pack.mjs" SYSTEM [MODULE] --workspace WORKSPACE
```

Pass actual argument values separately. Alternatively use `scripts/modernize.mjs verify
--workspace WORKSPACE --system SYSTEM [--module MODULE]`. No SDK/model call is made by
these commands. Exit 0: PROVEN; 1: PARTLY PROVEN or NOT PROVEN; 2: unusable input.
They write VERIFICATION.md/JSON with evaluator `codex-node-proof-pack`, fixed reasons,
evidence hashes, limitations and blank human sign-off. Inspect problems and failed/gap
checks, preserve them, and report the computed verdict. Never hand-write a successful
verdict or a numeric overall confidence score. Recollect evidence and rerun after changes.

Leave the separate named-human verification sign-off blank. Do not use `$modernize-sign`
for it: that command signs the BRIEF only. Report concrete repair work and the relevant
build skill; do not perform repairs during verification. A changed implementation needs
new verification. Refresh REPORT.html. Human review precedes the next module/release.
