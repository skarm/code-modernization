---
name: modernize
description: "Start or resume a legacy modernization; clarify the goal and route to the original staged workflow."
metadata:
  argument-hint: "[system] [--source <path>]"
  upstream-source: "commands/modernize.md"
---

# modernize

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `commands/modernize.md`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize [system] [--source <path>]`. Arguments are semantic values, not shell interpolation.

## Start or resume

1. Resolve the workspace, optional system and `--source` using the common host rules. If
   `analysis/<system>/` already contains a run, read `$modernize-status`, report at most
   five lines about its real state and return. Do not restart or replace prior decisions.
2. Find the source at `legacy/<system>/` or the user-provided path. A repository URL is
   not permission to create credentials/connectors; clone only after the user agrees,
   using an available approved host facility. Ask only for a genuinely missing source.
3. Ask at most two compact rounds of clarification, reusing answers already supplied:
   - What is the goal: understand/document, uplift the current stack, transform into a
     different stack, or reimagine the architecture?
   - What must stay: keep-running compatibility, exact legacy behavior including quirks,
     selected intentional fixes, or security-first triage? Capture concrete invariants.
   If implementation is requested, clarify the target version/stack or architectural
   vision in these rounds. Offer only plausible choices grounded in observed source;
   verify current versions from official sources rather than inventing a latest version.
4. Save `analysis/<system>/INTENT.md`: goal, source, target/vision, invariants, actual date,
   verbatim answers and unknowns. Do not imply unanswered questions were approved.
5. Give a route of at most eight lines. Understanding stops after discovery/brief; uplift
   can bypass broad rule extraction in favor of a measured baseline and DELTA_CATALOG;
   transform follows rules and a approved behavior contract; reimagine has its own two
   additional checkpoints. Security-first may route to analysis/hardening early, without
   applying any patch or editing the source.
6. Proceed to preflight only when already authorized or after permission. Never interpret
   the existence of this route as authorization to implement all phases.

Read the next skill rather than treating its `$` invocation as a terminal command.
Next: `$modernize-preflight <system> [--source "<path>"]`.
