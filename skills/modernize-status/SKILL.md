---
name: modernize-status
description: "Read the original on-disk artifacts and report the actual stage, stale evidence and one next command."
metadata:
  argument-hint: "<system>"
  upstream-source: "commands/modernize-status.md"
---

# modernize-status

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize-status.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-status <system>`. Arguments are semantic values, not shell interpolation.

Read [artifact contracts](../../references/ARTIFACTS.md) and saved files, not the prior
chat or REPORT.html as authority. This command is read-only except refreshing the derived
REPORT.html. Do not initialize missing decisions, run a build/scan or approve anything.

Inspect INTENT/source mapping; PREFLIGHT answers/scope; ASSESSMENT/topology; rules and
reviews; brief phase approval; delta catalog, baseline and PLAYBOOK for uplift; candidate
notes/AGENTS handoff for the selected track; equivalence/test/canary/fresh evidence;
VERIFICATION with named-human sign-off; security findings and patch state.

Distinguish absent, incomplete, blocked, stale, evidence present and actually verified.
Artifact existence is not completion: an uplift without a validated PLAYBOOK has no
proven pilot; transformation notes are not passing tests; a reimagine AGENTS file is not
implemented services; a patch file is not applied or validated remediation.

Compare the brief against newer input/scope/rule/delta decisions, and verification against
changed candidate, tests, fixtures or approvals. Use available change evidence; timestamps
are only hints. An old green verdict cannot apply automatically to new code. If freshness
cannot be checked, state it. Review coverage and decisions per module, not only totals.

Report secrets accidentally tracked in analysis or history if observed, without printing
values or rewriting history. Do not mutate files to hide the warning.

Give a concise state summary: where the process is, what blocks/stales it and ONE exact
next `$modernize-...` invocation. Prefer resolving required review/approval or verification
before advancing to another module. Refresh REPORT.html from actual artifacts without
turning unknown evidence into a green status.

Also read recent SDK state.json files under analysis/<system>/.codex-sdk/runs. Show actual
run IDs, completed/failed/interrupted tasks and reported usage separately from business
stage status. This requires no model call; the runner status command is optional.
