# Proof-pack oracle corpus

`proof-pack-upstream.json.gz` contains 260 frozen workspace/evaluator pairs and 17
runner-log examples from Anthropic Code Modernization, Apache-2.0, commit
`c8874f5ad883e26428f483ffa4d537cc81489e64`.

Inputs and expected decisions were captured on 2026-10-15 from `proof_pack.build`
while running these upstream test classes with the original sibling scripts:

- `test_proof_tools.ProofVerdicts`, `ProofUplift`;
- `test_proof_rules_run.RulesNeedExecutedTests`, `TestOnlyFolders`, `HostileInput`.

The selected original suite ran 101 tests with zero failures/errors. Some tests call
the evaluator repeatedly. Only bounded, self-contained filesystem snapshots were saved:
external symlink targets and files over 64 KiB were omitted from this portable corpus.
The metadata lists those omissions. Separate Node tests exercise external source links,
unsafe evidence/output links, XML limits and concurrent evidence changes.

Each snapshot holds relative paths, base64 bytes, modification times and expected
mechanical outcomes. Temporary root strings become `{{WORKSPACE}}` during capture and
are restored into an isolated directory on replay. The tests need Node only, without
Python, an SDK session or the upstream checkout. Gzip has a fixed timestamp header.

Assertions compare module/overall verdicts, all check states, test counts, P0 statuses,
fresh-input counts, baseline differences/evidence, test-file changes, delta coverage
and tooling exclusions. Human-readable wording and extra provenance fields are not
compared. Two deliberate differences are documented in the replay test: deterministic
ordering of capped source examples and a completeness gap for an out-of-workspace
canary path. Neither weakens an upstream decision.

Source files:
[test_proof_tools.py](https://github.com/anthropics/claude-plugins-official/blob/c8874f5ad883e26428f483ffa4d537cc81489e64/plugins/code-modernization/scripts/tests/test_proof_tools.py),
[test_proof_rules_run.py](https://github.com/anthropics/claude-plugins-official/blob/c8874f5ad883e26428f483ffa4d537cc81489e64/plugins/code-modernization/scripts/tests/test_proof_rules_run.py).
See [NOTICE](../../NOTICE) for attribution and modifications.
