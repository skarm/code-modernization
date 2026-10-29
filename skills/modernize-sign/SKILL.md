---
name: modernize-sign
description: "Transcribe an explicit human approval of the current modernization BRIEF, with the original phase scope."
metadata:
  argument-hint: "<system> [name, role...]"
  upstream-source: "hooks/README.md (modernize-sign command)"
---

# modernize-sign

> Unofficial Codex adaptation of Anthropic Code Modernization (Apache-2.0).
> Modified from `hooks/README.md (modernize-sign command)`; Claude-specific execution is replaced by official Codex SDK workflows and host tools.

**First read [CODEX.md](../../references/CODEX.md)** from this plugin's installed path.
**SDK-first execution:** follow [SDK.md](../../references/SDK.md). Use the matching SDK workflow or role-task for delegation; keep human interaction and shared-file publication in this session. Never launch a second runner from inside an SDK worker.
Resolve system/workspace and reuse previous answers. Additional shared contracts:
[ARTIFACTS.md](../../references/ARTIFACTS.md),
[SECRETS.md](../../references/SECRETS.md),
[REPORTS.md](../../references/REPORTS.md).

Invocation: `$modernize-sign <system> [name, role...]`. Arguments are semantic values, not shell interpolation.

In CLI/SSH show the brief and collect the explicit decision in this conversation;
do not start an HTTP panel or open a browser. The following dialog is GUI-only.
The local UI has the corresponding dialog; see [UI.md](../../references/UI.md).
Open/reuse its progress panel and **sign the brief** control when useful. Let the person
read the revision and choose identity/scope. Do not click Sign on a real plan without the
explicit consent described below. A request to open the dialog is not approval.

This preserves the original optional pane helper: **sign the MODERNIZATION_BRIEF only**.
It does not sign rules, verification, deployment or patches and is not a digital signature.

Read the current brief and its input freshness, outstanding questions and prior approval.
Show which revision/phase is being considered and significant unresolved blockers. Naming
this skill alone is not approval of all phases. Resolve the actual approver and explicit
scope (Phase 1 only or Full plan) from the user's words; ask only for missing information.
Do not infer identity from a git author, email, machine login or another person's approval.

Once the human explicitly approves this brief/scope, transcribe their actual name/role,
current date and scope into its existing original approval block. Preserve other content
and prior approval history. The current command cannot waive later pilot, characterization,
reimagine or verification checkpoints. Never sign a materially changed plan using consent
for an earlier version, or tick all open questions to make it appear executable.
Native file-tool writers should update any existing UI_APPROVAL_CONTEXT.json receipt and
preserve its history after an equivalent new human approval. Otherwise the UI correctly
marks the tracked approval stale after changes to the brief.

Update derived REPORT.html. Confirm exactly what was recorded and the authorized next
phase command. For a request to sign verification, use its separate named-human block
only under the verify workflow and explicit instruction; do not repurpose this helper.
