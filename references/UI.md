# Local modernization interface

The Node UI adapts the original progress pane, rule deck and brief dialog to a browser.
It reads existing artifacts, starts through trusted Codex hooks or an explicit foreground terminal and binds
only to `127.0.0.1`. Browsing and decisions make no model calls. Explicit Resume/Retry
can start the saved SDK workflow after confirmation. No additional dependency,
build step, Python or database is required.

## Open and inspect

In CLI and SSH, all work stays in the terminal: status, rule cards, human approvals,
SDK progress and errors. `panel` prints a status snapshot and exits without a server.
`$modernize-review-pane` and `$modernize-sign` use the current conversation. No browser,
DISPLAY, local HTTP listener or SSH port forwarding is required. JSON snapshots and
saved HTML reports remain optional output formats and never open a browser themselves.
For a local GUI panel, pass `--interface gui` explicitly when starting the foreground
server. Hooks default unknown hosts to terminal; Desktop without terminal markers can
use GUI. CODEX_MODERNIZATION_INTERFACE=terminal|gui can select the host presentation;
SSH, CI and SDK-worker environments always stay terminal, including with a GUI override.

From the installed plugin directory, with semantic arguments safely shell-quoted:

```sh
node scripts/modernize.mjs init --workspace /absolute/workspace --system billing --source /absolute/source
node scripts/modernize.mjs panel --workspace /absolute/workspace --system billing
node scripts/modernize.mjs panel --workspace /absolute/workspace --system billing --view review --interface gui
node scripts/modernize.mjs panel --workspace /absolute/workspace --system billing --json
node scripts/modernize.mjs report --workspace /absolute/workspace --system billing
```

In GUI mode, Codex SessionStart/UserPromptSubmit/PostToolUse hooks register the selected system before
opening a panel, reuse a live receipt and open the default browser. The successful init
command also binds a chat to the selected workspace. The coordinator can open the same
URL in an in-app browser. Codex must first review/trust the installed hook definition;
installation alone does not grant that trust. Untrusted/unavailable hooks use the
foreground skill fallback in [CODEX.md](CODEX.md). SDK workers, CI/headless and JSON-only
CLI calls never start a panel. Terminal mode never starts one, including for an explicit
`$modernize-panel ... open` invocation. No model call is made by hook or panel startup.

Persistent workspace settings: `config --workspace DIR --panel auto|command|off`
and `--xray on|off`. The panel header changes the same MODERNIZATION_UI.json.
`system`, `track`, `commandPrefix` and `legacyDir` are also configurable; telemetry stays
disabled. Explicit modernize invocation flags `--panel off --xray off` are applied before
opening anything. Off/command affects startup; an already open page remains usable.

Open the **complete session URL** printed by panel in the host browser view. In Codex,
`open_in_codex` can show it beside chat. Keep the foreground terminal session handle and
reuse an existing panel created here. Do not use nohup, a detached shell or a scheduler.
The hook-owned sidecar is the sole lifecycle-managed background mode: its private receipt
is under PLUGIN_DATA, SessionEnd closes it and a 30-minute idle lease expires unused
instances. Ctrl+C stops a manual foreground panel; closing the page hides it and does not stop SDK work. If a sandbox
refuses the loopback socket, use the host's normal approval mechanism or the offline
report/JSON snapshot. Never claim a live view opened when the server could not start.
Verify the selected system and live connection in the opened page. If opening was only
queued, report that state and use an available host browser tool to show it.

When the panel started a resumed CLI, a terminal interrupt can also signal that child.
Keep the foreground session while its work should continue; browser-page closure alone
does not interrupt it. Use the run's Stop control when cancellation is intended.

Options: `--interface terminal|gui` (terminal unless a GUI host is identified),
`--port 0..65535` (default 0 selects a free port in GUI mode),
`--track auto|transform|uplift|reimagine`,
`--view progress|review|report|topology|fleet`. Without a system it follows the first under
analysis/ or legacy/ and permits switching. An unknown explicit system fails. `--json`
exits immediately. Neither snapshot/report nor the UI requires SDK authentication.
`--scope flagged|p0|all --filter "text"` preselects the deck scope and source/title/id filter.
The page preserves its selected system, track and review filter when reloaded.

## Views and decisions

- Live panel: original stages, treemap grouped by domain/directory, source-size progress,
  phases, module proof chips, next command, attention and SDK activity. Authenticated
  SSE pushes changes; watchers invalidate shared snapshots with a 35 ms debounce.
  A 10-second reconciliation catches missed file notifications. Progress is not proof
  or release readiness.
- Rule review: original flagged/P0/all order, text filter, one card, Given/When/Then,
  defect, confidence, note and source. Keys 1/2/3 decide, 4 back, 5 skip, 6 source,
  7 retract, 0 close. Shortcuts apply inside this page, outside fields and dialogs.
  Notes survive updates, navigation, reconnects and same-tab reloads in sessionStorage,
  scoped to the workspace. Changed card/review revisions preserve the draft but require
  reading and explicitly accepting the current revision before saving it.
- Sign: a person reads the displayed revision, enters their actual name/role, selects
  Phase 1 only or Full plan and explicitly approves. The original approval block changes;
  a revised approval retains its predecessor in the revision receipt. This does not sign
  verification or waive open criteria, pilot acceptance or later checkpoints.
- Report: original HTML renderer, search, themes, artifact inventory, rules, build notes,
  comparison case tables, detailed six/nine checks and offline Mermaid. Download is an
  offline snapshot. The report CLI writes `analysis/<system>/REPORT.html`. New versions
  preserve search, section, theme, expanded details and scroll. Freeze version suspends
  replacement and shows when a newer version is available.
- Topology: offline explorer, search, flows, dependency toggles and node details.
  Live refresh retains search, selected node/flow, pan/zoom, toggles and scroll.
- Fleet: saved SDK tasks/runs, queue, observed token/turn/time budgets, command starts,
  file changes, durations, errors and a filterable last-200-event timeline. Follow latest
  stops scrolling when a person reads older events. Output appears only when explicitly
  recorded by the runner, redacted and limited to the last 4,000 characters per event.

The agent must not choose real verdicts or click Sign without the person's explicit
decision for that card or brief revision. Opening the UI is not consent to decisions.

Review writes read-merge original RULE_REVIEWS.json v1 and regenerate its Markdown mirror.
Displayed card/review hashes reject stale writes. UI_REVIEW_CONTEXT.json remembers card
revisions; changed cards need renewed review. UI_APPROVAL_CONTEXT.json binds UI approval
to the brief revision and retains superseded approvals. Native writers should update
these contexts after equivalent new human decisions. A preexisting approval without a
receipt is read from the brief; the UI cannot reconstruct its history.

These files are freshness/audit metadata. The original review ledger and brief remain
authoritative. Files are replaced atomically individually, not as a multi-file filesystem
transaction. A separate `analysis/<system>/.review.lock` serializes human decisions
without blocking on SDK work. The workspace coordinator lock still serializes runners.

## Live connection and execution controls

The stream uses `fetch` with the existing authentication header; the token never moves
to a query string. Event IDs and base revisions prevent out-of-order patches. Reconnect
replays bounded history or sends a complete snapshot. Slow clients have a bounded queue
and reconnect rather than retaining unbounded buffers. A failed stream falls back to
snapshots while reconnecting. Old requests are aborted/ignored when changing systems.

Server heartbeats arrive every two seconds. Runner heartbeats are separate generation
receipts: the page distinguishes connected, stale, unknown and dead runners. A persisted
`running` status alone is not a liveness claim. File watchers are advisory, especially on
network/mounted filesystems; reconciliation remains necessary.

- **Pause after active tasks** drains already launched tasks and stops new task launches.
  The state moves through pausing to paused; the remaining known queue stays visible.
- **Resume run** releases that queue. **Stop run** requests SDK cancellation, wakes a
  paused queue and shows requested/stopping/stopped separately. Controls target one
  generation and are acknowledged by the runner.
- **Resume saved run** uses only the saved fixed workflow through the plugin's CLI.
  Confirm that former workers stopped; writable runs also require review of partial
  candidate changes and renewed write consent. No arbitrary shell-command route exists.
- **Retry failed tasks** adds `resume --retry-failed`: successful results remain cached,
  only saved failed/interrupted tasks may launch, and never-started tasks are deferred.
  A later normal Resume continues them. Changed task inputs or outputs require a new run.

Recorded turn/token budgets carry over. Active-time budget excludes a drained pause;
observed token usage is not a hard cap on an already running concurrent turn or a price.
Model calls made by explicit Resume/Retry use the normal Codex limits/billing.

Each write task has an immutable decision/context revision. If reviews, rules, brief or
other approved context change, active tasks retain their original context and subsequent
writes pause. The Resume dialog identifies changed files and revision. The runner checks
gate quotes, current UI approval receipts and required P0 confirmations before accepting
the revision. Removed gates, stale approvals and disputed P0s keep it paused. A changed
context can invalidate earlier cached task inputs on a later replay; start a new workflow
when the old dependency results no longer match. UI approval never supplies missing gates.

Journal reads use byte offsets, support rotation and partial UTF-8 lines, and tail large
files without reading them whole. Limits: 30 recent runs, 500 task summaries per run,
200 log tails/8 MiB new log bytes per snapshot, 400 retained lines per log, 200 displayed
events, and 16 MiB shared journal cache. The page labels a bounded activity view. Complete
evidence stays in run files. Reports/source previews do not scan SDK journals.

Run `node scripts/benchmark-ui.mjs` to reproduce the synthetic 1,000-module/>8 MiB-journal
transport benchmark. It measures file append to HTTP delivery, not browser paint or a
real migration. Authenticated `/api/diagnostics` reports builds, cache hits and watcher
errors without source contents or session tokens.

## Host and file boundaries

The package installs public Codex lifecycle hooks, not Claude terminal function hooks.
PostToolUse observes supported literal cat/head/tail/sed/rg reads and explicit file-read
tools; it adds source-linked X-ray context to parent and SDK workers. Unrecognised reads
are unknown. SDK workers do not start panels, consume human requests or duplicate command
events. Parent test outputs and SDK computed test totals feed observed module counts;
they are display evidence, not a proof verdict. Recovered command failures still feed
Fleet's adaptive threshold/escalation logic.

The browser cannot dock above the host prompt, edit its draft or interrupt an in-flight
model request. Copy command remains available. With active coordinator hooks, Queue next
step delivers the suggested command as context at the next supported hook. Pause denies
the next supported tool and stops at the Stop hook; it is labelled accordingly. Neither
control silently approves a brief or executes an arbitrary browser-supplied command.
The page retains its hide/show bar; these are browser controls, not native terminal docking.

A random capability is carried in the session URL fragment, removed from the address bar
and kept in sessionStorage. API calls authenticate with a header. Do not publish this URL.
APIs reject foreign Host/Origin and cross-site requests; decisions require the exact local
Origin. No CORS, arbitrary command route, uploads or remote assets. Only fixed UI assets
are served. Report/topology frames are sandboxed. Offline reports pin scripts by SHA-256.

Reads are bounded, exclude secret files and redact text. Only the explicit legacy/system
entry may be a source link. Descendant links and links under analysis/modernized are
refused. Source snippets have at most 200 lines. Redaction is heuristic: keep confidential
content out of artifacts intended for sharing.

## Synthetic demonstration

```sh
node examples/ui-demo.mjs /absolute/empty-demo-directory
node scripts/modernize.mjs panel --workspace /absolute/empty-demo-directory --system carddemo
```

The generator refuses a nonempty directory. All demo facts are synthetic and labeled.
Testing its controls does not approve any real modernization.
