> 0.5.0: collect real evidence with the project's tools; compute the verdict with the
> bundled deterministic Node proof pack. SDK response schemas do not prove behavior.

# Verification with the Node proof pack

> Ported from upstream proof_pack.py, baseline_diff.py, trace_rules.py, uplift_checks.py
> and compare.py at c8874f5ad883e26428f483ffa4d537cc81489e64 (Apache-2.0).
> This is a Node implementation with frozen upstream decision tests and explicit safety limits.

## Who does what

The project's runner executes tests and the old/new programs. Codex collects the real
reports, logs and observations. The Node evaluator reads those files, recomputes comparisons
and applies fixed rules; no model decides the generated verdict. It never runs a command
from test-runs.json, project code, a version-control tool, Python or a network request.
An independent SDK review can assess test quality; record whether one actually happened.
It is separate from the deterministic verdict and cannot manufacture or override its evidence.

After collecting evidence, run either entry point with separate argv values:

```sh
node "<PLUGIN_ROOT>/scripts/proof-pack.mjs" SYSTEM [MODULE] --workspace WORKSPACE
node "<PLUGIN_ROOT>/scripts/modernize.mjs" verify --system SYSTEM --workspace WORKSPACE
```

Both write analysis/SYSTEM/VERIFICATION.json and VERIFICATION.md. Exit 0 means PROVEN,
1 means PARTLY PROVEN or NOT PROVEN, 2 means unusable input. Every built module is judged
again, including when MODULE is supplied. An uplift unit argument narrows that copy's suites;
it never makes unrelated failed modules disappear. Test-only tooling is listed separately.
The proof command uses Node plus the pinned XML parser installed by `npm ci`; it does not
load the SDK or require Codex authentication. Do not hand-edit its computed verdict.

The evaluator does not repair the deliverable, tests, development inputs or old oracles.
Canaries run only on complete disposable copies. Observe existing workspace permissions,
never run against production and never execute scripts merely because an artifact asks.

## Evidence layout

All paths below are under analysis/<system> unless stated otherwise:

- equivalence/cases.json — development comparisons.
- equivalence/fresh-cases.json, equivalence/fresh/legacy/<input>/ and fresh/new/<input>/.
- equivalence/canary/<module>/ — actual mutation diff, raw test results, command record.
- equivalence/test-runs.json — original manifest shape below.
- EQUIVALENCE.json; equivalence/FRESH_EQUIVALENCE.json — derived observations.
- VERIFICATION.md and VERIFICATION.json — evaluator's scoped verdict with limitations.
- baseline/ and BASELINE.md — measured old-suite evidence for uplift.

For multiple rewrite modules, use equivalence/<module>/cases.json and fresh-cases.json,
with each case's output paths relative to its cases file. Do not mix modules or count
test-runner/helper directories as implemented modules.

Use the original input fields below. Generated JSON follows the upstream v1 module/check/
evidence/overall/toolingOnly/signoff structure, with additional evaluator, pluginVersion,
upstreamCommit and evidenceFiles (SHA-256) metadata. Evaluator is codex-node-proof-pack.
Wording, ordering of diagnostic examples and extra metadata are not byte-identical to Python.

```json
{
  "system": "example",
  "legacy": {"label": "<actual source stack>", "command": "<actual invocation>"},
  "new": {"label": "<actual target stack>", "command": "<actual invocation>"},
  "cases": [
    {"id": "F01-out", "input": "F01", "title": "<real case>",
     "legacy": "fresh/legacy/F01/out.txt", "new": "fresh/new/F01/out.txt",
     "mask": [{"bytes": "278-330", "why": "<justified varying field>"}],
     "note": "<scope or limitation>"}
  ]
}
```

This is a schema illustration, not execution evidence. Omit mask when unnecessary.
A human may add `approvedDifference: "<reason>"` to a case or
`approvedInputs: {"F01": "<reason>"}` at the root. Preserve those decisions on reruns.
Transcribe only explicit acceptance of the actual difference, never auto-approve one
because an implementation note calls it intentional.

```json
{
  "date": "<actual YYYY-MM-DD>",
  "legacy": {"ran": false, "how": "", "why": "<actual reason>"},
  "leftOut": ["<real input/scope omission and reason>"],
  "suites": [
    {"module": "<actual module>", "name": "unit tests",
     "command": "<exact command>", "junit": ["<real report path>"],
     "log": ["<real log path>"], "skippedReason": "", "note": "<under 250 characters>"}
  ],
  "canaries": [
    {"module": "<actual module>", "change": "<actual mutation>",
     "junit": ["<real failing report>"], "log": ["<real failing log>"]}
  ]
}
```

The manifest points to evidence. Do not put invented summary counts in it. Empty arrays
and explicit reasons are correct when something did not run; example paths are not.

## Real tests and rule coverage

Capture the exact approved command, working directory, runtime version if available,
exit code and raw runner reports/logs. Preserve nonzero exits through pipelines. Read
runner-generated JUnit/.trx, Go JSON, another supported native format or a real summary;
if parsing is uncertain, mark counts unknown. A process exiting zero without executing
tests proves no behavior. Skipped, pending, ignored and expected-failure outcomes stay
separate from passing assertions. A missing oracle is a gap/failure, not an ignored test.

For each confirmed P0 contract rule, identify a specific executed PASS test. A RULE ID
in a test name/method or attached source comment is traceability, not semantic coverage
by itself: inspect that the assertions actually exercise the obligation. IDs in README,
logs, unexecuted methods or skipped tests do not count. Human-disputed rules cannot be
blindly converted into old-behavior contracts; unresolved P0 decisions block those modules.

For uplift use measured old per-test results, not just a manually typed table. Record
pre-existing failures rather than hiding or "fixing" the baseline. Review PASS→FAIL,
FAIL→PASS and missing tests; only specifically accepted baseline differences can be
explained exceptions. Compare test files/selection: removed files or more than a quarter
changed requires explicit human review. A smaller edit can still weaken an assertion.
Every Behavioral-silent DELTA needs a meaningful test referring to its actual source site.

## Canary and comparator self-check

A behavioral canary deliberately changes a real exercised behavior in a scratch copy.
Start from a passing test, make a minimal known incorrect result/branch, then show a NEW
assertion failure. A compile error, timeout caused by unavailable infrastructure, existing
failure or invented log is not sensitivity evidence. Keep the actual diff, command and
runner report; discard the altered copy and never leave the candidate mutated.

Separately self-check the mechanical comparator: compare identical nonempty samples and
then one deliberately altered byte/output. It must accept the first and reject the second.
Retain actual commands/results. A comparator that always prints "same" is not evidence.

## Actual equivalence, not model visual matching

Compare saved real observations from old and new executions. An available `cmp`/equivalent
host facility suffices for exact-byte cases. The existing project's language/toolchain
may supply a small task-specific test/harness for structured output, normalization or
exact decimal arithmetic. Such a harness is project output that must itself be reviewed
and run—not a shipped plugin runtime or a reason to install an unrelated language.

The bundled [Node comparator](../runtime/compare.mjs) runs without SDK/model calls:

```sh
node "<PLUGIN_ROOT>/scripts/modernize.mjs" compare --cases "<absolute cases.json>"
```

It writes EQUIVALENCE.json next to the manifest (or --output inside that directory),
records manifest/output hashes, input-group counts, masks, reasons and a real in-memory
mutation self-check. Exit 0 means all supported comparisons passed; 1 means differences
or gaps; 2 means unusable input. It never overwrites a manifest/observation or creates a
PROVEN verdict. The output identifies codex-node-comparator and behaviorEquivalenceProven:false.
Limits: 5,000 cases, 32 MiB per file, 256 MiB cumulative reads, numeric tokens up to 64
characters and decimal exponents within +/-1000. Limits/unsupported semantics are gaps.

Byte masks use the fixed-marker algorithm below. Decimal tolerance uses BigInt rather than
binary floats. Regex masks use a conservative Python-compatible Latin-1 subset: literals,
classes/ranges, alternation, quantifiers, captures, lookahead and fixed-width lookbehind.
The isolated PCRE2/WASM adapter adds numeric/named backreferences, group conditionals,
scoped i/m/s/x/a/u flags, atomic/possessive groups, nested fixed-width lookbehind,
negated shorthand classes in brackets, Latin-1 codepoint escapes and Unicode 16.0 names/aliases.
Python dot, anchors, word/space classes, ASCII case folding and byte offsets are translated
explicitly. Invalid Python lookbehind/references are refused. This remains a bounded
Latin-1 dialect: non-Latin-1 pattern characters/escapes, locale flags and Unicode group
names are not supported; PCRE-only verbs/recursion are not accepted as Python.
Zero-length matches are refused. An unsupported mask produces a missing comparison with a
reason, never a pass. Each regex runs in a worker with a 2-second limit and 64 MiB JS heap;
patterns are at most 2,048 characters and 100,000 matches. There are at most 32 masks per
case, 1,000 regex executions and a 30-second aggregate regex work window per cases file.

The recorded method must mechanically implement the declared comparison. If no safe
comparator is available, mark equivalence unexecuted; looking at two long outputs and
saying they seem equal is not a substitute. Never write a result file as if a missing
script produced it. Report actual tool name/version/command and its scope.

Default is exact bytes. Preserve these upstream comparison constraints when used:

1. Output paths resolve within the cases file's directory, including symlink resolution.
   Missing/unreadable/escaping paths are `missing`, not equal. No implicit allow-outside.
2. Byte masks are zero-based inclusive ranges. Regex masks use byte-preserving Latin-1
   semantics, not a silently different Unicode engine. Replace merged spans on both
   sides with the same fixed marker; do not delete arbitrary lines/differing fields.
   Every mask needs a defensible reason. If existing tooling cannot reproduce these
   semantics, choose exact comparison or record unsupported normalization as a gap.
3. Optional `tolerance: {"rel": ..., "abs": ..., "why": ...}` requires finite nonnegative
   values with at least one positive. Relative >0.01 or absolute >1e-6 is refused. Only
   differing numeric tokens containing a decimal point or exponent qualify; integer
   text, identifiers such as 1.2.3 and other bytes must still match exactly. Compare with
   exact decimal arithmetic: difference <= max(abs, rel * max(|old|, |new|)). Missing
   compatible arithmetic is a coverage gap, not an implicit binary-float approximation.
4. Record `same`, `differs`, `differs-approved` or `missing`. Approved differences remain
   listed as differences, with the human's reason. One acceptance is not a blanket mask.
5. Nonempty meaningful output must exist for proof. A side that legitimately produces
   no file may have an explicitly explained empty observation, not a fabricated oracle.
   Comparing only empty files, "OK", exit codes or repeated status lines is not proof of
   payload/state behavior. Record the observables a harness does and does not cover.

Refresh the NEW development outputs using an inspected runner without modifying inputs,
legacy outputs or cases.json. Inspect runner scripts first: some recreate/delete fixtures.
Changed oracles must be separately reviewed, never edited to fit the new implementation.

## Fresh inputs

For each judged module generate enough fresh semantic inputs that at least ten remain
after rejected/unsupported cases are excluded. They must be genuinely new relative to
development inputs, and contribute meaningful nonempty output distinct from development
outputs. Several files from one call share `input` and count as ONE input; repeated
status lines or superficial variants do not increase coverage. Save exact fixtures,
invocations, both real observations and mechanical comparisons.

Use rule/delta boundaries, empty/large values, ordering and meaningful failures. Match
malformed-record quirks when INTENT explicitly requires exact quirks or no INTENT exists;
otherwise stay within the declared input format and state malformed records were left
out. If legacy rejects a case, investigate and record it in leftOut; do not call it a
matching result or silently relax the requirement of ten accepted fresh inputs.

If legacy cannot actually execute here, the result is trace/source-based and cannot be
PROVEN. Preserve previous human-approved differences when adding cases on a rerun.

## Fixed checks and verdict

The evaluator applies six checks: tests ran; P0 rules traced; same behavior; at least ten
fresh input groups; canary sensitivity; source freshness. Uplift adds measured baseline,
test files kept (no removals and at most 25% changed), and Behavioral-silent delta references.
See the generated report's rules for the exact mechanical criteria. Test-file/class mentions
are traceability heuristics, not a proof of assertion quality or behavioral coverage.

JUnit/TRX results and saved Maven/Gradle, cargo, pytest, unittest, Go, dotnet, Jest/Vitest,
CTest and PHPUnit summary logs are supported. Baselines also accept per-test JSON.
Complete Node `--test --test-reporter=tap` streams are supported as runner logs, including
`.tap` files in `baseline/` or `Recorded:` references. They must contain matching plans,
test points and final Node summary counters. Cancelled tests count as failed; SKIP/TODO
count as unexecuted. Nested suites are not counted twice. Truncated, inconsistent or
concatenated streams remain evidence gaps. TAP supplies aggregate execution counts;
per-test identity comparisons still require per-test JSON or JUnit/TRX results.
Conflicting, unreadable, truncated or changed evidence prevents PROVEN even alongside good
evidence. Reads stay inside the workspace; only legacy/SYSTEM may explicitly link to an
external original checkout. Links below evidence/source roots are not followed. The evaluator
caps total reads at 512 MiB, individual XML at 200 MiB/depth 60/two million tests, raw logs
at 16 MiB, module source files at 2 MiB, result discovery at 20,000 files, and systems at
1,000 modules. Incomplete scans are disclosed. Evidence files and scanned directories are
checked again before report publication. Source protection remains a timestamp heuristic.

The three labels mean:

- **NOT PROVEN**: real unapproved regression/difference; a failing required suite;
  no meaningful executed tests; failed/ineffective canary or comparator; fabricated,
  internally inconsistent or unusable essential evidence. Describe missing rather than
  inventing a failure when execution was unavailable, but do not award a pass.
- **PARTLY PROVEN**: some credible passing evidence exists, no known unapproved
  counterexample, but source runtime, fresh inputs, measured
  baseline, P0 traceability, safe normalization or scope/freshness checks
  are incomplete. List every limiting reason, not a softened success summary.
- **PROVEN**: scoped contract tests actually ran and passed (or exact baseline exceptions
  were explicitly accepted); every P0 obligation has passing traceability; real canary and comparator
  self-check succeeded; old/new development and >=10 fresh-input comparisons were actually
  performed with no missing or unapproved differences; uplift-specific checks and source/
  scope/freshness checks have supporting evidence. This is evidence for THIS declared scope,
  not universal equivalence. The evaluator cannot establish who authored the evidence.

Known failures take precedence over partial coverage. Stale evidence does not apply to
changed code. Human open questions/exit criteria remain human-owned; reflect unresolved
ones as limitations. A role instruction and file timestamp cannot establish an OS sandbox
or byte-for-byte source preservation. Use actual available change evidence and disclose
its limits.

Run the proof command to generate both reports, including per-module reasons, P0 traceability,
test/canary/comparison evidence, baseline, deltas, limitations and a BLANK sign-off block.
Record independent review and next repairs separately; do not replace generated fields with
model-written claims. Recompute after changes. Regeneration blanks sign-off for the new
evidence; preserve previously signed reports separately when their history matters.
The JSON has evidence hashes; it has no cryptographic signature or authenticated approval.

PROVEN is not approval to deploy, modify production, waive security review or apply a
patch. A named human separately signs VERIFICATION.md. Repairs happen in the appropriate
build skill, followed by another verification. `$modernize-sign` signs only the brief.
