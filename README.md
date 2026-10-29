# Code Modernization

**English** | [Русский](README.ru.md)

An unofficial adaptation of [Anthropic's Code Modernization](https://github.com/anthropics/claude-plugins-official/tree/main/plugins/code-modernization),
executed through the **official `@openai/codex-sdk`**. It preserves the 13 main commands,
three auxiliary panel names, eight original roles, uplift / transform / reimagine tracks,
core artifacts and human approval gates. Licensed under Apache-2.0; see [NOTICE](NOTICE).
This is not an official Anthropic or OpenAI distribution and is not endorsed by either company.

The current package version is `0.1.0`, as recorded in `package.json`. SDK and artifact
format versions are separate. See [RELEASING.md](docs/RELEASING.md) for packaging.

The SDK is the default executor: separate Codex threads perform tasks, streamed events
record progress, JSON Schema defines response formats, and `resumeThread` continues
unfinished sessions. The current Codex conversation remains the coordinator: it talks
to the user, prepares inputs, starts workflows and combines verified results.

The package uses Node.js without Python, SQLite, an MCP server, a separate model API
client/provider or a background service. Interactive skills in the desktop client can
use a local Node.js UI. Terminal clients, including SSH, use text status and the current
conversation. A small runner implements the original workflow order through public SDK APIs.
A separate deterministic Node proof pack evaluates evidence: tests, P0 tracing, behavior
comparisons, fresh inputs, canary sensitivity and uplift checks.

**Validation:** local tests and reproduction commands are described in
[TESTING.md](docs/TESTING.md). Workflow tests use an SDK double; the proof pack is tested
against real files and a frozen oracle from the original Python implementation.
Installation compatibility is covered in the testing guide; interface behavior is
described in [UI.md](references/UI.md). Unit tests do not establish that the
entire modernization process works with a real model.

For development, see [CONTRIBUTING.md](CONTRIBUTING.md); for distribution packaging,
see [RELEASING.md](docs/RELEASING.md). Third-party licenses and provenance are preserved
in [NOTICE](NOTICE) and [UPSTREAM.md](docs/UPSTREAM.md).

Report vulnerabilities privately through **Security → Advisories → Report a vulnerability**
in the repository that distributed your copy. If the form is unavailable, follow the
[security policy](.github/SECURITY.md).

## Demo without a model

From the plugin directory, create a synthetic workspace and inspect its text status:

```bash
demo_workspace=$(mktemp -d)
node examples/ui-demo.mjs "$demo_workspace"
node scripts/modernize.mjs panel --workspace "$demo_workspace" --system carddemo --interface terminal
```

For the local browser panel, run the last command with `--interface gui` and open the
printed loopback URL. Stop it with `Ctrl+C`. SSH stays in terminal mode. The demo does
not call a model; its results and verdicts are synthetic. Review and approval controls
only modify this temporary workspace.

## Requirements

Node.js **20+** and npm are required to install the pinned `@openai/codex-sdk@0.162.1`,
the `saxes@6.0.0` XML parser and `@stephen-riley/pcre2-wasm@1.2.4` for advanced regex masks.
SDK workflows require a working local Codex installation with authentication.
Local `compare` and `verify` work without login or model calls. The official SDK documents
Node.js 18+; 20+ is this runner's minimum. No TypeScript build or `pip` is needed;
`package-lock.json` makes dependency installation reproducible.

Release packaging also requires `tar` (Linux/macOS).

The SDK launches the pinned Codex CLI from its npm dependency by default; a separate
global binary is not required. `CODEX_PATH` can select another absolute executable path;
compatibility of that override must be checked separately. An SDK in a shared directory
must use the same pinned version. A successful import does not check authentication.

Codex supports ChatGPT or API key login. This plugin does not require a separate key,
copy `auth.json`, read tokens manually or replace Codex authentication. Requests use the
existing local login. **An open ChatGPT window alone does not establish that the local
CLI and authentication are available.** `codex login status` checks login without putting
a key into plugin configuration. Model calls consume the allowance or billing of the
selected Codex login.

Building a project still requires its own stack: Go for `go test`, a JDK for Java, and
so on. An unavailable build remains explicitly unperformed; the SDK does not replace
compilers or a test database.

Requirement sources checked on October 15, 2026:
[SDK README](https://github.com/openai/codex/blob/rust-v0.162.1/sdk/typescript/README.md),
[SDK](https://developers.openai.com/codex/sdk/),
[authentication](https://developers.openai.com/codex/auth/).

## Install SDK and plugin

Clone the repository or extract a release archive into a permanent directory
**outside both the project checkout being modernized and the results workspace**.
It contains `.codex-plugin/plugin.json`, `hooks/hooks.json` and the local
`.agents/plugins/marketplace.json` catalog. Do not mix files from different versions.

### SDK: standard installation

From the plugin directory:

```bash
npm ci --ignore-scripts --bin-links=false
npm run doctor
```

This installs the pinned SDK, XML parser and WASM regex backend. `doctor` checks Node,
SDK import and client construction, **without making a model call or checking login**.
`package-lock.json` contains the actual versions, npm URLs and package integrity values.
`npm ci` reproduces the pinned dependencies without model calls.
`--bin-links=false` is required when installing dependencies inside the plugin directory:
Codex CLI 0.164.0 skips hooks if package fingerprinting encounters the
`node_modules/.bin/codex` symlink. The SDK launches the CLI directly from the pinned
npm package without using that link.

### SDK: shared directory for a read-only plugin cache

If the application copies the plugin into a cache that cannot be written to, install
the SDK in a permanent local directory supported by the runner:

```bash
mkdir -p "$HOME/.codex/code-modernization-sdk"
npm install --prefix "$HOME/.codex/code-modernization-sdk" \
  --save-exact @openai/codex-sdk@0.162.1
```

The runner looks for the SDK beside the package first, then in
`${CODEX_HOME:-~/.codex}/code-modernization-sdk`. Set `CODEX_MODERNIZATION_SDK_DIR`
to use another absolute directory. The path identifies the npm project, not its
`node_modules` directory. You do not need to reinstall the SDK for each run or project.
The example uses the usual `~/.codex`; adjust it for a custom `CODEX_HOME`.

### Local marketplace

Use a Codex CLI with plugin support to register and install the prepared directory:

```bash
codex plugin marketplace add /absolute/path/code-modernization
codex plugin add code-modernization@code-modernization --json
codex plugin list --marketplace code-modernization --json
```

`marketplace add` registers the source; `plugin add` installs the plugin itself.
The installation's `installedPath` points to the executable copy. If it lacks
`node_modules`, run `npm ci --ignore-scripts --bin-links=false` in that copy with the
original `package-lock.json`, then run its `scripts/modernize.mjs doctor`.
The plugin list should show `installed: true` and `enabled: true`.
These commands were checked with the installed Codex CLI 0.162.0-alpha.17.2 on
October 15, 2026. If your CLI lacks `plugin add`, install the plugin from the local
source through the application's plugin directory. Start a new chat to load the skills.

When updating from another version directory, the CLI may report that the marketplace
was already added from another source. Run
`codex plugin marketplace remove code-modernization`, then repeat `marketplace add`
with the new directory and `plugin add` above. This switches only that local source.
Keep the old version directory if you need a rollback copy.

You can also select **Code Modernization** in Codex CLI's `/plugins` or the desktop
application's Plugins Directory. After changing local files, update the installed copy
and start a new session; the application may need a restart. The shared SDK directory
above is needed only when dependencies cannot be installed in the executable copy.

Alternatively, copy the entire package into `~/.codex/plugins/code-modernization/`
and add the entry from [marketplace-personal.json](examples/marketplace-personal.json)
to `~/.agents/plugins/marketplace.json`. Preserve other entries and the existing catalog
name. `source.path` is relative to the marketplace root (`~` for a personal marketplace),
not `.agents/plugins`. Disable the previous installation to avoid duplicate skills.

Attaching a ZIP to an ordinary chat does not install it. Local directory support,
process execution and project access depend on the client and workspace policy.
Documented formats: [packaging](https://developers.openai.com/plugins/build/plugins),
[usage](https://developers.openai.com/codex/plugins/). This distribution is not published
in the official directory and is not automatically installed in your account.

## First use

In a Codex conversation with access to the source and a separate working directory:

```text
$modernize my-service --source "/Users/me/projects/my-service"

Workspace: /Users/me/modernization/my-service
Goal: uplift.
Use this plugin's SDK workflows for assessment and verification.
Start with preflight, inspect the project and prepare a plan.
Do not change the original source. Wait for my approval before implementation.
```

SDK execution is already the default. The coordinator prepares task JSON, chooses the
workflow, runs it through the terminal and reads its result. Users do not need to build
a task graph or approval JSON themselves. If the SDK is unavailable, the coordinator
reports the reason instead of simulating calls or silently switching execution methods.
Package installation requires the permissions of the current environment.

The source and workspace must be separate directories, with neither inside the other.
The candidate lives in `workspace/modernized`; the source is referenced by
`legacy/<system>` or the absolute path in `analysis/<system>/SOURCE`. Human gates remain
explicit user decisions in chat, the local UI and original Markdown documents.
An agent must not invent signatures.

## Commands and roles

```text
$modernize                Coordinate, choose or resume the process
$modernize-preflight      Establish boundaries, environment, goal and source
$modernize-assess         Assess a system or portfolio
$modernize-map            Map components and flows
$modernize-extract-rules  Extract business rules with source citations
$modernize-review         Review rules and record human decisions
$modernize-brief          Plan risks and acceptance criteria
$modernize-uplift         Upgrade within the current stack
$modernize-transform      Migrate to another technology
$modernize-reimagine      Design a new architecture from a specification
$modernize-verify         Verify behavior preservation
$modernize-harden         Review security without automatic patching
$modernize-status         Show process and SDK run status
```

The three panel names remain available: `$modernize-panel`, `$modernize-review-pane`
and `$modernize-sign`. In CLI and SSH they use the terminal: status, rule cards and
approvals appear in the current conversation, without starting a browser or HTTP server.
`node scripts/modernize.mjs panel --workspace DIR --system NAME` prints text status and
exits; `--json` returns JSON. The GUI provides an HTML panel; explicitly starting its
server uses `--interface gui`. An unknown host selects the terminal; SSH and CI remain
in terminal mode even with GUI configuration.

The browser interface provides a live module map, stages, proof chips, phases, the next
command, review cards with notes and source, a brief approval dialog, a full report,
topology and an SDK task fleet. Brief approval requires an explicit human action;
it does not sign VERIFICATION.

Updates arrive through an event stream, and reconnection restores the current state.
Notes, focus and expanded sections survive updates. Report and topology refreshes preserve
the reading position, and a version can be frozen for reading. Fleet shows queue state,
duration, command/change events, runner health and budgets. Controls support pausing after
active tasks, resuming, stopping and retrying failed tasks. Resuming a saved SDK run
requires confirmation; repeated writes require inspecting partial changes and renewed consent.

```bash
node scripts/modernize.mjs panel --workspace /absolute/workspace --system billing
node scripts/modernize.mjs report --workspace /absolute/workspace --system billing
```

Codex must trust new hooks on first use; installation alone does not grant that trust.
In the GUI, trusted hooks register the system, start a panel owned by the session and
open a browser. `auto|command|off` panel modes and X-ray preferences are saved in the
workspace. If hooks are unavailable in the GUI, the skill starts a foreground panel with
`--interface gui` and opens the printed URL. CLI uses text status without a browser fallback.
In Codex, the same URL can be shown beside the chat. The process listens only on
`127.0.0.1`. X-ray observes supported parent and SDK reads; the UI sees tests and command
errors. Queue-next and pause controls act through the next hook without permission to run
arbitrary commands. These hooks do not provide native prompt insertion or an immediate
model interrupt. See [UI.md](references/UI.md).

The package uses the compatible `.codex-plugin` layout: CLI 0.162.1 ignores hooks if a
portable `plugin.json` exists at the root. The portable example is preserved in `examples`;
do not copy it into this installation's root.

All eight roles are preserved: `legacy-analyst`, `business-rules-extractor`,
`architecture-critic`, `security-auditor`, `test-engineer`, `version-delta-analyst`,
`uplift-migrator` and `scaffolder`. Their Markdown instructions are passed to dedicated
SDK threads. Separate contexts do not imply different models or statistically independent experts.

## SDK workflows

**Six original workflows have executable JavaScript implementations.** `extract-rules`
extracts rules in batches or thematic passes, checks citations and sends P0 rules to two
additional reviewers. `uplift-deltas` analyzes four categories of changes and checks
identified source sites. `harden-scan` runs five analysis lenses plus High/Critical
follow-ups. `portfolio-assess` inspects explicitly listed systems.

`uplift-migrate` handles units whose dependencies are ready, bounds concurrency and stops
further batches when too few measured builds succeed. `reimagine-scaffold` creates agreed
service scaffolds in non-overlapping directories. A scaffold is not declared a working system.

Other original role actions use the technical `role-task` adapter: assessment, test design,
architecture criticism, a pilot, approved implementation and independent evaluation.
This adds no business stage. Shared project files, human gates and final reports remain
the coordinator's responsibility.

The implementation uses `startThread`, `resumeThread`, `runStreamed`, JSON Schema
`outputSchema`, `AbortSignal` cancellation, command/file-change/usage events, local images,
per-role model and reasoning settings, cwd, sandbox, network and web search options.
Network and web search are disabled by default. To check current versions, the coordinator
must explicitly choose an available, permitted source of primary evidence. Model IDs are
not guessed; Codex configuration applies by default.

## Progress and resumption

The original Markdown/JSON files hold the main results. Additional execution state:

```text
workspace/
├── legacy/<system>                  # do not edit the source
├── analysis/
│   ├── .codex-sdk/coordinator.lock  # one coordinator per workspace
│   └── <system>/
│       ├── MODERNIZATION_BRIEF.md
│       ├── BUSINESS_RULES.md
│       ├── VERIFICATION.md
│       └── .codex-sdk/runs/<id>/
│           ├── request.json
│           ├── state.json
│           ├── result.json
│           ├── <task>.result.json  # response and evidence
│           └── <task>.events.jsonl # event stream
└── modernized/<candidate>/
```

There is no database. Saved thread IDs let the SDK continue unfinished tasks. Completed
results are reused only when checked inputs match; changes to source, context, role
settings or executor code require a new run. This is not a Claude Workflow journal or an
exactly-once guarantee. State files and Codex sessions contain sensitive project information;
do not publish them with the repository.

Usually `$modernize-status` or `$modernize` with the same workspace/system is enough.
Diagnostic commands:

```bash
node scripts/modernize.mjs status --workspace /absolute/workspace --system my-service
node scripts/modernize.mjs resume --workspace /absolute/workspace \
  --system my-service --run-id SAVED_RUN_ID
```

After a crash, verify that previous processes have stopped and inspect partial changes
before using `--confirm-stopped`. A writing workflow also needs a new `--allow-writes`.
There is no automatic retry of unfinished writes or recovery based on an expired lease.

## Limitations and security

Read-only and workspace-write are SDK parameters, not merely role instructions. They
request local Codex/OS policy; they are not a separate plugin sandbox. Host compatibility
and actual isolation are not established here. Writing SDK tasks receive separate candidate
subdirectories; the coordinator owns shared manifests and lockfiles. Do not broaden access
to full permissions just to pass tests. Place build caches in permitted directories.

Token counters limit **starting new tasks**, not the total bill. Concurrent unfinished
requests and errors without usage can exceed the launch budget. Cancellation signals
reach the SDK; check child processes after a forced OS termination.

Structured output establishes response shape, not truth. Migration builds and required
tests need matching SDK completion events with exit codes; command meaning, test counts
and coverage are checked separately. Failing or missing tests stop further batches;
an exception requires a recorded human decision for that unit. A successful SDK run does
not mean `PROVEN`. The Node proof pack (`codex-node-proof-pack`) computes the final verdict
from real reports, logs and program outputs. A model conclusion cannot replace this evidence.

Details: [SDK execution](references/SDK.md), [security](references/SECURITY.md),
[verification](references/VERIFICATION.md), [source and adaptation](docs/UPSTREAM.md).

## Mechanical observation comparison

After actually running old/new programs, use the saved `cases.json`:

```bash
node scripts/modernize.mjs compare \
  --cases /absolute/workspace/analysis/my-service/equivalence/cases.json
```

This command works without the SDK or a model. It writes `EQUIVALENCE.json` beside
`cases.json` and checks bytes, justified byte masks, exact decimal tolerances, path
boundaries and comparator mutation sensitivity. Exit 0 means these observations compare
successfully, 1 means a difference or gap, and 2 means invalid input. Approved differences
are preserved as `differs-approved`.
It supports a compatible subset of Python regex masks with Latin-1/byte semantics and
time limits. Unsupported constructs produce an explicit `missing` reason; compatibility
boundaries are listed in [VERIFICATION.md](references/VERIFICATION.md). The command does
not execute the project or issue the final behavior-preservation verdict.

## Final evidence evaluation

After actual test runs, canary checks and old/new comparisons:

```bash
node scripts/proof-pack.mjs my-service --workspace /absolute/workspace
# Equivalent main CLI command:
node scripts/modernize.mjs verify --workspace /absolute/workspace --system my-service
```

This writes `analysis/my-service/VERIFICATION.json` and `VERIFICATION.md` with per-module
verdicts, reasons, evidence, SHA-256 hashes of read files and empty human sign-off.
Exit 0 means `PROVEN`, 1 means `PARTLY PROVEN` / `NOT PROVEN`, and 2 means invalid input.
The engine compares bytes again, reads JUnit/TRX and runner logs, checks P0 rules, at least
10 fresh input groups and canary sensitivity. Uplift additionally checks a measured
baseline, test-file preservation and references to silent deltas.

The module argument preserves upstream semantics: every built module is evaluated again;
an uplift unit name narrows its suites. Directories containing only test tooling are
reported separately. The engine does not execute evidence commands or repair the project.
The full input contract and mechanical limits are in [VERIFICATION.md](references/VERIFICATION.md).

## Package checks

After installing dependencies, local checks run without model calls:

```bash
npm test
npm run test:proof
npm run check
```

A separate **optional live SDK check** is available after installation and login:

```bash
npm run smoke:sdk -- --confirm-live
```

It makes two short model calls: creates a session and resumes it by ID, checking structured
output and retained context. It consumes the selected login's allowance. Without
`--confirm-live`, no calls are made. It does not replace testing all workflows on your
project. See [TESTING.md](docs/TESTING.md) for check scope and limitations.
