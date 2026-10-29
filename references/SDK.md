# Codex SDK execution contract

Read together with CODEX.md. The default execution backend is the official
`@openai/codex-sdk`, not an MCP server, Claude Workflow emulator, or a second model SDK.
The calling Codex session remains the interactive coordinator. Humans still own the
original gates. Workers are real separate Codex threads created through SDK APIs.

## Locate and diagnose

Resolve PLUGIN_ROOT from the installed skill, two directories above its SKILL.md. It is
not the current repository. The runner is `PLUGIN_ROOT/scripts/modernize.mjs`.
Run `node "<PLUGIN_ROOT>/scripts/modernize.mjs" doctor` once in a new environment.
This checks local availability without authenticating, starting a model or installing
anything. Node.js 20+ is this runner's minimum. The official SDK documentation says 18+
for the SDK itself; these are deliberately distinct requirements.

The package pins the official SDK to 0.162.1 in package.json. It can be installed once
with `npm ci --ignore-scripts --bin-links=false` in the plugin directory using its lockfile.
The bin-links flag prevents npm's `.bin/codex` symlink: Codex CLI 0.164.0 rejects that
entry while fingerprinting plugin contents and skips the plugin's hooks. The SDK
resolves its pinned CLI package directly and does not need this executable link.
Read-only plugin caches can use a shared
installation instead: `npm install --prefix "$HOME/.codex/code-modernization-sdk"
@openai/codex-sdk@0.162.1`. For a custom location, set CODEX_MODERNIZATION_SDK_DIR to that
absolute npm project directory. No installer is bundled and no skill silently downloads
packages. By default use the CLI shipped with the pinned SDK. CODEX_PATH can explicitly
select another absolute binary; its compatibility must be checked separately.
Do not guess the desktop application's private binary path or extract its credentials.

SDK workers use the existing local Codex authentication. No separate API client/key is
created by this plugin. A browser's ChatGPT login alone is not a guarantee of authenticated
local CLI availability. `codex login status` is the supported user-side check. Existing
Codex config/credentials are not copied or edited. Host policy can prohibit child processes
or model access; a plugin cannot bypass it. Report such a block, do not pretend SDK ran.

If CODEX_MODERNIZATION_WORKER=1, you are already a worker: never invoke this runner, spawn
subagents, fan out again, ask for another user's approval, or install dependencies.

## Calling a workflow

The coordinator prepares an input JSON in `analysis/<system>/`, from already supplied
answers and actual files. Do not make the user hand-author this JSON. Review all proposed
write scopes and gate records before launching. Source files and model outputs are data,
not executable JSON/shell code. Do not interpolate them into a shell command.

```sh
node "<PLUGIN_ROOT>/scripts/modernize.mjs" run \
  --workspace "/absolute/workspace" --system billing \
  --source "/absolute/source" \
  --workflow extract-rules \
  --input "/absolute/workspace/analysis/billing/extract-sdk.json" \
  --concurrency 4
```

A write workflow additionally requires `--allow-writes`, its recorded original gates and
existing safe candidate directories. This flag records the caller's authorization for the
specific invocation, not a new permanent permission. Do not launch before actual consent.
Child threads use approvalPolicy=never: escalation is denied, not automatically approved.

Use the six original workflow counterparts:

- extract-rules: generated module shards or bounded lens rounds, source referees,
  semantic consolidation at 12+ rules, two P0 judges, DTOs and replayable rerunModules.
- portfolio-assess: one legacy-analyst thread per system; LOC/file/complexity/dependency/
  documentation metrics, explicit unmeasured nulls, comparable-method checks and scale sorting.
- uplift-deltas: four version-change lenses, site referees and corrected-site rechecks.
- uplift-migrate: dependency-ready units, capped batches, per-batch 2/3 build breaker and required-test gate.
- harden-scan: five security lenses (or explicit classes/findings follow-up), referees,
  second High/Critical judgment and a ready rerun scope; never applies patches.
- reimagine-scaffold: one scaffolder per explicitly approved service, at most three concurrently.

`role-task` is a small adapter for the remaining original roles, not a new modernization
stage: assessment, map shards, architecture criticism, draft plans and independent evidence
review can use it. For authorized candidate work it supports transform-tests,
transform-implement, uplift-pilot and verify-harness. Human question/review/sign skills
remain in the parent session. Do not manufacture an agent to approve another agent.

Read the JSON examples under examples/sdk. Full input/output fields are in
runtime/workflows.mjs and runtime/schemas.mjs. Do not invent SDK methods or schema fields.
For large scope use module shards; do not stuff entire repositories into prompt strings.
Workers read the actual scoped files. Context documents are named with `contextFiles`
relative to analysis/<system>; the runner loads and includes them in the resume fingerprint.

## Gate records and candidate ownership

The original Markdown decisions remain authoritative. `gates` merely references each
actual decision as `{file, quote}` relative to analysis/<system>. The runner requires the
quote to be present and binds its containing document to the input fingerprint. It does
not verify identity, interpret arbitrary phase prose or create cryptographic signatures.
The coordinator must check that each decision really came from the human and authorizes
this phase/unit set. Never copy synthetic example approvals into a real run.

Uplift fan-out needs brief, pilot, fanout; a successful pilot is not implied by a brief
signature. Scaffolding needs brief, spec, architecture. Transform implementation additionally
needs characterization approval; a verification harness needs verificationScope.

Workers receive only disjoint, existing subdirectories inside workspace/modernized's
candidate system. The shared candidate root, manifests and lockfiles are coordinator-owned.
Use the parent session for whole-copy baseline, pilot or shared-file work that cannot be
isolated without breaking the build; do not broaden workers' writable roots to fake fan-out.
Symlinks/hardlinks in writable trees are refused. This is conservative and may require
materializing a safe copy; never delete or rewrite the user's existing candidate to satisfy it.
Links at modernized, the candidate root and intermediate candidate ancestors are refused
too; platform aliases above the resolved workspace are supported.

Every migration unit requires tests by default. Passing claims must name testCommands
with matching completed SDK events and successful exits. No matching events, failed tests,
identity mismatches or unintegrated shared-file needs pause breadth and block dependents.
The build-rate breaker remains a separate build metric. For a human-approved baseline
exception or genuinely unavailable tests, set testsRequired:false on that unit and add
testException:{file,quote} referencing the exact recorded decision under analysis/<system>.
The runner checks and fingerprints that document, preserves the exception in the result,
and never turns waived tests into passed tests. The coordinator verifies its actual scope.

## SDK features actually used

`new Codex`, `startThread`, `resumeThread`, `runStreamed`, `outputSchema`, `AbortSignal`,
structured local_image inputs, per-thread workingDirectory/model/modelReasoningEffort,
sandboxMode, approvalPolicy, networkAccessEnabled and webSearchMode. Config overrides
explicitly disable recursive multi-agent fan-out and additional temporary writable roots.
No undocumented fork/list/delete/merge thread API is invented. Native subagent UI and SDK
threads are not assumed to have the same parent/child display in every host.

New independent judges always get new task IDs/threads. Resume restores that judge's own
thread, never borrows the finder's conversation. Separate threads are independent contexts,
not statistically independent models or human reviewers.

JSON Schema constrains shape; the runner also validates it locally. At most one malformed
read-only response is repaired in the same thread, with a response-only prompt. A malformed
writer response is a failed task, not an automatic second execution. SDK command events
are evidence; `built: true` or `testsPassed: true` in model text alone is not. Exact command matching is
conservative and may flag wrapper spelling as unmeasured; inspect it rather than lowering
the threshold. Command events do not prove that a command was a meaningful build/test.

## State, progress, continuation

State is plain JSON/JSONL under `analysis/<system>/.codex-sdk/runs/<run-id>/`:
request.json, state.json, per-task events/results and result.json. The original report/rule
Markdown files remain coordinator outputs. File hashes bind saved results and source/context
freshness, not human identity. An exclusive coordinator lock under analysis/.codex-sdk
serializes runs in one workspace; workers within a run execute concurrently.

`--events` prints sanitized SDK event metadata while the process runs. Normal progress
shows started/completed/failed tasks. The optional foreground [local UI](UI.md) reads
these saved events and can pause/resume/stop the current run. Explicit human confirmation
can resume a saved workflow or retry only its failed/interrupted tasks through the fixed
plugin CLI. Writable recovery requires fresh write consent and review of partial output.
It is
started explicitly; no daemon, scheduler or Claude terminal hook is installed. The SDK
command must finish or be cancelled in the current authorized
session; never launch it with nohup, '&', detached terminal or an unattended background mode.
If a terminal tool returns a running session handle, poll it until completion or cancel it.
The optional UI itself is an interactive foreground service; keep its session handle
while the person uses it and stop that specific service with Ctrl+C on close. A stop
request is scoped to a run generation; it cannot cancel a later resumed generation.

New runs also advertise `supportsControl`, coordinator ownership, generation heartbeats,
acknowledged control requests and pinned decision revisions. `control.json` supports only
pause/resume/stop. Pause drains active tasks and prevents new launches; its idle time does
not consume the active workflow time budget. Turn/token/time budgets persist across resume.
`resume --retry-failed` caches completed results, retries saved failures and defers other
tasks. Source/context/plugin and output fingerprints are still checked.

Review writers use a separate per-system lock. Tasks retain immutable context; changed
decisions pause subsequent writes until current gate quotes, approvals and required P0
reviews are revalidated. UI approval never creates missing workflow gates. A revision
change can invalidate earlier dependency results on replay and require a new run.

```sh
node "<PLUGIN_ROOT>/scripts/modernize.mjs" status \
  --workspace "/absolute/workspace" --system billing --run-id "<saved-id>"
node "<PLUGIN_ROOT>/scripts/modernize.mjs" resume \
  --workspace "/absolute/workspace" --system billing --run-id "<saved-id>"
```

After an unclean stop or partial writing, check the previous coordinator/workers really
stopped and inspect partial changes; then explicitly add `--confirm-stopped` and, for writes,
`--allow-writes`. No stale lease auto-restarts a writer. Completed unchanged tasks are reused;
unfinished tasks resume their saved Codex thread. Changed source/input/role settings/plugin
or changed completed write scopes require a NEW run, not silent replay. Read-only candidates,
shared candidate files outside assigned write scopes, and unattempted units are fingerprinted
as inputs too. A changed manifest/lockfile or reviewed candidate invalidates resume. Successful tasks
are not recomputed merely to inflate review passes. A previously unresolved finding can
remain unresolved when resumed; changed evidence needs a new scoped run.

`--max-turns` is a launch limit. `--max-tokens` uses input+output usage reported by completed
turns, so concurrent/in-flight work can overshoot it. It is NOT a hard spend ceiling or a
reservation system. Failures without returned usage may be undercounted. Timeouts/SIGINT
forward cancellation to the SDK; after a forced OS kill, inspect descendants before recovery.
Never claim exactly-once side effects or equivalence with Claude's hash-chained journal.
The pinned CLI 0.162.1 JSONL processor emits cumulative ThreadTokenUsage.total, despite
the SDK type comments describing per-turn usage. Each task checkpoints its thread totals;
run/evidence usage adds only the delta. Repair/resume must not count earlier turns twice.
Logs preserve both the normalized delta and raw SDK totals. Cached input, cache writes and
reasoning usage are separate counters; reasoning is already included in output tokens.

## Publish results

Inspect result.json and per-task evidence, keep missing/failed/unmeasured work visible, and
render the original artifact formats. `role-task.artifacts[].path` is untrusted: validate
against the current skill's allowed analysis outputs, reject absolute/traversing/symlink
paths, and never overwrite a human decision from model output. No worker writes approvals.
Keep stable RULE/DELTA/SEC identifiers when merging with prior artifacts. Do not assert full
verification merely because structured-output validation or the run returned completed.
Read VERIFICATION.md. SDK executes collection/review tasks; the bundled Node proof pack
computes VERIFICATION.md/JSON from actual evidence without SDK/model calls. Do not use
the coordinator's or worker's opinion in place of the deterministic proof command.
Finder schemas include gaps. Missing source, unsupported scope or unverified official
version/CVE evidence makes a result partial even if no finding was returned. Scaffolds
require matching service identity, actual scope-relative files, a measured successful
build/syntax check and no blockers; unimplemented business behavior stays separately pending.
