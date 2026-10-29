# Inputs for the coordinator

**English** | [Русский](README.ru.md)

These JSON files demonstrate the runner contract; they are not ready-made inputs for an
arbitrary repository. The coordinator must prepare inputs from the actual workspace and
current user decisions. Users normally invoke `$modernize` and do not need to write JSON.

After validating the input, run from the installed plugin root:

```bash
node scripts/modernize.mjs run --workspace /absolute/workspace --system my-service \
  --source /absolute/source --workflow extract-rules --input /absolute/prepared-input.json
```

`candidate` is relative to the workspace. `contextFiles`, `gate.file` and `evidenceFile`
are relative to `analysis/<system>`. `modules.files` paths are relative to the source.
Unit/service `path` values are relative to the candidate and must identify existing,
non-overlapping subdirectories created by the coordinator in a safe copy. Portfolio
`system.source` paths are absolute or relative to the workspace.

Every `REPLACE_...` value is a placeholder, not a claim about a version, file or approval.
Never copy quote placeholders into human documents to bypass validation. Use only genuine
human decisions for the current phase. Writing runs additionally need `--allow-writes`;
that flag does not replace the original human gates.

`extract-rules-lenses.json` runs bounded thematic passes, not complete AST analysis.
Preserve indications of incomplete coverage. `role-task.json` performs read-only analysis.
`role-task-transform-tests.json` demonstrates bounded characterization-test writes.
Pass `role-profiles.json` through `--roles`, not as workflow input. If needed, add `model`
using an ID actually available to you. Effort settings must be supported by the selected
model; the adapter does not establish that support in advance.

For an independent evaluation, use `independent: true` and a new task/thread. This does
not automatically select a different model. Local images can be passed through `images`
with paths inside permitted source/analysis/candidate trees, without URLs or downloads.

For the full contract, limitations and recovery, see [SDK.md](../../references/SDK.md).
