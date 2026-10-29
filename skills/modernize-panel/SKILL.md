---
name: modernize-panel
description: "Show terminal modernization status in CLI/SSH, open the live panel in GUI, or emit a JSON snapshot."
metadata:
  argument-hint: "<system> [open|close|json]"
  upstream-source: "hooks/README.md (modernize-panel command)"
---

# modernize-panel

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `hooks/README.md (modernize-panel command)`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-panel <system> [open|close|json]`. Arguments are semantic values, not shell interpolation.

In CLI/SSH use the terminal interface: run `panel --workspace DIR --system NAME
--interface terminal` and present its status in this conversation. `open` means show
status here; never start an HTTP server or open a browser. Rule review uses
`$modernize-review`; brief approvals use `$modernize-sign` in the terminal conversation.
`close` ends this status interaction. `json` remains the read-only snapshot below.
If the host type is uncertain, choose terminal. The following browser procedure is
only for a GUI host, using `--interface gui` for an explicit foreground panel.

Follow [UI.md](../../references/UI.md). This browser adaptation uses the original progress
readers and treemap layout. Resolve the authorized workspace/system before starting it.

- `open` (default): reuse the URL supplied by trusted lifecycle hooks. Otherwise run
  `node <PLUGIN_ROOT>/scripts/modernize.mjs init --workspace DIR --system NAME --source SOURCE`
  before `panel --workspace DIR --system NAME --interface gui`, and retain that foreground terminal.
  Open the complete session URL in a host browser, beside chat when supported.
- `json`: run panel with `--json`; present the actual disk snapshot and gaps. Do not
  initialize output directories, start a server or change preferences for this read-only request.
- `close`: close this interaction's browser view. If no panel-owned resumed workflow is
  active, stop its known panel terminal with Ctrl+C. A terminal interrupt may also reach
  its child runner; keep the terminal session while authorized SDK work should continue.
  Never kill unrelated processes.

The page receives revisioned events while its foreground server is running. It retains
drafts and reading state and supports explicit pause/resume/stop and saved-run retry.
Opening the panel does not authorize starting/resuming model work. Only the lifecycle
adapter may create its owned, leased sidecar; do not create another background daemon
or claim progress after its process stops. Only explicit human choices may
operate review/sign controls. The original artifacts remain authoritative.
